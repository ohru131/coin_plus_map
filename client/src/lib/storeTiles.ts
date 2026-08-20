/**
 * Data architecture: versioned static COIN+ map tiles with Cache Storage reuse.
 */
import type { LatLngBounds } from "leaflet";

export type Coordinates = [number, number];

export interface TileStore {
  id: string;
  name: string;
  address: string;
  prefecture: string;
  city: string;
  area: "京都市" | "大阪市" | "茨木市" | "高槻市";
  genre: string;
  categoryId: string;
  latitude: number;
  longitude: number;
  geocodeLevel?: number;
}

export interface TileManifest {
  schemaVersion: 2;
  version: string;
  updatedAt: string;
  sourceSnapshot: string;
  tileDatasetPath: string;
  summaryPath: string;
  tileIndexPath: string;
  searchIndexPath: string;
}

export interface TileSummary {
  source: string;
  sourceSnapshot: string;
  scope: TileStore["area"][];
  totalStores: number;
  coordinateStoreCount: number;
  unmatchedStoreCount: number;
  areaCounts: Record<string, number>;
  genreCounts: Record<string, number>;
  areaGenreCounts: Record<string, Record<string, number>>;
}

export interface DetailTileEntry {
  z: number;
  x: number;
  y: number;
  path: string;
  count: number;
}

export interface TileIndex {
  detailZoom: number;
  overviewZoom: number;
  maxStoresPerDetailTile: number;
  detailParents: Record<string, DetailTileEntry[]>;
  overviewTiles: Record<string, string>;
}

export interface OverviewTile {
  z: number;
  x: number;
  y: number;
  count: number;
  center: Coordinates;
  genreCounts: Record<string, number>;
  areaCounts: Record<string, number>;
}

export interface SearchIndex {
  entries: Array<{ id: string; text: string; tiles: string[] }>;
}

interface CompactStoreTile {
  schema: string[];
  stores: unknown[][];
}

export function isTileManifest(value: unknown): value is TileManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<TileManifest>;
  return (
    manifest.schemaVersion === 2 &&
    typeof manifest.version === "string" &&
    typeof manifest.updatedAt === "string" &&
    typeof manifest.sourceSnapshot === "string" &&
    typeof manifest.tileDatasetPath === "string" &&
    typeof manifest.summaryPath === "string" &&
    typeof manifest.tileIndexPath === "string" &&
    typeof manifest.searchIndexPath === "string"
  );
}

export function tileKey(zoom: number, x: number, y: number) {
  return `${zoom}/${x}/${y}`;
}

export function latLngToTile(
  latitude: number,
  longitude: number,
  zoom: number
) {
  const safeLatitude = Math.min(Math.max(latitude, -85.05112878), 85.05112878);
  const tileCount = 2 ** zoom;
  const x = Math.floor(((longitude + 180) / 360) * tileCount);
  const radians = (safeLatitude * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * tileCount
  );
  return {
    x: Math.max(0, Math.min(tileCount - 1, x)),
    y: Math.max(0, Math.min(tileCount - 1, y)),
  };
}

export function detailTilePathsForBounds(
  bounds: LatLngBounds,
  index: TileIndex
) {
  const southWest = latLngToTile(
    bounds.getSouth(),
    bounds.getWest(),
    index.detailZoom
  );
  const northEast = latLngToTile(
    bounds.getNorth(),
    bounds.getEast(),
    index.detailZoom
  );
  const paths = new Set<string>();
  for (let x = southWest.x; x <= northEast.x; x += 1) {
    for (let y = northEast.y; y <= southWest.y; y += 1) {
      for (const entry of index.detailParents[
        tileKey(index.detailZoom, x, y)
      ] ?? []) {
        paths.add(entry.path);
      }
    }
  }
  return Array.from(paths);
}

