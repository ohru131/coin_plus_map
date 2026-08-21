/**
 * Design: 「地図を主役にするコマンドデスク」。PCでは検索と結果を左の探索レールへ集約し、
 * 右の広い地図ステージで地理的文脈を保つ。COIN+ブルーは主要操作と選択状態だけに使う。
 */
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CircleMarker, Marker, Popup } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { divIcon, type LatLngBounds, type Map as LeafletMap } from "leaflet";
import { MapView } from "@/components/Map";
import { useStoreTiles } from "@/hooks/useStoreTiles";
import type { SearchIndexEntry, TileStore } from "@/lib/storeTiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Clock3,
  ExternalLink,
  Globe2,
  LocateFixed,
  Loader2,
  MapPin,
  Navigation,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Smartphone,
  WifiOff,
  X,
} from "lucide-react";

type Area = "すべて" | "京都市" | "大阪市" | "茨木市" | "高槻市";
type GenreFilter =
  | "飲食"
  | "美容"
  | "コンビニ・スーパー"
  | "買い物"
  | "薬局・医療"
  | "暮らし"
  | "学び・余暇";
type Coordinates = [number, number];

type Store = TileStore;

interface GsiAddressFeature {
  geometry?: { coordinates?: [number, number] };
}

interface GsiReverseGeocodeResponse {
  results?: { lv01Nm?: string };
}

interface StoreExtraInfo {
  status:
    | "loading"
    | "available"
    | "no-public-fields"
    | "no-matching-place"
    | "lookup-error";
  openingHours?: string;
  website?: string;
}

interface StoreExtraLookup {
  openingHours?: string;
  website?: string;
  matchedPlace: boolean;
}

interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

const AREA_OPTIONS: Area[] = ["すべて", "京都市", "大阪市", "茨木市", "高槻市"];
const AREA_CENTERS: Record<Exclude<Area, "すべて">, Coordinates> = {
  京都市: [35.0116, 135.7681],
  大阪市: [34.6937, 135.5023],
  茨木市: [34.8164, 135.5683],
  高槻市: [34.8463, 135.6172],
};
const DEFAULT_CENTER: Coordinates = [34.842, 135.62];
const LIST_PAGE_SIZE = 100;
const PIN_INITIAL_BATCH_SIZE = 300;
const PIN_BATCH_SIZE = 450;
const PIN_BATCH_DELAY_MS = 45;
const COORDINATE_CACHE_STORAGE_KEY = "coinplus-store-coordinate-cache-v1";
const GSI_ADDRESS_SEARCH_URL =
  "https://msearch.gsi.go.jp/address-search/AddressSearch";
const GSI_REVERSE_GEOCODE_URL =
  "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress";
const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";

const GENRE_FILTERS: Array<{
  id: GenreFilter;
  label: string;
  categories: string[];
}> = [
  {
    id: "飲食",
    label: "飲食",
    categories: [
      "飲食店（和食）",
      "飲食店（イタリアン・フレンチ・洋食）",
      "飲食店（カフェ・スイーツ）",
      "飲食店（居酒屋）",
      "飲食店（その他）",
    ],
  },
  {
    id: "美容",
    label: "美容",
    categories: ["美容院・理容店", "ビューティー・リラク"],
  },
  {
    id: "コンビニ・スーパー",
    label: "コンビニ・スーパー",
    categories: ["コンビニ・スーパー・デパート"],
  },
  {
    id: "買い物",
    label: "買い物",
    categories: ["ショッピング", "ファッション"],
  },
  {
    id: "薬局・医療",
    label: "薬局・医療",
    categories: ["薬局", "医療・健康サービス"],
  },
  { id: "暮らし", label: "暮らし", categories: ["住まい・暮らし", "その他"] },
  {
    id: "学び・余暇",
    label: "学び・余暇",
    categories: ["趣味・教育・習い事", "レジャー・スポーツ・旅行"],
  },
];

const GENRE_PIN_COLORS: Record<GenreFilter, string> = {
  飲食: "#E45745",
  美容: "#C6518C",
  "コンビニ・スーパー": "#159B68",
  買い物: "#7357C8",
  "薬局・医療": "#1674C5",
  暮らし: "#9A702E",
  "学び・余暇": "#CE7A1D",
};

const AREA_BOUNDS: Array<{
  area: Exclude<Area, "すべて">;
  south: number;
  west: number;
  north: number;
  east: number;
}> = [
  { area: "茨木市", south: 34.755, west: 135.5, north: 34.88, east: 135.635 },
  { area: "高槻市", south: 34.77, west: 135.545, north: 34.915, east: 135.74 },
  { area: "大阪市", south: 34.56, west: 135.36, north: 34.79, east: 135.69 },
  { area: "京都市", south: 34.83, west: 135.54, north: 35.24, east: 135.91 },
];

function getGenreFilterForStore(store: Store): GenreFilter {
  return (
    GENRE_FILTERS.find(genreFilter =>
      genreFilter.categories.includes(store.genre)
    )?.id ?? "暮らし"
  );
}

function createGenrePinIcon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42"><path d="M17 1.5C8.77 1.5 2.1 8.17 2.1 16.4c0 11.2 14.9 24.1 14.9 24.1s14.9-12.9 14.9-24.1C31.9 8.17 25.23 1.5 17 1.5Z" fill="${color}" stroke="white" stroke-width="2.4"/><circle cx="17" cy="16.2" r="5.1" fill="white"/></svg>`;
  return divIcon({
    className: "coinplus-genre-pin",
    html: svg,
    iconSize: [30, 37],
    iconAnchor: [15, 37],
    popupAnchor: [0, -34],
  });
}

const GENRE_PIN_ICONS: Record<
  GenreFilter,
  ReturnType<typeof createGenrePinIcon>
> = {
  飲食: createGenrePinIcon(GENRE_PIN_COLORS.飲食),
  美容: createGenrePinIcon(GENRE_PIN_COLORS.美容),
  "コンビニ・スーパー": createGenrePinIcon(
    GENRE_PIN_COLORS["コンビニ・スーパー"]
  ),
  買い物: createGenrePinIcon(GENRE_PIN_COLORS.買い物),
  "薬局・医療": createGenrePinIcon(GENRE_PIN_COLORS["薬局・医療"]),
  暮らし: createGenrePinIcon(GENRE_PIN_COLORS.暮らし),
  "学び・余暇": createGenrePinIcon(GENRE_PIN_COLORS["学び・余暇"]),
};

