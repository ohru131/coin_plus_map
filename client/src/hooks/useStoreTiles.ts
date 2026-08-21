/**
 * Data architecture: viewport-driven static tile loading with cache-first reuse.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LatLngBounds } from "leaflet";
import {
  decodeStoreTile,
  detailTilePathsForBounds,
  fetchWithConcurrency,
  isTileManifest,
  overviewTilePathsForBounds,
  type OverviewTile,
  type SearchIndex,
  type SearchIndexEntry,
  type TileCache,
  type TileIndex,
  type TileManifest,
  type TileStore,
  type TileSummary,
  TileCache as StoreTileCache,
} from "@/lib/storeTiles";

const MANIFEST_PATH = `${import.meta.env.BASE_URL}store-data-manifest.json`;
const MAX_MEMORY_TILES = 256;
const MAP_TILE_CONCURRENCY = 4;

interface LegacyManifest {
  schemaVersion: 1;
  datasetPath: string;
}

interface LegacyDataset {
  stores: TileStore[];
  scope: TileStore["area"][];
  source: string;
  sourceSnapshot: string;
}

interface TileRuntime {
  manifest: TileManifest;
  cache: TileCache;
  index: TileIndex;
  summary: TileSummary;
}

function isLegacyManifest(value: unknown): value is LegacyManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<LegacyManifest>;
  return (
    manifest.schemaVersion === 1 && typeof manifest.datasetPath === "string"
  );
}

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").trim();
}

export function useStoreTiles({
  mapBounds,
  mapZoom,
  listedBounds,
  searchQuery,
}: {
  mapBounds: LatLngBounds | null;
  mapZoom: number;
  listedBounds: LatLngBounds | null;
  searchQuery: string;
}) {
  const [runtime, setRuntime] = useState<TileRuntime | null>(null);
  const [legacyStores, setLegacyStores] = useState<TileStore[] | null>(null);
  const [tileStores, setTileStores] = useState<Map<string, TileStore[]>>(
    () => new Map()
  );
  const [overviewTiles, setOverviewTiles] = useState<Map<string, OverviewTile>>(
    () => new Map()
  );
  const [searchSuggestions, setSearchSuggestions] = useState<
    SearchIndexEntry[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingTiles, setIsLoadingTiles] = useState(false);
  const [message, setMessage] = useState("");
  const tileAccessRef = useRef(new Map<string, number>());
  const tileRequestRef = useRef<AbortController | null>(null);
  const searchRequestRef = useRef<AbortController | null>(null);
  const searchIndexRef = useRef<SearchIndex | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function initialize() {
      try {
        const response = await fetch(MANIFEST_PATH, { cache: "no-store" });
        if (!response.ok)
          throw new Error("店舗データの更新情報を取得できませんでした。");
        const manifest: unknown = await response.json();
        if (isTileManifest(manifest)) {
          const cache = new StoreTileCache(
            manifest.version,
            manifest.tileDatasetPath
          );
          const [summary, index] = await Promise.all([
            cache.fetchJson<TileSummary>(manifest.summaryPath),
            cache.fetchJson<TileIndex>(manifest.tileIndexPath),
          ]);
          if (!isMounted) return;
          setRuntime({ manifest, cache, summary, index });
          void cache.deleteOlderCaches();
          return;
        }
        if (isLegacyManifest(manifest)) {
          const legacyResponse = await fetch(manifest.datasetPath);
          if (!legacyResponse.ok)
            throw new Error("店舗データを読み込めませんでした。");
          const legacy: LegacyDataset = await legacyResponse.json();
          if (isMounted) {
            setLegacyStores(
              legacy.stores.filter(
                store =>
                  Number.isFinite(store.latitude) &&
                  Number.isFinite(store.longitude)
              )
            );
            setMessage(
              "旧形式の店舗データを表示しています。タイルデータの公開後に軽量読込へ切り替わります。"
            );
          }
          return;
        }
        throw new Error("店舗データの形式が正しくありません。");
      } catch (error) {
        console.error(error);
        if (isMounted)
          setMessage(
            "店舗データを読み込めませんでした。時間をおいて再度お試しください。"
          );
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    void initialize();
    return () => {
      isMounted = false;
    };
  }, []);

  const loadDetailTiles = useCallback(
    async (paths: string[], signal?: AbortSignal) => {
      if (!runtime || paths.length === 0) return;
      const missingPaths = paths.filter(path => !tileStores.has(path));
      if (missingPaths.length === 0) {
        paths.forEach(path => tileAccessRef.current.set(path, Date.now()));
        return;
      }
      setIsLoadingTiles(true);
      try {
        const fetched = await fetchWithConcurrency(
          missingPaths,
          async path => {
            const payload = await runtime.cache.fetchJson<{
              schema: string[];
              stores: unknown[][];
            }>(path, signal);
            return decodeStoreTile(payload);
          },
          MAP_TILE_CONCURRENCY
        );
        if (signal?.aborted) return;
        setMessage(previous =>
          previous.startsWith("一部の地図タイルを") ? "" : previous
        );
        const now = Date.now();
        setTileStores(previous => {
          const next = new Map(previous);
          for (const [path, stores] of Array.from(fetched.entries())) {
            next.set(path, stores);
            tileAccessRef.current.set(path, now);
          }
          if (next.size > MAX_MEMORY_TILES) {
            const evictable = Array.from(next.keys())
              .filter(path => !paths.includes(path))
              .sort(
                (first, second) =>
                  (tileAccessRef.current.get(first) ?? 0) -
                  (tileAccessRef.current.get(second) ?? 0)
              );
            for (const path of evictable.slice(
              0,
              Math.max(0, next.size - MAX_MEMORY_TILES)
            )) {
              next.delete(path);
              tileAccessRef.current.delete(path);
            }
          }
          return next;
        });
      } catch (error) {
        if (!signal?.aborted) {
          console.error(error);
          setMessage(
            "一部の地図タイルを読み込めませんでした。地図を移動して再度お試しください。"
          );
        }
      } finally {
        if (!signal?.aborted) setIsLoadingTiles(false);
      }
    },
    [runtime, tileStores]
  );

  useEffect(() => {
    if (!runtime || !mapBounds) return;
    const controller = new AbortController();
    tileRequestRef.current?.abort();
    tileRequestRef.current = controller;
    const timer = window.setTimeout(() => {
      const paddedBounds = mapBounds.pad(0.25);
      if (mapZoom >= 12) {
        void loadDetailTiles(
          detailTilePathsForBounds(paddedBounds, runtime.index),
          controller.signal
        );
        return;
      }
      const overviewPaths = overviewTilePathsForBounds(
        paddedBounds,
        runtime.index
      );
      const missingPaths = overviewPaths.filter(
        path => !overviewTiles.has(path)
      );
      if (missingPaths.length === 0) return;
      void fetchWithConcurrency(
        missingPaths,
        path => runtime.cache.fetchJson<OverviewTile>(path, controller.signal),
        MAP_TILE_CONCURRENCY
      )
        .then(fetched => {
          if (controller.signal.aborted) return;
          setOverviewTiles(
            previous =>
              new Map(
                Array.from(previous.entries()).concat(
                  Array.from(fetched.entries())
                )
              )
          );
        })
        .catch(error => {
          if (!controller.signal.aborted) console.error(error);
        });
    }, 160);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadDetailTiles, mapBounds, mapZoom, overviewTiles, runtime]);

  useEffect(() => {
    if (!runtime || !listedBounds) return;
    const controller = new AbortController();
    void loadDetailTiles(
      detailTilePathsForBounds(listedBounds, runtime.index),
      controller.signal
    );
    return () => controller.abort();
  }, [listedBounds, loadDetailTiles, runtime]);

  useEffect(() => {
    const keyword = normalizeSearchText(searchQuery);
    if (!runtime || !keyword) {
      setSearchSuggestions([]);
      return;
    }
    const controller = new AbortController();
    searchRequestRef.current?.abort();
    searchRequestRef.current = controller;
    setSearchSuggestions([]);
    const timer = window.setTimeout(() => {
      const loadSearchMatches = async () => {
        try {
          if (!searchIndexRef.current) {
            searchIndexRef.current = await runtime.cache.fetchJson<SearchIndex>(
              runtime.manifest.searchIndexPath,
              controller.signal
            );
          }
          if (controller.signal.aborted) return;
          const matchedEntries = searchIndexRef.current.entries.filter(entry =>
            entry.text.includes(keyword)
          );
          setSearchSuggestions(
            matchedEntries
              .filter(entry => typeof entry.name === "string")
              .slice(0, 8)
          );
          const matchedPaths = Array.from(
            new Set(
              matchedEntries.flatMap(entry => entry.tiles)
            )
          );
          await loadDetailTiles(matchedPaths, controller.signal);
        } catch (error) {
          if (!controller.signal.aborted) console.error(error);
        }
      };
      void loadSearchMatches();
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadDetailTiles, runtime, searchQuery]);

  const stores = useMemo(() => {
    if (legacyStores) return legacyStores;
    const byId = new Map<string, TileStore>();
    for (const storesInTile of Array.from(tileStores.values())) {
      for (const store of storesInTile) byId.set(store.id, store);
    }
    return Array.from(byId.values());
  }, [legacyStores, tileStores]);

  return {
    stores,
    summary: runtime?.summary ?? null,
    overviewTiles: Array.from(overviewTiles.values()),
    searchSuggestions,
    isTileMode: Boolean(runtime),
    isLoading,
    isLoadingTiles,
    message,
  };
}
