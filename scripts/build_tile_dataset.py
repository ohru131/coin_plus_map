#!/usr/bin/env python3
"""Create a versioned, static, tile-addressable COIN+ store dataset.

The generated directory is designed for GitHub Pages.  A client loads the small
summary and tile index first, then downloads only tiles intersecting its map
viewport.  No per-store geocoding happens in the browser.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DETAIL_ZOOM = 14
CHILD_ZOOM = 15
OVERVIEW_ZOOM = 10
MAX_STORES_PER_TILE = 250
SCOPE = ["京都市", "大阪市", "茨木市", "高槻市"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build static COIN+ map tiles.")
    parser.add_argument("--stores", type=Path, required=True, help="Coordinate-enriched store JSON.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for generated static files.")
    parser.add_argument("--source-snapshot", required=True, help="Official CSV snapshot date.")
    parser.add_argument("--version", required=True, help="Dataset version identifier.")
    return parser.parse_args()


def tile_xy(latitude: float, longitude: float, zoom: int) -> tuple[int, int]:
    latitude = min(max(latitude, -85.05112878), 85.05112878)
    tiles = 2**zoom
    x = int((longitude + 180.0) / 360.0 * tiles)
    latitude_rad = math.radians(latitude)
    y = int((1.0 - math.asinh(math.tan(latitude_rad)) / math.pi) / 2.0 * tiles)
    return max(0, min(tiles - 1, x)), max(0, min(tiles - 1, y))


def tile_key(zoom: int, x: int, y: int) -> str:
    return f"{zoom}/{x}/{y}"


def compact_store(store: dict[str, Any]) -> list[Any]:
    return [
        store["id"],
        store["name"],
        store["address"],
        store["prefecture"],
        store["city"],
        store["area"],
        store["genre"],
        store["categoryId"],
        store["latitude"],
        store["longitude"],
        store.get("geocodeLevel"),
    ]


STORE_SCHEMA = [
    "id",
    "name",
    "address",
    "prefecture",
    "city",
    "area",
    "genre",
    "categoryId",
    "latitude",
    "longitude",
    "geocodeLevel",
]


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )


def search_text(store: dict[str, Any]) -> str:
    return " ".join(
        str(store.get(key, ""))
        for key in ("name", "address", "prefecture", "city", "area", "genre")
    ).lower()


def main() -> None:
    args = parse_args()
    dataset = json.loads(args.stores.read_text(encoding="utf-8"))
    all_stores: list[dict[str, Any]] = dataset.get("stores", [])
    stores = [
        store
        for store in all_stores
        if isinstance(store.get("latitude"), (int, float))
        and isinstance(store.get("longitude"), (int, float))
    ]
    if args.output_dir.exists():
        shutil.rmtree(args.output_dir)
    args.output_dir.mkdir(parents=True)

    base_tiles: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for store in stores:
        x, y = tile_xy(store["latitude"], store["longitude"], DETAIL_ZOOM)
        base_tiles[tile_key(DETAIL_ZOOM, x, y)].append(store)

    detail_index: dict[str, list[dict[str, Any]]] = {}
    store_tile_paths: dict[str, list[str]] = {}
    detail_tile_count = 0
    for parent_key, tile_stores in sorted(base_tiles.items()):
        zoom, parent_x, parent_y = (int(value) for value in parent_key.split("/"))
        leaves: list[tuple[int, int, int, list[dict[str, Any]]]] = []
        if len(tile_stores) <= MAX_STORES_PER_TILE:
            leaves.append((zoom, parent_x, parent_y, tile_stores))
        else:
            children: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for store in tile_stores:
                child_x, child_y = tile_xy(store["latitude"], store["longitude"], CHILD_ZOOM)
                children[tile_key(CHILD_ZOOM, child_x, child_y)].append(store)
            for child_key, child_stores in sorted(children.items()):
                child_zoom, child_x, child_y = (int(value) for value in child_key.split("/"))
                leaves.append((child_zoom, child_x, child_y, child_stores))

        leaf_entries: list[dict[str, Any]] = []
        for leaf_zoom, leaf_x, leaf_y, leaf_stores in leaves:
            relative_path = f"tiles/stores/z{leaf_zoom}/{leaf_x}/{leaf_y}.json"
            write_json(
                args.output_dir / relative_path,
                {"schema": STORE_SCHEMA, "stores": [compact_store(store) for store in leaf_stores]},
            )
            leaf_entries.append(
                {"z": leaf_zoom, "x": leaf_x, "y": leaf_y, "path": relative_path, "count": len(leaf_stores)}
            )
            detail_tile_count += 1
            for store in leaf_stores:
                store_tile_paths[store["id"]] = [relative_path]
        detail_index[parent_key] = leaf_entries

    overview_buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for store in stores:
        x, y = tile_xy(store["latitude"], store["longitude"], OVERVIEW_ZOOM)
        overview_buckets[tile_key(OVERVIEW_ZOOM, x, y)].append(store)
    overview_index: dict[str, str] = {}
    for overview_key, tile_stores in sorted(overview_buckets.items()):
        zoom, x, y = (int(value) for value in overview_key.split("/"))
        genre_counts = Counter(store["genre"] for store in tile_stores)
        area_counts = Counter(store["area"] for store in tile_stores)
        relative_path = f"tiles/overview/z{zoom}/{x}/{y}.json"
        write_json(
            args.output_dir / relative_path,
            {
                "z": zoom,
                "x": x,
                "y": y,
                "count": len(tile_stores),
                "center": [
                    round(sum(store["latitude"] for store in tile_stores) / len(tile_stores), 7),
                    round(sum(store["longitude"] for store in tile_stores) / len(tile_stores), 7),
                ],
                "genreCounts": dict(sorted(genre_counts.items())),
                "areaCounts": dict(sorted(area_counts.items())),
            },
        )
        overview_index[overview_key] = relative_path

    area_counts = Counter(store["area"] for store in all_stores)
    genre_counts = Counter(store["genre"] for store in all_stores)
    area_genre_counts: dict[str, dict[str, int]] = {}
    for area in SCOPE:
        area_genre_counts[area] = dict(
            sorted(Counter(store["genre"] for store in all_stores if store["area"] == area).items())
        )
    write_json(
        args.output_dir / "summary.json",
        {
            "source": dataset.get("source"),
            "sourceSnapshot": args.source_snapshot,
            "scope": SCOPE,
            "totalStores": len(all_stores),
            "coordinateStoreCount": len(stores),
            "unmatchedStoreCount": len(all_stores) - len(stores),
            "areaCounts": dict(sorted(area_counts.items())),
            "genreCounts": dict(sorted(genre_counts.items())),
            "areaGenreCounts": area_genre_counts,
        },
    )
    write_json(
        args.output_dir / "tile-index.json",
        {
            "detailZoom": DETAIL_ZOOM,
            "overviewZoom": OVERVIEW_ZOOM,
            "maxStoresPerDetailTile": MAX_STORES_PER_TILE,
            "detailParents": detail_index,
            "overviewTiles": overview_index,
        },
    )
    write_json(
        args.output_dir / "search-index.json",
        {
            "entries": [
                {"id": store["id"], "text": search_text(store), "tiles": store_tile_paths[store["id"]]}
                for store in stores
            ]
        },
    )
    write_json(
        args.output_dir / "dataset-info.json",
        {
            "schemaVersion": 2,
            "version": args.version,
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "detailTileCount": detail_tile_count,
            "overviewTileCount": len(overview_index),
            "coordinateStoreCount": len(stores),
        },
    )
    print(f"Built {detail_tile_count} detail tiles and {len(overview_index)} overview tiles.")
    print(f"Indexed {len(stores)}/{len(all_stores)} coordinate stores.")


if __name__ == "__main__":
    main()