export function overviewTilePathsForBounds(
  bounds: LatLngBounds,
  index: TileIndex
) {
  const southWest = latLngToTile(
    bounds.getSouth(),
    bounds.getWest(),
    index.overviewZoom
  );
  const northEast = latLngToTile(
    bounds.getNorth(),
    bounds.getEast(),
    index.overviewZoom
  );
  const paths = new Set<string>();
  for (let x = southWest.x; x <= northEast.x; x += 1) {
    for (let y = northEast.y; y <= southWest.y; y += 1) {
      const path = index.overviewTiles[tileKey(index.overviewZoom, x, y)];
      if (path) paths.add(path);
    }
  }
  return Array.from(paths);
}

export function decodeStoreTile(payload: CompactStoreTile): TileStore[] {
  return payload.stores.flatMap(row => {
    const value = Object.fromEntries(
      payload.schema.map((key, index) => [key, row[index]])
    );
    if (
      typeof value.id !== "string" ||
      typeof value.name !== "string" ||
      typeof value.address !== "string" ||
      typeof value.prefecture !== "string" ||
      typeof value.city !== "string" ||
      typeof value.area !== "string" ||
      typeof value.genre !== "string" ||
      typeof value.categoryId !== "string" ||
      typeof value.latitude !== "number" ||
      typeof value.longitude !== "number"
    ) {
      return [];
    }
    return [
      {
        id: value.id,
        name: value.name,
        address: value.address,
        prefecture: value.prefecture,
        city: value.city,
        area: value.area as TileStore["area"],
        genre: value.genre,
        categoryId: value.categoryId,
        latitude: value.latitude,
        longitude: value.longitude,
        geocodeLevel:
          typeof value.geocodeLevel === "number"
            ? value.geocodeLevel
            : undefined,
      },
    ];
  });
}

function resolveDataUrl(path: string) {
  const basePath = import.meta.env.BASE_URL ?? "/";
  return new URL(
    path.replace(/^\/+/, ""),
    new URL(basePath, window.location.origin)
  ).toString();
}

function resolveDatasetPath(datasetPath: string, path: string) {
  const normalizedDatasetPath = datasetPath.replace(/^\/+|\/+$/g, "");
  const normalizedPath = path.replace(/^\/+/, "");
  return normalizedPath === normalizedDatasetPath ||
    normalizedPath.startsWith(`${normalizedDatasetPath}/`)
    ? normalizedPath
    : `${normalizedDatasetPath}/${normalizedPath}`;
}

function assertJsonResponse(response: Response, path: string) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("application/json")) {
    throw new Error(
      `タイルデータを読み込めませんでした: ${path}（HTTP ${response.status}）`
    );
  }
}

export class TileCache {
  private readonly cacheName: string;
  private readonly datasetPath: string;

  constructor(version: string, datasetPath: string) {
    this.cacheName = `coinplus-store-tiles-${version}`;
    this.datasetPath = datasetPath;
  }

  async fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const datasetPath = resolveDatasetPath(this.datasetPath, path);
    const request = new Request(resolveDataUrl(datasetPath));
    if (!("caches" in window)) {
      const response = await fetch(request, { signal });
      assertJsonResponse(response, datasetPath);
      return response.json() as Promise<T>;
    }
    const cache = await window.caches.open(this.cacheName);
    const cached = await cache.match(request);
    if (cached) {
      try {
        assertJsonResponse(cached, datasetPath);
        return (await cached.json()) as T;
      } catch {
        await cache.delete(request);
      }
    }
    const response = await fetch(request, { signal });
    assertJsonResponse(response, datasetPath);
    const payload = (await response.clone().json()) as T;
    await cache.put(request, response);
    return payload;
  }

  async deleteOlderCaches() {
    if (!("caches" in window)) return;
    const cacheNames = await window.caches.keys();
    await Promise.all(
      cacheNames
        .filter(
          name =>
            name.startsWith("coinplus-store-tiles-") && name !== this.cacheName
        )
        .map(name => window.caches.delete(name))
    );
  }
}

export async function fetchWithConcurrency<T>(
  paths: string[],
  fetcher: (path: string) => Promise<T>,
  concurrency = 4
) {
  const results = new Map<string, T>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < paths.length) {
      const path = paths[cursor];
      cursor += 1;
      results.set(path, await fetcher(path));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, paths.length) }, worker)
  );
  return results;
}