function readCoordinateCache(): Map<string, Coordinates> {
  try {
    const savedValue = window.localStorage.getItem(
      COORDINATE_CACHE_STORAGE_KEY
    );
    if (!savedValue) return new Map();
    const parsedValue: unknown = JSON.parse(savedValue);
    if (!Array.isArray(parsedValue)) return new Map();
    return new Map(
      parsedValue.filter(
        (entry): entry is [string, Coordinates] =>
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          Array.isArray(entry[1]) &&
          entry[1].length === 2 &&
          entry[1].every(
            coordinate =>
              typeof coordinate === "number" && Number.isFinite(coordinate)
          )
      )
    );
  } catch {
    return new Map();
  }
}

function saveCoordinateCache(coordinateCache: Map<string, Coordinates>) {
  try {
    window.localStorage.setItem(
      COORDINATE_CACHE_STORAGE_KEY,
      JSON.stringify(Array.from(coordinateCache.entries()))
    );
  } catch {
    // 端末ストレージが利用できない場合も、その閲覧中はメモリ上のキャッシュを利用する。
  }
}

function findAreaForPosition([latitude, longitude]: Coordinates): Exclude<
  Area,
  "すべて"
> | null {
  return (
    AREA_BOUNDS.find(
      bounds =>
        latitude >= bounds.south &&
        latitude <= bounds.north &&
        longitude >= bounds.west &&
        longitude <= bounds.east
    )?.area ?? null
  );
}

function isPositionInBounds(position: Coordinates, bounds: LatLngBounds) {
  return bounds.contains(position);
}

function getPinRenderBudget(zoom: number) {
  if (zoom < 10) return 1_800;
  if (zoom < 12) return 3_600;
  if (zoom < 14) return 6_000;
  return 11_500;
}

function distanceInMeters(
  [fromLatitude, fromLongitude]: Coordinates,
  [toLatitude, toLongitude]: Coordinates
) {
  const earthRadius = 6_371_000;
  const latitudeDelta = ((toLatitude - fromLatitude) * Math.PI) / 180;
  const longitudeDelta = ((toLongitude - fromLongitude) * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos((fromLatitude * Math.PI) / 180) *
      Math.cos((toLatitude * Math.PI) / 180) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(distance: number) {
  return distance < 1_000
    ? `${Math.round(distance / 10) * 10}m`
    : `${(distance / 1_000).toFixed(1)}km`;
}

function normalizeStoreName(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\s・･-]/g, "")
    .toLocaleLowerCase("ja-JP");
}

function getValidWebsiteUrl(value: string | undefined) {
  if (!value) return undefined;
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

async function lookupNeighborhood(position: Coordinates) {
  const response = await fetch(
    `${GSI_REVERSE_GEOCODE_URL}?lat=${position[0]}&lon=${position[1]}`
  );
  if (!response.ok) return undefined;
  const payload: GsiReverseGeocodeResponse = await response.json();
  return payload.results?.lv01Nm?.trim() || undefined;
}

async function lookupStoreExtraInfo(
  store: Store,
  position: Coordinates
): Promise<StoreExtraLookup> {
  const query = `[out:json][timeout:12];nwr(around:140,${position[0]},${position[1]})["name"];out center tags;`;
  const response = await fetch(
    `${OVERPASS_API_URL}?data=${encodeURIComponent(query)}`
  );
  if (!response.ok) throw new Error("店舗の公開情報を取得できませんでした。");
  const payload: unknown = await response.json();
  const elements = Array.isArray((payload as { elements?: unknown })?.elements)
    ? (payload as { elements: OverpassElement[] }).elements
    : [];
  const normalizedName = normalizeStoreName(store.name);
  const matchingElements = elements.filter(element => {
    const name = element.tags?.["name:ja"] ?? element.tags?.name;
    return (
      typeof name === "string" && normalizeStoreName(name) === normalizedName
    );
  });
  const closestElement = matchingElements.sort((first, second) => {
    const firstPosition: Coordinates = [
      first.lat ?? first.center?.lat ?? 0,
      first.lon ?? first.center?.lon ?? 0,
    ];
    const secondPosition: Coordinates = [
      second.lat ?? second.center?.lat ?? 0,
      second.lon ?? second.center?.lon ?? 0,
    ];
    return (
      distanceInMeters(position, firstPosition) -
      distanceInMeters(position, secondPosition)
    );
  })[0];
  const tags = closestElement?.tags;
  return {
    matchedPlace: Boolean(tags),
    openingHours: tags?.opening_hours?.trim(),
    website: getValidWebsiteUrl(
      tags?.website ?? tags?.["contact:website"] ?? tags?.url
    ),
  };
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const updateMatches = () => setMatches(mediaQuery.matches);
    updateMatches();
    mediaQuery.addEventListener("change", updateMatches);
    return () => mediaQuery.removeEventListener("change", updateMatches);
  }, [query]);

  return matches;
}

function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine
  );

  useEffect(() => {
    const markOnline = () => setIsOnline(true);
    const markOffline = () => setIsOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  return isOnline;
}

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<
    string | null
  >(null);
  const [isSuggestionListOpen, setIsSuggestionListOpen] = useState(true);
  const [selectedArea, setSelectedArea] = useState<Area>("すべて");
  const [selectedGenres, setSelectedGenres] = useState<Set<GenreFilter>>(
    () => new Set()
  );
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [mapBounds, setMapBounds] = useState<LatLngBounds | null>(null);
  const [listedBounds, setListedBounds] = useState<LatLngBounds | null>(null);
  const [coordinates, setCoordinates] = useState<Map<string, Coordinates>>(
    () => new Map()
  );
  const [userPosition, setUserPosition] = useState<Coordinates | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [mobileLegendOpen, setMobileLegendOpen] = useState(false);
  const [nearbyTown, setNearbyTown] = useState<string>();
  const [storeExtraInfo, setStoreExtraInfo] = useState<
    Record<string, StoreExtraInfo>
  >({});
  const [listPageSize, setListPageSize] = useState(LIST_PAGE_SIZE);
  const [renderedPinCount, setRenderedPinCount] = useState(0);
  const coordinateCacheRef = useRef<Map<string, Coordinates>>(new Map());
  const locationRequestedRef = useRef(false);
  const storeExtraInfoCacheRef = useRef<Map<string, StoreExtraInfo>>(new Map());
  const isMobile = useMediaQuery("(max-width: 639px)");
  const isOnline = useOnlineStatus();
  const {
    stores,
    summary,
    overviewTiles,
    searchSuggestions,
    isLoading: loading,
    isLoadingTiles,
    message: tileMessage,
  } = useStoreTiles({
    mapBounds,
    mapZoom: map?.getZoom() ?? 10,
    listedBounds,
    searchQuery,
  });

  useEffect(() => {
    const savedCoordinates = readCoordinateCache();
    const embeddedCoordinates = new Map<string, Coordinates>();
    for (const store of stores) {
      embeddedCoordinates.set(store.id, [store.latitude, store.longitude]);
    }
    for (const [id, position] of Array.from(savedCoordinates.entries())) {
      coordinateCacheRef.current.set(id, position);
    }
    setCoordinates(
      previous =>
        new Map(
          Array.from(previous.entries())
            .concat(Array.from(embeddedCoordinates.entries()))
            .concat(Array.from(savedCoordinates.entries()))
        )
    );
  }, [stores]);

  useEffect(() => {
    if (tileMessage) setLocationMessage(tileMessage);
  }, [tileMessage]);

  const filteredStores = useMemo(() => {
    const keyword = searchQuery.trim().toLocaleLowerCase("ja-JP");
    return stores.filter(store => {
      const isInArea = selectedArea === "すべて" || store.area === selectedArea;
      const isKeywordMatch =
        !keyword ||
        [store.name, store.address, store.city, store.genre].some(value =>
          value.toLocaleLowerCase("ja-JP").includes(keyword)
        );
      const isGenreMatch =
        selectedGenres.size === 0 ||
        GENRE_FILTERS.some(
          genreFilter =>
            selectedGenres.has(genreFilter.id) &&
            genreFilter.categories.includes(store.genre)
        );
      return (
        isInArea &&
        isKeywordMatch &&
        isGenreMatch &&
        (!selectedSuggestionId || store.id === selectedSuggestionId)
      );
    });
  }, [searchQuery, selectedArea, selectedGenres, selectedSuggestionId, stores]);

  const storesMatchingAreaAndKeyword = useMemo(() => {
    const keyword = searchQuery.trim().toLocaleLowerCase("ja-JP");
    return stores.filter(store => {
      const isInArea = selectedArea === "すべて" || store.area === selectedArea;
      const isKeywordMatch =
        !keyword ||
        [store.name, store.address, store.city, store.genre].some(value =>
          value.toLocaleLowerCase("ja-JP").includes(keyword)
        );
      return (
        isInArea &&
        isKeywordMatch &&
        (!selectedSuggestionId || store.id === selectedSuggestionId)
      );
    });
  }, [searchQuery, selectedArea, selectedSuggestionId, stores]);

  const genreCounts = useMemo(() => {
    const keyword = searchQuery.trim();
    if (summary && !keyword) {
      const sourceCounts =
        selectedArea === "すべて"
          ? summary.genreCounts
          : (summary.areaGenreCounts[selectedArea] ?? {});
      return new Map(
        GENRE_FILTERS.map(genreFilter => [
          genreFilter.id,
          genreFilter.categories.reduce(
            (total, category) => total + (sourceCounts[category] ?? 0),
            0
          ),
        ])
      );
    }
    return new Map(
      GENRE_FILTERS.map(genreFilter => [
        genreFilter.id,
        storesMatchingAreaAndKeyword.filter(store =>
          genreFilter.categories.includes(store.genre)
        ).length,
      ])
    );
  }, [searchQuery, selectedArea, storesMatchingAreaAndKeyword, summary]);
  const prioritizedStores = useMemo(() => {
    if (!userPosition) return filteredStores;
    return [...filteredStores].sort((first, second) => {
      const firstTownMatch =
        nearbyTown && first.address.includes(nearbyTown) ? 0 : 1;
      const secondTownMatch =
        nearbyTown && second.address.includes(nearbyTown) ? 0 : 1;
      if (firstTownMatch !== secondTownMatch)
        return firstTownMatch - secondTownMatch;

      const firstPosition = coordinates.get(first.id);
      const secondPosition = coordinates.get(second.id);
      if (firstPosition && secondPosition)
        return (
          distanceInMeters(userPosition, firstPosition) -
          distanceInMeters(userPosition, secondPosition)
        );
      if (firstPosition) return -1;
      if (secondPosition) return 1;
      return first.name.localeCompare(second.name, "ja-JP");
    });
  }, [coordinates, filteredStores, nearbyTown, userPosition]);
  const coordinateStores = useMemo(
    () => prioritizedStores.filter(store => coordinates.has(store.id)),
    [coordinates, prioritizedStores]
  );
  const deferredMapBounds = useDeferredValue(mapBounds);
  const mapZoom = map?.getZoom() ?? 10;
  const isOverviewMode = mapZoom < 12;
  const visibleOverviewTiles = useMemo(() => {
    const selectedCategories = GENRE_FILTERS.filter(genreFilter =>
      selectedGenres.has(genreFilter.id)
    ).flatMap(genreFilter => genreFilter.categories);

    return overviewTiles.flatMap(tile => {
      const sourceCounts =
        selectedArea === "すべて"
          ? tile.genreCounts
          : (tile.areaGenreCounts?.[selectedArea] ?? {});
      const count =
        selectedGenres.size === 0
          ? selectedArea === "すべて"
            ? tile.count
            : (tile.areaCounts[selectedArea] ?? 0)
          : selectedCategories.reduce(
              (total, category) => total + (sourceCounts[category] ?? 0),
              0
            );
      return count > 0 ? [{ ...tile, count }] : [];
    });
  }, [overviewTiles, selectedArea, selectedGenres]);
  const overviewStoreCount = useMemo(
    () => visibleOverviewTiles.reduce((total, tile) => total + tile.count, 0),
    [visibleOverviewTiles]
  );
  const candidatePinStores = useMemo(() => {
    if (!deferredMapBounds) return coordinateStores;
    const bufferedBounds = deferredMapBounds.pad(0.25);
    return coordinateStores.filter(store => {
      const position = coordinates.get(store.id);
      return position ? isPositionInBounds(position, bufferedBounds) : false;
    });
  }, [coordinateStores, coordinates, deferredMapBounds]);
  const pinRenderTarget = Math.min(
    candidatePinStores.length,
    getPinRenderBudget(mapZoom)
  );
  const mapPinStores = useMemo(
    () =>
      mapZoom < 12
        ? []
        : candidatePinStores.slice(0, renderedPinCount),
    [candidatePinStores, mapZoom, renderedPinCount]
  );
  const isPinRendering = renderedPinCount < pinRenderTarget;
  const hasDeferredPins = candidatePinStores.length > pinRenderTarget;
  const visibleStores = useMemo(() => {
    const activeBounds = listedBounds ?? mapBounds;
    if (!activeBounds) return coordinateStores;
    return coordinateStores.filter(store => {
      const position = coordinates.get(store.id);
      return position ? isPositionInBounds(position, activeBounds) : true;
    });
  }, [coordinateStores, coordinates, listedBounds, mapBounds]);
  const hasUnappliedMapBounds = Boolean(
    mapBounds && (!listedBounds || !mapBounds.equals(listedBounds))
  );
  const displayedStores = useMemo(
    () => visibleStores.slice(0, listPageSize),
    [listPageSize, visibleStores]
  );
  const canShowMoreStores = displayedStores.length < visibleStores.length;

  useEffect(() => {
    setListPageSize(LIST_PAGE_SIZE);
  }, [listedBounds, searchQuery, selectedArea, selectedGenres]);

  useEffect(() => {
    let isCancelled = false;
    let timeoutId: number | undefined;
    let nextCount = Math.min(PIN_INITIAL_BATCH_SIZE, pinRenderTarget);
    setRenderedPinCount(nextCount);

    const renderNextBatch = () => {
      if (isCancelled || nextCount >= pinRenderTarget) return;
      nextCount = Math.min(nextCount + PIN_BATCH_SIZE, pinRenderTarget);
      setRenderedPinCount(nextCount);
      if (nextCount < pinRenderTarget) {
        timeoutId = window.setTimeout(renderNextBatch, PIN_BATCH_DELAY_MS);
      }
    };

    if (nextCount < pinRenderTarget) {
      timeoutId = window.setTimeout(renderNextBatch, PIN_BATCH_DELAY_MS);
    }
    return () => {
      isCancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [candidatePinStores, pinRenderTarget]);

  const geocodeStore = useCallback(
    async (store: Store): Promise<Coordinates> => {
      const cachedPosition = coordinateCacheRef.current.get(store.id);
      if (cachedPosition) return cachedPosition;
      const { latitude, longitude } = store;
      if (
        typeof latitude === "number" &&
        Number.isFinite(latitude) &&
        typeof longitude === "number" &&
        Number.isFinite(longitude)
      ) {
        const position: Coordinates = [latitude, longitude];
        coordinateCacheRef.current.set(store.id, position);
        saveCoordinateCache(coordinateCacheRef.current);
        return position;
      }
      const response = await fetch(
        `${GSI_ADDRESS_SEARCH_URL}?q=${encodeURIComponent(store.address)}`,
        { cache: "force-cache" }
      );
      if (!response.ok) throw new Error("住所座標を取得できませんでした。");
      const results: unknown = await response.json();
      const feature = Array.isArray(results)
        ? (results[0] as GsiAddressFeature | undefined)
        : undefined;
      const [resultLongitude, resultLatitude] =
        feature?.geometry?.coordinates ?? [];
      if (
        typeof resultLatitude !== "number" ||
        !Number.isFinite(resultLatitude) ||
        typeof resultLongitude !== "number" ||
        !Number.isFinite(resultLongitude)
      )
        throw new Error("住所座標が見つかりませんでした。");
      const position: Coordinates = [resultLatitude, resultLongitude];
      coordinateCacheRef.current.set(store.id, position);
      saveCoordinateCache(coordinateCacheRef.current);
      return position;
    },
    []
  );

  const toggleGenre = useCallback((genre: GenreFilter) => {
    setSelectedGenres(previous => {
      const next = new Set(previous);
      next.has(genre) ? next.delete(genre) : next.add(genre);
      return next;
    });
    setSelectedStore(null);
  }, []);

  const clearGenres = useCallback(() => {
    setSelectedGenres(new Set());
    setSelectedStore(null);
  }, []);

  const showArea = useCallback(
    (area: Area) => {
      setSelectedArea(area);
      setSelectedSuggestionId(null);
      setSelectedStore(null);
      if (!map) return;
      if (area === "すべて") {
        map.flyTo(DEFAULT_CENTER, 9);
        return;
      }
      map.flyTo(
        AREA_CENTERS[area],
        area === "大阪市" || area === "京都市" ? 11 : 13
      );
    },
    [map]
  );

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setSelectedSuggestionId(null);
    setIsSuggestionListOpen(true);
    setSelectedStore(null);
    setLocationMessage("");
  }, []);

  const selectSearchSuggestion = useCallback(
    (suggestion: SearchIndexEntry) => {
      if (!suggestion.name) return;
      setSearchQuery(suggestion.name);
      setSelectedSuggestionId(suggestion.id);
      setIsSuggestionListOpen(false);
      setSelectedStore(null);
      setLocationMessage(`${suggestion.name}の検索結果を表示しています。`);
    },
    []
  );

  const showStoreOnMap = useCallback(
    async (store: Store) => {
      setSelectedStore(store);
      setMobileLegendOpen(false);
      setLocationMessage("");
      if (!map) {
        setLocationMessage("地図を準備しています。少しお待ちください。");
        return;
      }
      try {
        const position = await geocodeStore(store);
        setCoordinates(previous => new Map(previous).set(store.id, position));
        map.flyTo(position, 17);
      } catch (error) {
        console.error(error);
        setLocationMessage(
          "この店舗の住所を地図上で特定できませんでした。住所をご確認ください。"
        );
      }
    },
    [geocodeStore, map]
  );

  const applyMapBoundsToList = useCallback(() => {
    if (!mapBounds) return;
    setListedBounds(mapBounds);
    setSelectedStore(null);
    setMobileLegendOpen(false);
  }, [mapBounds]);

  const requestUserLocation = useCallback(
    (isInitialRequest = false) => {
      if (!navigator.geolocation) {
        setLocationMessage("この端末では現在地取得を利用できません。");
        return;
      }
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const position: Coordinates = [coords.latitude, coords.longitude];
          setUserPosition(position);
          const nearbyArea = findAreaForPosition(position);
          if (nearbyArea) setSelectedArea(nearbyArea);
          map?.flyTo(position, 15);
          setLocationMessage(
            nearbyArea
              ? `現在地周辺の${nearbyArea}を優先表示しています。`
              : "現在地周辺の店舗を優先表示しています。"
          );
          void lookupNeighborhood(position)
            .then(town => setNearbyTown(town))
            .catch(() => setNearbyTown(undefined));
          setIsLocating(false);
        },
        () => {
          setLocationMessage(
            isInitialRequest
              ? "現在地を取得しませんでした。エリアまたはキーワードから店舗を探せます。"
              : "現在地を取得できませんでした。端末の位置情報設定をご確認ください。"
          );
          setIsLocating(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    },
    [map]
  );

  useEffect(() => {
    if (loading || !map || locationRequestedRef.current) return;
    locationRequestedRef.current = true;
    requestUserLocation(true);
  }, [loading, map, requestUserLocation]);

  useEffect(() => {
    let isCancelled = false;
    if (!selectedStore) return;
    const cachedInfo = storeExtraInfoCacheRef.current.get(selectedStore.id);
    if (cachedInfo) {
      setStoreExtraInfo(previous => ({
        ...previous,
        [selectedStore.id]: cachedInfo,
      }));
      return;
    }
    setStoreExtraInfo(previous => ({
      ...previous,
      [selectedStore.id]: { status: "loading" },
    }));
    void geocodeStore(selectedStore)
      .then(position => lookupStoreExtraInfo(selectedStore, position))
      .then(extraInfo => {
        if (isCancelled) return;
        const result: StoreExtraInfo =
          extraInfo.openingHours || extraInfo.website
            ? { status: "available", ...extraInfo }
            : extraInfo.matchedPlace
              ? { status: "no-public-fields" }
              : { status: "no-matching-place" };
        storeExtraInfoCacheRef.current.set(selectedStore.id, result);
        setStoreExtraInfo(previous => ({
          ...previous,
          [selectedStore.id]: result,
        }));
      })
      .catch(() => {
        if (isCancelled) return;
        const result: StoreExtraInfo = { status: "lookup-error" };
        storeExtraInfoCacheRef.current.set(selectedStore.id, result);
        setStoreExtraInfo(previous => ({
          ...previous,
          [selectedStore.id]: result,
        }));
      });
    return () => {
      isCancelled = true;
    };
  }, [geocodeStore, selectedStore]);

  const selectedStoreDistance =
    selectedStore && userPosition && coordinates.get(selectedStore.id)
      ? distanceInMeters(
          userPosition,
          coordinates.get(selectedStore.id) as Coordinates
        )
      : undefined;
  const selectedStoreAdditionalInfo = selectedStore
    ? storeExtraInfo[selectedStore.id]
    : undefined;

  return (
    <div className="min-h-screen bg-[#f4f7fb] flex flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 shadow-[0_1px_0_rgba(15,23,42,0.03)] backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="h-5 w-5 shrink-0 text-blue-600 sm:h-6 sm:w-6" />
            <h1 className="text-lg font-bold tracking-tight text-slate-950 sm:text-2xl">
              COIN+ ストア マップ
            </h1>
          </div>
          <p className="ml-7 text-[11px] leading-4 text-slate-500 sm:ml-8 sm:text-sm">
            京都市・大阪市・茨木市・高槻市のCOIN+利用可能店舗を検索
          </p>
        </div>
      </header>

      {!isOnline && (
        <div
          role="status"
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-amber-950"
        >
          <div className="mx-auto flex max-w-[1600px] items-start gap-2 text-xs leading-5 sm:px-6 sm:text-sm lg:px-8">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <p>
              オフラインです。以前に読み込んだアプリ画面と店舗データは表示できますが、新しい地域・地図画像・店舗情報の取得は通信回復後に行われます。
            </p>
          </div>
        </div>
      )}

      <main className="flex-1 w-full max-w-[1600px] mx-auto px-3 py-3 sm:px-6 sm:py-5 lg:px-8">
        <div className="grid grid-cols-1 gap-3 lg:h-[calc(100svh-8.5rem)] lg:min-h-[620px] lg:grid-cols-[minmax(350px,410px)_minmax(0,1fr)] lg:grid-rows-[minmax(0,0.58fr)_minmax(0,0.42fr)] lg:gap-5">
          <aside className="order-1 lg:col-start-1 lg:row-start-1 lg:min-h-0">
            <Card className="overflow-visible rounded-2xl border border-slate-200/90 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.06)] lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden">
              <CardHeader className="border-b border-slate-100 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
                <CardTitle className="text-base font-bold text-slate-900 sm:text-lg">店舗検索</CardTitle>
                <p className="pt-1 text-xs leading-5 text-slate-500">
                  条件を指定すると、地図と店舗一覧に反映されます。
                </p>
              </CardHeader>
              <CardContent className="space-y-4 px-4 pb-4 pt-4 sm:px-5 sm:pb-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                <div className="relative">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                  <Input
                    aria-label="店舗名・住所・ジャンルで検索"
                    placeholder="店舗名・住所・ジャンルで検索"
                    value={searchQuery}
                    onChange={event => handleSearchChange(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === "Escape") setIsSuggestionListOpen(false);
                    }}
                    className="h-11 rounded-lg border-slate-200 bg-slate-50/50 pl-9 shadow-none focus-visible:bg-white"
                  />
                  {searchQuery.trim() &&
                    !selectedSuggestionId &&
                    isSuggestionListOpen &&
                    searchSuggestions.length > 0 && (
                      <div
                        role="listbox"
                        aria-label="店舗名の候補"
                        className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-blue-100 bg-white p-1 shadow-lg"
                      >
                        <p className="px-2 py-1 text-[11px] font-medium text-slate-500">
                          店舗名の候補
                        </p>
                        {searchSuggestions.map(suggestion => (
                          <button
                            key={suggestion.id}
                            type="button"
                            role="option"
                            aria-selected={false}
                            onClick={() => selectSearchSuggestion(suggestion)}
                            className="block w-full rounded-md px-2 py-2 text-left transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          >
                            <span className="block truncate text-sm font-semibold text-slate-800">
                              {suggestion.name}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                              {suggestion.area} · {suggestion.genre} · {suggestion.address}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                </div>
                <label
                  className="block text-xs font-medium text-gray-600"
                  htmlFor="area-filter"
                >
                  対象エリア
                </label>
                <select
                  id="area-filter"
                  aria-label="対象エリア"
                  value={selectedArea}
                  onChange={event => showArea(event.target.value as Area)}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
                >
                  {AREA_OPTIONS.map(area => (
                    <option key={area} value={area}>
                      {area}
                    </option>
                  ))}
                </select>
                <div className="pt-1">
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-blue-600" />
                      ジャンル（複数選択）
                    </label>
                    {selectedGenres.size > 0 && (
                      <button
                        type="button"
                        onClick={clearGenres}
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                      >
                        <RotateCcw className="w-3 h-3" />
                        選択解除
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-gray-500">
                    件数は現在のエリア・キーワード条件に連動します。複数選択したジャンルはいずれかに該当する店舗を表示します。
                  </p>
                  <div
                    className="mt-2.5 grid grid-cols-2 gap-2"
                    role="group"
                    aria-label="ジャンルを複数選択"
                  >
                    {GENRE_FILTERS.map(genreFilter => {
                      const isSelected = selectedGenres.has(genreFilter.id);
                      return (
                        <button
                          key={genreFilter.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => toggleGenre(genreFilter.id)}
                          className={`min-h-10 rounded-lg border px-2 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${isSelected ? "border-blue-600 bg-blue-600 text-white shadow-sm" : "border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800"}`}
                        >
                          <span className="truncate">{genreFilter.label}</span>
                          <span
                            className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${isSelected ? "bg-white/20 text-white" : "bg-white text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.08)]"}`}
                          >
                            {genreCounts
                              .get(genreFilter.id)
                              ?.toLocaleString() ?? 0}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Button
                  onClick={() => requestUserLocation(false)}
                  disabled={isLocating}
                  className="h-11 w-full rounded-lg bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                >
                  {isLocating ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <LocateFixed className="w-4 h-4 mr-2" />
                  )}
                  現在地周辺を優先表示
                </Button>
                {locationMessage && (
                  <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
                    {locationMessage}
                  </p>
                )}
                  <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-blue-800">
                    <Smartphone className="h-3.5 w-3.5" />
                    ホーム画面に追加して、通信が弱い場所でも使う
                  </summary>
                  <p className="pt-2 leading-5">
                    SafariまたはChromeのメニューから「ホーム画面に追加」を選べます。一度表示したアプリ画面と店舗データは再利用できますが、未読込地域や地図画像は通信が必要です。
                  </p>
                </details>
              </CardContent>
            </Card>
          </aside>

          <section
            className="order-2 h-[52svh] min-h-[350px] max-h-[520px] lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:h-full lg:min-h-0 lg:max-h-none"
            aria-label="店舗マップ"
          >
            <Card className="h-full overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
              <CardContent className="p-0 h-full relative">
                <MapView
                  className="w-full h-full rounded-lg"
                  initialZoom={10}
                  initialCenter={DEFAULT_CENTER}
                  onMapReady={setMap}
                  onBoundsChange={setMapBounds}
                >
                  {(map?.getZoom() ?? 10) < 12 &&
                    visibleOverviewTiles.map(tile => (
                      <CircleMarker
                        key={`overview-${tile.z}-${tile.x}-${tile.y}`}
                        center={tile.center}
                        radius={Math.min(26, 10 + Math.sqrt(tile.count) / 5)}
                        pathOptions={{
                          color: "#ffffff",
                          fillColor: "#2563eb",
                          fillOpacity: 0.78,
                          weight: 2,
                        }}
                        eventHandlers={{
                          click: () => map?.flyTo(tile.center, 12),
                        }}
                      >
                        {!isMobile && (
                          <Popup>
                            この地域に{tile.count.toLocaleString()}
                            件のCOIN+利用可能店舗があります。拡大すると店舗を表示します。
                          </Popup>
                        )}
                      </CircleMarker>
                    ))}
                  <MarkerClusterGroup
                    chunkedLoading
                    chunkInterval={100}
                    chunkDelay={40}
                  >
                    {mapPinStores.map(store => {
                      const position = coordinates.get(store.id);
                      if (!position) return null;
                      const genre = getGenreFilterForStore(store);
                      return (
                        <Marker
                          key={store.id}
                          position={position}
                          icon={GENRE_PIN_ICONS[genre]}
                          zIndexOffset={
                            selectedStore?.id === store.id ? 1000 : 0
                          }
                          eventHandlers={{
                            click: () => {
                              if (isMobile) {
                                setMobileLegendOpen(false);
                                setSelectedStore(store);
                              }
                            },
                          }}
                        >
                          {!isMobile && (
                            <Popup maxWidth={280}>
                              <div className="space-y-2 p-0.5">
                                <p className="font-bold text-slate-900">
                                  {store.name}
                                </p>
                                <p
                                  className="inline-block rounded-full px-2 py-0.5 text-xs font-bold"
                                  style={{
                                    backgroundColor: `${GENRE_PIN_COLORS[genre]}18`,
                                    color: GENRE_PIN_COLORS[genre],
                                  }}
                                >
                                  {genre} · COIN+利用可能
                                </p>
                                <p className="text-xs leading-5 text-slate-600">
                                  {store.address}
                                </p>
                                <p className="text-[11px] font-semibold text-slate-500">
                                  {store.area} · {store.city}
                                </p>
                                <div className="flex flex-wrap gap-2 pt-1">
                                  <a
                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${store.name} ${store.address}`)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs font-bold text-blue-700"
                                  >
                                    Google Mapsで開く
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedStore(store)}
                                    className="rounded-md bg-blue-600 px-2 py-1.5 text-xs font-bold text-white"
                                  >
                                    詳細を表示
                                  </button>
                                </div>
                              </div>
                            </Popup>
                          )}
                        </Marker>
                      );
                    })}
                  </MarkerClusterGroup>
                  {userPosition && (
                    <CircleMarker
                      center={userPosition}
                      radius={9}
                      pathOptions={{
                        color: "#ffffff",
                        fillColor: "#2563eb",
                        fillOpacity: 1,
                        weight: 3,
                      }}
                    >
                      {!isMobile && <Popup>現在地</Popup>}
                    </CircleMarker>
                  )}
                </MapView>
                <div className="absolute right-4 top-4 z-[500] flex max-w-[calc(100%-2rem)] flex-col items-end gap-2">
                  <div className="rounded-xl border border-white/90 bg-white/95 px-3 py-2 shadow-md backdrop-blur-sm">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                    <MapPin className="w-3.5 h-3.5 text-blue-600" />
                    <span className="sm:hidden">
                      {isOverviewMode
                        ? `${visibleOverviewTiles.length}地域`
                        : `${mapPinStores.length.toLocaleString()}件`}
                    </span>
                    <span className="hidden sm:inline">
                      {isOverviewMode
                        ? `${visibleOverviewTiles.length}地域・${overviewStoreCount.toLocaleString()}件を集約表示`
                        : `${mapPinStores.length.toLocaleString()} / ${candidatePinStores.length.toLocaleString()}件を描画`}
                    </span>
                  </p>
                  <p className="mt-1 hidden text-[11px] text-slate-600 sm:block">
                    一覧表示中: {visibleStores.length}件
                  </p>
                  {isLoadingTiles && (
                    <p className="mt-1 hidden items-center gap-1 text-[10px] text-blue-700 sm:flex">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      表示範囲の店舗を取得中
                    </p>
                  )}
                  {userPosition && (
                    <p className="mt-1 hidden text-[11px] font-medium text-blue-700 sm:block">
                      現在地周辺を優先表示中
                    </p>
                  )}
                  <p className="mt-1 hidden text-[10px] text-slate-500 sm:block">
                    {isOverviewMode
                      ? "拡大するとジャンル別の店舗ピンを表示"
                      : "表示範囲に応じて段階描画"}
                  </p>
                  {isPinRendering && !isLoadingTiles && (
                    <p className="mt-1 hidden items-center gap-1 text-[10px] text-blue-700 sm:flex">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      ピンを追加中
                    </p>
                  )}
                    {hasDeferredPins && !isPinRendering && (
                    <p className="mt-1 hidden text-[10px] text-slate-500 sm:block">
                      拡大すると追加表示
                    </p>
                  )}
                  </div>
                  <button
                    type="button"
                    onClick={applyMapBoundsToList}
                    disabled={!mapBounds || !hasUnappliedMapBounds}
                    className={`rounded-full px-3 py-2 text-[11px] font-bold shadow-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${hasUnappliedMapBounds ? "border border-blue-600 bg-blue-600 text-white hover:bg-blue-700" : "border border-white/90 bg-white/95 text-slate-500"}`}
                  >
                    <span className="sm:hidden">
                      {hasUnappliedMapBounds
                        ? "この範囲を表示"
                        : "この範囲を表示中"}
                    </span>
                    <span className="hidden sm:inline">
                      {hasUnappliedMapBounds
                        ? "この範囲の店舗を表示"
                        : "この範囲の店舗を表示中"}
                    </span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileLegendOpen(open => !open)}
                  aria-expanded={mobileLegendOpen}
                  className="absolute bottom-3 left-3 z-[500] flex items-center gap-1.5 rounded-full border border-white/80 bg-white/95 px-3 py-2 text-[11px] font-bold text-slate-700 shadow-sm backdrop-blur-sm sm:hidden"
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
                  ピンの色
                </button>
                {mobileLegendOpen && (
                  <div
                    className="absolute bottom-14 left-3 z-[500] max-w-[calc(100%-1.5rem)] rounded-lg border border-white/80 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm sm:hidden"
                    aria-label="ピンのジャンル別凡例"
                  >
                    <div className="flex max-w-[260px] flex-wrap gap-x-2.5 gap-y-1">
                      {GENRE_FILTERS.map(genreFilter => (
                        <span
                          key={genreFilter.id}
                          className="flex items-center gap-1 text-[10px] text-slate-700"
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{
                              backgroundColor: GENRE_PIN_COLORS[genreFilter.id],
                            }}
                          />
                          {genreFilter.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div
                  className="absolute bottom-4 left-4 z-[500] hidden max-w-[calc(100%-2rem)] rounded-xl border border-white/90 bg-white/95 px-3.5 py-2.5 shadow-md backdrop-blur-sm sm:block"
                  aria-label="ピンのジャンル別凡例"
                >
                  <p className="mb-1 text-[10px] font-semibold tracking-wide text-slate-500">
                    ジャンル別ピン
                  </p>
                  <div className="flex max-w-[310px] flex-wrap gap-x-2.5 gap-y-1">
                    {GENRE_FILTERS.map(genreFilter => (
                      <span
                        key={genreFilter.id}
                        className="flex items-center gap-1 text-[10px] text-slate-700"
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{
                            backgroundColor: GENRE_PIN_COLORS[genreFilter.id],
                          }}
                        />
                        {genreFilter.label}
                      </span>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
          <aside id="store-list" className="order-3 lg:col-start-1 lg:row-start-2 lg:min-h-0">
            <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
              <CardHeader className="border-b border-slate-100 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base font-bold text-slate-900 sm:text-lg">
                      店舗一覧{" "}
                      <span className="text-xs sm:text-sm font-normal text-gray-500">
                        (表示範囲 {visibleStores.length.toLocaleString()}件)
                      </span>
                    </CardTitle>
                    <p className="pt-1 text-xs text-gray-500">
                      地図を動かした後は範囲内の店舗を更新できます。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={applyMapBoundsToList}
                    disabled={!mapBounds || !hasUnappliedMapBounds}
                    className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${hasUnappliedMapBounds ? "bg-blue-600 text-white hover:bg-blue-700" : "border border-slate-200 bg-slate-50 text-slate-400"}`}
                  >
                    {hasUnappliedMapBounds ? "この範囲を表示" : "表示中"}
                  </button>
                </div>
                {summary &&
                  filteredStores.length === 0 &&
                  !loading &&
                  !isLoadingTiles && (
                    <p className="text-xs text-gray-500 pt-1">
                      地図を拡大するか「この範囲の店舗を表示」を押すと、店舗を読み込みます。
                    </p>
                  )}
                {summary && summary.unmatchedStoreCount > 0 && (
                  <p className="text-xs text-gray-500 pt-1">
                    座標を確認できない
                    {summary.unmatchedStoreCount.toLocaleString()}
                    件は地図外です。
                  </p>
                )}
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 max-h-[42svh] lg:max-h-none">
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                    </div>
                  ) : visibleStores.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-8">
                      該当する店舗がありません。
                    </p>
                  ) : (
                    displayedStores.map(store => {
                      const position = coordinates.get(store.id);
                      const distance =
                        userPosition && position
                          ? distanceInMeters(userPosition, position)
                          : undefined;
                      return (
                        <button
                          key={store.id}
                          onClick={() => void showStoreOnMap(store)}
                          className={`w-full rounded-lg border-l-4 p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${selectedStore?.id === store.id ? "border-blue-600 bg-blue-50" : "border-transparent hover:bg-slate-50"}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-sm text-gray-900 truncate">
                              {store.name}
                            </p>
                            {distance !== undefined && (
                              <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                                {formatDistance(distance)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-600 truncate">
                            {store.address}
                          </p>
                          <p className="text-xs text-blue-600 font-medium mt-1">
                            {store.genre}・{store.city}
                          </p>
                        </button>
                      );
                    })
                  )}
                </div>
                {canShowMoreStores && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setListPageSize(size => size + LIST_PAGE_SIZE)
                    }
                    className="mt-3 w-full border-blue-200 text-blue-700 hover:bg-blue-50"
                  >
                    さらに
                    {Math.min(
                      LIST_PAGE_SIZE,
                      visibleStores.length - displayedStores.length
                    ).toLocaleString()}
                    件を表示
                  </Button>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-3 text-[10px] leading-4 text-slate-500 sm:px-6">
        <p className="mx-auto max-w-7xl">
          店舗座標は「位置参照情報（大字町丁目・街区レベル）令和5年」（国土交通省）、
          <a
            className="underline underline-offset-2"
            href="https://geolonia.github.io/japanese-addresses/"
            target="_blank"
            rel="noreferrer"
          >
            Geolonia 住所データ
          </a>
          、
          <a
            className="underline underline-offset-2"
            href="https://www.digital.go.jp/policies/base_registry_address_tos/"
            target="_blank"
            rel="noreferrer"
          >
            アドレス・ベース・レジストリ
          </a>
          をもとに、株式会社情報試作室が加工したjageocoder用住所データベース（街区レベル）を利用しています。座標は住所の代表点であり、店舗の入口位置と異なる場合があります。
        </p>
      </footer>

      {selectedStore && (
        <div
          className="fixed inset-0 z-[1000] flex items-end bg-slate-950/25 sm:items-center sm:justify-center sm:bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-label="店舗詳細"
        >
          <button
            type="button"
            onClick={() => setSelectedStore(null)}
            className="absolute inset-0 cursor-default"
            aria-label="店舗詳細を閉じる"
          />
          <div className="relative max-h-[72svh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl animate-in slide-in-from-bottom sm:max-w-md sm:rounded-lg sm:slide-in-from-center">
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-200 sm:hidden" />
            <div className="p-4 sm:p-6 space-y-3 sm:space-y-4">
              <div className="flex justify-between items-start gap-4">
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-xl font-bold text-gray-900 break-words">
                    {selectedStore.name}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="text-sm text-blue-600 font-medium">
                      {selectedStore.genre}
                    </p>
                    {selectedStoreDistance !== undefined && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                        現在地から約{formatDistance(selectedStoreDistance)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedStore(null)}
                  className="shrink-0 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  aria-label="閉じる"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-2 border-t border-gray-200 pt-3">
                <p className="text-sm leading-5 text-gray-600 break-words">
                  <span className="font-semibold">住所:</span>{" "}
                  {selectedStore.address}
                </p>
                <p className="text-sm text-gray-600">
                  <span className="font-semibold">市区町村:</span>{" "}
                  {selectedStore.city}
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-3">
                <div className="flex gap-2">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                  <div>
                    <p className="text-xs font-bold text-slate-700">営業時間</p>
                    {selectedStoreAdditionalInfo?.status === "loading" ? (
                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        公開情報を確認中
                      </p>
                    ) : selectedStoreAdditionalInfo?.openingHours ? (
                      <p className="mt-1 text-sm text-slate-700 break-words">
                        {selectedStoreAdditionalInfo.openingHours}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {selectedStoreAdditionalInfo?.status === "no-matching-place"
                          ? "近くの公開地図情報に、店舗名が一致する地点を確認できませんでした。"
                          : selectedStoreAdditionalInfo?.status === "lookup-error"
                            ? "公開地図情報を一時的に確認できませんでした。"
                            : "照合できた公開地図情報には、営業時間が登録されていません。"}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                  <div>
                    <p className="text-xs font-bold text-slate-700">
                      公式サイト
                    </p>
                    {selectedStoreAdditionalInfo?.status === "loading" ? (
                      <p className="mt-1 text-xs text-slate-500">
                        公開情報を確認中
                      </p>
                    ) : selectedStoreAdditionalInfo?.website ? (
                      <a
                        href={selectedStoreAdditionalInfo.website}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-blue-700 underline decoration-blue-200 underline-offset-2 hover:text-blue-900"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        公式サイトを開く
                      </a>
                    ) : (
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {selectedStoreAdditionalInfo?.status === "no-matching-place"
                          ? "近くの公開地図情報に、店舗名が一致する地点を確認できませんでした。"
                          : selectedStoreAdditionalInfo?.status === "lookup-error"
                            ? "公開地図情報を一時的に確認できませんでした。"
                            : "照合できた公開地図情報には、公式サイトが登録されていません。"}
                      </p>
                    )}
                  </div>
                </div>
                <div className="border-t border-slate-200 pt-2.5">
                  <p className="text-[10px] leading-4 text-slate-500">
                    営業時間・公式サイトはCOIN+の店舗データには含まれないため、近くのOpenStreetMap公開情報で店舗名が一致した場合だけ表示します。最新情報は以下の確認先をご利用ください。
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedStore.name} ${selectedStore.address}`)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-center text-[11px] font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800"
                    >
                      <ExternalLink className="mr-1 h-3 w-3 shrink-0" />
                      Google Mapsで確認
                    </a>
                    <a
                      href="https://coinplus.jp/storesearch/all.html?region=%E9%96%A2%E8%A5%BF"
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-center text-[11px] font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800"
                    >
                      <ExternalLink className="mr-1 h-3 w-3 shrink-0" />
                      公式COIN+検索
                    </a>
                  </div>
                </div>
              </div>
              <div className="grid gap-2 sm:block sm:space-y-2">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedStore.name} ${selectedStore.address}`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-10 w-full items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-4 text-sm font-medium text-blue-700 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Google Mapsで店舗情報を確認
                </a>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&origin=My+Location&destination=${encodeURIComponent(`${selectedStore.name} ${selectedStore.address}`)}&travelmode=walking`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-10 w-full items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <Navigation className="w-4 h-4 mr-2" />
                  現在地から徒歩で経路を開く
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
