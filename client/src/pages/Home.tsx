/**
 * Design: 明快な白地とCOIN+ブルーで、モバイルでも現在地・エリア・個別店舗を迷わず辿れる地理検索画面。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { MapView } from '@/components/Map';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ExternalLink, LocateFixed, Loader2, MapPin, Navigation, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';

type Area = 'すべて' | '京都市' | '大阪市' | '茨木市' | '高槻市';
type GenreFilter = '飲食' | '美容' | 'コンビニ・スーパー' | '買い物' | '薬局・医療' | '暮らし' | '学び・余暇';

interface Store {
  id: string;
  name: string;
  address: string;
  prefecture: string;
  city: string;
  area: Exclude<Area, 'すべて'>;
  genre: string;
  categoryId: string;
}

interface StoreDataset {
  source: string;
  sourceSnapshot: string;
  scope: Exclude<Area, 'すべて'>[];
  stores: Store[];
}

interface StoreManifest {
  schemaVersion: 1;
  version: string;
  updatedAt: string;
  datasetPath: string;
  sourceSnapshot: string;
}

const AREA_OPTIONS: Area[] = ['すべて', '京都市', '大阪市', '茨木市', '高槻市'];
const AREA_CENTERS: Record<Exclude<Area, 'すべて'>, google.maps.LatLngLiteral> = {
  京都市: { lat: 35.0116, lng: 135.7681 },
  大阪市: { lat: 34.6937, lng: 135.5023 },
  茨木市: { lat: 34.8164, lng: 135.5683 },
  高槻市: { lat: 34.8463, lng: 135.6172 },
};
const DEFAULT_CENTER = { lat: 34.842, lng: 135.62 };
const LIST_LIMIT = 100;
const STORE_MANIFEST_PATH = `${import.meta.env.BASE_URL}store-data-manifest.json`;
const STORE_CACHE_NAME = 'coinplus-store-dataset-v1';
const LAST_MANIFEST_STORAGE_KEY = 'coinplus-store-last-manifest-v1';
const GENRE_FILTERS: Array<{ id: GenreFilter; label: string; categories: string[] }> = [
  { id: '飲食', label: '飲食', categories: ['飲食店（和食）', '飲食店（イタリアン・フレンチ・洋食）', '飲食店（カフェ・スイーツ）', '飲食店（居酒屋）', '飲食店（その他）'] },
  { id: '美容', label: '美容', categories: ['美容院・理容店', 'ビューティー・リラク'] },
  { id: 'コンビニ・スーパー', label: 'コンビニ・スーパー', categories: ['コンビニ・スーパー・デパート'] },
  { id: '買い物', label: '買い物', categories: ['ショッピング', 'ファッション'] },
  { id: '薬局・医療', label: '薬局・医療', categories: ['薬局', '医療・健康サービス'] },
  { id: '暮らし', label: '暮らし', categories: ['住まい・暮らし', 'その他'] },
  { id: '学び・余暇', label: '学び・余暇', categories: ['趣味・教育・習い事', 'レジャー・スポーツ・旅行'] },
];
const GENRE_PIN_COLORS: Record<GenreFilter, string> = {
  飲食: '#E45745',
  美容: '#C6518C',
  'コンビニ・スーパー': '#159B68',
  買い物: '#7357C8',
  '薬局・医療': '#1674C5',
  暮らし: '#9A702E',
  '学び・余暇': '#CE7A1D',
};

function getGenreFilterForStore(store: Store): GenreFilter {
  return GENRE_FILTERS.find((genreFilter) => genreFilter.categories.includes(store.genre))?.id ?? '暮らし';
}

function createGenrePinIcon(color: string): google.maps.Icon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42"><path d="M17 1.5C8.77 1.5 2.1 8.17 2.1 16.4c0 11.2 14.9 24.1 14.9 24.1s14.9-12.9 14.9-24.1C31.9 8.17 25.23 1.5 17 1.5Z" fill="${color}" stroke="white" stroke-width="2.4"/><circle cx="17" cy="16.2" r="5.1" fill="white"/></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(30, 37),
    anchor: new google.maps.Point(15, 37),
  };
}

function isPositionInBounds(position: google.maps.LatLngLiteral, bounds: google.maps.LatLngBoundsLiteral) {
  const isLatitudeInBounds = position.lat >= bounds.south && position.lat <= bounds.north;
  const isLongitudeInBounds = bounds.west <= bounds.east
    ? position.lng >= bounds.west && position.lng <= bounds.east
    : position.lng >= bounds.west || position.lng <= bounds.east;
  return isLatitudeInBounds && isLongitudeInBounds;
}

function createStoreInfoContent(store: Store, genre: GenreFilter, onShowDetails: () => void) {
  const container = document.createElement('div');
  container.style.cssText = 'min-width:190px;max-width:240px;padding:2px 1px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

  const title = document.createElement('p');
  title.textContent = store.name;
  title.style.cssText = 'margin:0 0 5px;color:#172033;font-size:14px;font-weight:700;line-height:1.35;';

  const category = document.createElement('p');
  category.textContent = genre;
  category.style.cssText = `margin:0 0 6px;color:${GENRE_PIN_COLORS[genre]};font-size:12px;font-weight:700;`;

  const address = document.createElement('p');
  address.textContent = store.address;
  address.style.cssText = 'margin:0 0 9px;color:#4a5568;font-size:11px;line-height:1.45;';

  const detailButton = document.createElement('button');
  detailButton.type = 'button';
  detailButton.textContent = '店舗詳細を見る';
  detailButton.style.cssText = 'border:0;border-radius:5px;background:#2563eb;color:#fff;padding:6px 9px;font-size:12px;font-weight:700;cursor:pointer;';
  detailButton.addEventListener('click', onShowDetails);

  container.append(title, category, address, detailButton);
  return container;
}

function isStoreManifest(value: unknown): value is StoreManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<StoreManifest>;
  return manifest.schemaVersion === 1
    && typeof manifest.version === 'string'
    && typeof manifest.updatedAt === 'string'
    && typeof manifest.datasetPath === 'string'
    && typeof manifest.sourceSnapshot === 'string';
}

function readSavedManifest(): StoreManifest | null {
  try {
    const value = window.localStorage.getItem(LAST_MANIFEST_STORAGE_KEY);
    if (!value) return null;
    const manifest: unknown = JSON.parse(value);
    return isStoreManifest(manifest) ? manifest : null;
  } catch {
    return null;
  }
}

function saveManifest(manifest: StoreManifest) {
  try {
    window.localStorage.setItem(LAST_MANIFEST_STORAGE_KEY, JSON.stringify(manifest));
  } catch {
    // ストレージが無効な環境では、HTTPキャッシュのみで動作させる。
  }
}

async function loadManifest(): Promise<{ manifest: StoreManifest; isFallback: boolean }> {
  try {
    const response = await fetch(STORE_MANIFEST_PATH, { cache: 'no-store' });
    if (!response.ok) throw new Error('更新情報を取得できませんでした。');
    const manifest: unknown = await response.json();
    if (!isStoreManifest(manifest)) throw new Error('更新情報の形式が正しくありません。');
    saveManifest(manifest);
    return { manifest, isFallback: false };
  } catch (error) {
    const savedManifest = readSavedManifest();
    if (savedManifest) return { manifest: savedManifest, isFallback: true };
    throw error;
  }
}

async function loadDataset(manifest: StoreManifest): Promise<StoreDataset> {
  const request = new Request(manifest.datasetPath);
  if (!('caches' in window)) {
    const response = await fetch(request);
    if (!response.ok) throw new Error('店舗データの読み込みに失敗しました。');
    return response.json() as Promise<StoreDataset>;
  }

  const cache = await window.caches.open(STORE_CACHE_NAME);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse.json() as Promise<StoreDataset>;

  const response = await fetch(request);
  if (!response.ok) throw new Error('店舗データの読み込みに失敗しました。');
  await cache.put(request, response.clone());

  const cacheKeys = await cache.keys();
  await Promise.all(cacheKeys
    .filter((cacheKey) => cacheKey.url !== request.url)
    .map((cacheKey) => cache.delete(cacheKey)));

  return response.json() as Promise<StoreDataset>;
}

export default function Home() {
  const [stores, setStores] = useState<Store[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArea, setSelectedArea] = useState<Area>('すべて');
  const [selectedGenres, setSelectedGenres] = useState<Set<GenreFilter>>(() => new Set());
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLocating, setIsLocating] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isPinning, setIsPinning] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [sourceSnapshot, setSourceSnapshot] = useState('');
  const [mapBounds, setMapBounds] = useState<google.maps.LatLngBoundsLiteral | null>(null);
  const [geocodeRevision, setGeocodeRevision] = useState(0);
  const resultMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const markerClustererRef = useRef<MarkerClusterer | null>(null);
  const focusedMarkerRef = useRef<google.maps.Marker | null>(null);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const geocodeCacheRef = useRef<Map<string, google.maps.LatLngLiteral>>(new Map());

  useEffect(() => {
    let isMounted = true;

    async function initializeStoreData() {
      try {
        // マニフェストは毎回確認し、バージョン付きデータはCache Storageから再利用する。
        const { manifest, isFallback } = await loadManifest();
        const data = await loadDataset(manifest);
        if (!isMounted) return;
        setStores(data.stores);
        setSourceSnapshot(data.sourceSnapshot);
        if (isFallback) {
          setLocationMessage('接続できないため、端末に保存された店舗データを表示しています。');
        }
      } catch (error: unknown) {
        console.error(error);
        if (isMounted) setLocationMessage('店舗データを読み込めませんでした。時間をおいて再度お試しください。');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void initializeStoreData();
    return () => { isMounted = false; };
  }, []);

  const filteredStores = useMemo(() => {
    const keyword = searchQuery.trim().toLocaleLowerCase('ja-JP');
    return stores.filter((store) => {
      const isInArea = selectedArea === 'すべて' || store.area === selectedArea;
      const isKeywordMatch = !keyword || [store.name, store.address, store.city, store.genre]
        .some((value) => value.toLocaleLowerCase('ja-JP').includes(keyword));
      const isGenreMatch = selectedGenres.size === 0 || GENRE_FILTERS.some(
        (genreFilter) => selectedGenres.has(genreFilter.id) && genreFilter.categories.includes(store.genre),
      );
      return isInArea && isKeywordMatch && isGenreMatch;
    });
  }, [searchQuery, selectedArea, selectedGenres, stores]);

  const storesMatchingAreaAndKeyword = useMemo(() => {
    const keyword = searchQuery.trim().toLocaleLowerCase('ja-JP');
    return stores.filter((store) => {
      const isInArea = selectedArea === 'すべて' || store.area === selectedArea;
      const isKeywordMatch = !keyword || [store.name, store.address, store.city, store.genre]
        .some((value) => value.toLocaleLowerCase('ja-JP').includes(keyword));
      return isInArea && isKeywordMatch;
    });
  }, [searchQuery, selectedArea, stores]);

  const genreCounts = useMemo(() => new Map(
    GENRE_FILTERS.map((genreFilter) => [
      genreFilter.id,
      storesMatchingAreaAndKeyword.filter((store) => genreFilter.categories.includes(store.genre)).length,
    ]),
  ), [storesMatchingAreaAndKeyword]);

  const mapPinStores = useMemo(() => filteredStores.slice(0, LIST_LIMIT), [filteredStores]);

  const visibleStores = useMemo(() => {
    if (!mapBounds || geocodeRevision === 0) return mapPinStores;
    return mapPinStores.filter((store) => {
      const position = geocodeCacheRef.current.get(store.id);
      return position ? isPositionInBounds(position, mapBounds) : true;
    });
  }, [geocodeRevision, mapBounds, mapPinStores]);

  const clearResultMarkers = useCallback(() => {
    markerClustererRef.current?.clearMarkers();
    markerClustererRef.current = null;
    resultMarkersRef.current.forEach((marker) => marker.setMap(null));
    resultMarkersRef.current.clear();
    infoWindowRef.current?.close();
  }, []);

  const clearFocusedMarker = useCallback(() => {
    focusedMarkerRef.current?.setMap(null);
    focusedMarkerRef.current = null;
  }, []);

  const toggleGenre = useCallback((genre: GenreFilter) => {
    setSelectedGenres((previous) => {
      const next = new Set(previous);
      if (next.has(genre)) {
        next.delete(genre);
      } else {
        next.add(genre);
      }
      return next;
    });
    setSelectedStore(null);
    clearResultMarkers();
  }, [clearResultMarkers]);

  const clearGenres = useCallback(() => {
    setSelectedGenres(new Set());
    setSelectedStore(null);
    clearResultMarkers();
  }, [clearResultMarkers]);

  const showArea = useCallback((area: Area) => {
    setSelectedArea(area);
    setSelectedStore(null);
    clearResultMarkers();
    if (!map) return;
    if (area === 'すべて') {
      map.setCenter(DEFAULT_CENTER);
      map.setZoom(9);
      return;
    }
    map.setCenter(AREA_CENTERS[area]);
    map.setZoom(area === '大阪市' || area === '京都市' ? 11 : 13);
  }, [clearResultMarkers, map]);

  const geocodeStore = useCallback((store: Store): Promise<google.maps.LatLngLiteral> => {
    const cachedPosition = geocodeCacheRef.current.get(store.id);
    if (cachedPosition) return Promise.resolve(cachedPosition);
    return new Promise((resolve, reject) => {
      const geocoder = geocoderRef.current;
      if (!geocoder) {
        reject(new Error('地図の準備中です。'));
        return;
      }
      geocoder.geocode({ address: store.address }, (results, status) => {
        if (status === 'OK' && results?.[0]) {
          const location = results[0].geometry.location;
          const position = { lat: location.lat(), lng: location.lng() };
          geocodeCacheRef.current.set(store.id, position);
          resolve(position);
          return;
        }
        reject(new Error(`住所を地図上で特定できませんでした（${status}）。`));
      });
    });
  }, []);

  const showStoreOnMap = useCallback(async (store: Store) => {
    setSelectedStore(store);
    setLocationMessage('');
    if (!map) {
      setLocationMessage('地図を準備しています。少しお待ちください。');
      return;
    }
    setIsGeocoding(true);
    clearFocusedMarker();
    try {
      const position = await geocodeStore(store);
      const resultMarker = resultMarkersRef.current.get(store.id);
      if (resultMarker) {
        resultMarker.setAnimation(google.maps.Animation.BOUNCE);
        window.setTimeout(() => resultMarker.setAnimation(null), 700);
      } else {
        focusedMarkerRef.current = new google.maps.Marker({
          position,
          map,
          title: store.name,
          icon: createGenrePinIcon(GENRE_PIN_COLORS[getGenreFilterForStore(store)]),
          zIndex: 1000,
        });
      }
      map.setCenter(position);
      map.setZoom(17);
    } catch (error) {
      console.error(error);
      setLocationMessage('この店舗の住所を地図上で特定できませんでした。住所をご確認ください。');
    } finally {
      setIsGeocoding(false);
    }
  }, [clearFocusedMarker, geocodeStore, map]);

  const resolveCurrentArea = useCallback((position: google.maps.LatLngLiteral) => {
    const geocoder = geocoderRef.current;
    if (!geocoder) return;
    geocoder.geocode({ location: position }, (results, status) => {
      if (status !== 'OK' || !results?.[0]) {
        setLocationMessage('現在地を地図に表示しました。エリアを選択して店舗を絞り込めます。');
        return;
      }
      const address = results[0].formatted_address;
      const detectedArea = (['京都市', '大阪市', '茨木市', '高槻市'] as const)
        .find((area) => address.includes(area));
      if (detectedArea) {
        setSelectedArea(detectedArea);
        setLocationMessage(`現在地を表示し、${detectedArea}の公式掲載店舗に絞り込みました。`);
      } else {
        setLocationMessage('現在地を表示しました。対象4地域のエリアを選択して店舗を絞り込めます。');
      }
    });
  }, []);

  const handleGetLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationMessage('この端末では現在地取得を利用できません。');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const position = { lat: coords.latitude, lng: coords.longitude };
        if (map) {
          map.setCenter(position);
          map.setZoom(15);
          userMarkerRef.current?.setMap(null);
          userMarkerRef.current = new google.maps.Marker({
            position,
            map,
            title: '現在地',
            icon: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png',
          });
        }
        resolveCurrentArea(position);
        setIsLocating(false);
      },
      () => {
        setLocationMessage('現在地を取得できませんでした。端末の位置情報設定をご確認ください。');
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [map, resolveCurrentArea]);

  const handleMapReady = useCallback((mapInstance: google.maps.Map) => {
    setMap(mapInstance);
    geocoderRef.current = new google.maps.Geocoder();
    infoWindowRef.current = new google.maps.InfoWindow();
    mapInstance.setCenter(DEFAULT_CENTER);
    mapInstance.setZoom(10);
  }, []);

  useEffect(() => {
    if (!map) return;
    const updateMapBounds = () => {
      const bounds = map.getBounds();
      if (!bounds) return;
      const northEast = bounds.getNorthEast();
      const southWest = bounds.getSouthWest();
      setMapBounds({ north: northEast.lat(), east: northEast.lng(), south: southWest.lat(), west: southWest.lng() });
    };
    updateMapBounds();
    const idleListener = map.addListener('idle', updateMapBounds);
    return () => idleListener.remove();
  }, [map]);

  useEffect(() => {
    if (!map || !geocoderRef.current) return;

    let isCancelled = false;
    clearResultMarkers();
    clearFocusedMarker();
    setIsPinning(mapPinStores.length > 0);

    async function createResultPins() {
      let nextIndex = 0;
      const workerCount = Math.min(2, mapPinStores.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (!isCancelled) {
          const store = mapPinStores[nextIndex];
          nextIndex += 1;
          if (!store) return;
          try {
            const position = await geocodeStore(store);
            if (isCancelled) return;
            const genre = getGenreFilterForStore(store);
            const marker = new google.maps.Marker({
              position,
              title: `${store.name}（${genre}）`,
              icon: createGenrePinIcon(GENRE_PIN_COLORS[genre]),
            });
            marker.addListener('click', () => {
              infoWindowRef.current?.setContent(createStoreInfoContent(store, genre, () => setSelectedStore(store)));
              infoWindowRef.current?.open({ map, anchor: marker, shouldFocus: false });
            });
            resultMarkersRef.current.set(store.id, marker);
            await new Promise((resolve) => window.setTimeout(resolve, 120));
          } catch (error) {
            console.warn('店舗ピンを表示できませんでした。', store.id, error);
          }
        }
      });
      await Promise.all(workers);
      if (!isCancelled) {
        markerClustererRef.current = new MarkerClusterer({ map, markers: Array.from(resultMarkersRef.current.values()) });
        setGeocodeRevision((revision) => revision + 1);
        setIsPinning(false);
      }
    }

    void createResultPins();
    return () => {
      isCancelled = true;
      clearResultMarkers();
    };
  }, [clearFocusedMarker, clearResultMarkers, geocodeStore, map, mapPinStores]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex flex-col">
      <header className="bg-white shadow-sm border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-6 h-6 text-blue-600 flex-shrink-0" />
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">COIN+ ストア マップ</h1>
          </div>
          <p className="text-xs sm:text-sm text-gray-600 ml-8">京都市・大阪市・茨木市・高槻市のCOIN+利用可能店舗を検索</p>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 h-full">
          <aside className="lg:col-span-1 space-y-4 flex flex-col min-h-[45vh] lg:min-h-0">
            <Card className="shadow-md border-0">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">店舗検索</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                  <Input
                    aria-label="店舗名・住所・ジャンルで検索"
                    placeholder="店舗名・住所・ジャンルで検索"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="pl-9"
                  />
                </div>
                <label className="block text-xs font-medium text-gray-600" htmlFor="area-filter">対象エリア</label>
                <select
                  id="area-filter"
                  aria-label="対象エリア"
                  value={selectedArea}
                  onChange={(event) => showArea(event.target.value as Area)}
                  className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                >
                  {AREA_OPTIONS.map((area) => <option key={area} value={area}>{area}</option>)}
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
                  <p className="mt-1 text-[11px] leading-4 text-gray-500">件数は現在のエリア・キーワード条件に連動します。複数選択したジャンルはいずれかに該当する店舗を表示します。</p>
                  <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="ジャンルを複数選択">
                    {GENRE_FILTERS.map((genreFilter) => {
                      const isSelected = selectedGenres.has(genreFilter.id);
                      return (
                        <button
                          key={genreFilter.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => toggleGenre(genreFilter.id)}
                          className={`min-h-9 rounded-md border px-2 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                            isSelected
                              ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                              : 'border-blue-200 bg-blue-50/60 text-blue-800 hover:border-blue-400 hover:bg-blue-100'
                          }`}
                        >
                          <span className="truncate">{genreFilter.label}</span>
                          <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${isSelected ? 'bg-white/20 text-white' : 'bg-white text-blue-700'}`}>
                            {genreCounts.get(genreFilter.id)?.toLocaleString() ?? 0}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Button onClick={handleGetLocation} disabled={isLocating} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                  {isLocating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LocateFixed className="w-4 h-4 mr-2" />}
                  現在地のエリアを表示
                </Button>
                {locationMessage && <p className="text-xs leading-5 text-blue-700 bg-blue-50 rounded-md px-3 py-2">{locationMessage}</p>}
              </CardContent>
            </Card>

            <Card className="shadow-md border-0 flex-1 flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">店舗一覧 <span className="text-sm font-normal text-gray-500">(地図範囲内 {visibleStores.length.toLocaleString()}件)</span></CardTitle>
                {filteredStores.length > LIST_LIMIT && <p className="text-xs text-gray-500 pt-1">検索結果の先頭{LIST_LIMIT}件を地図に表示しています。地図を動かすと一覧も更新されます。</p>}
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden flex flex-col">
                <div className="space-y-2 overflow-y-auto flex-1 pr-2 max-h-[52vh] lg:max-h-[calc(100vh-315px)]">
                  {loading ? (
                    <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-600" /></div>
                  ) : visibleStores.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-8">該当する店舗がありません。</p>
                  ) : visibleStores.map((store) => (
                    <button
                      key={store.id}
                      onClick={() => showStoreOnMap(store)}
                      className={`w-full text-left p-3 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${selectedStore?.id === store.id ? 'bg-blue-100 border-l-4 border-blue-600' : 'hover:bg-gray-50 border-l-4 border-transparent'}`}
                    >
                      <p className="font-semibold text-sm text-gray-900 truncate">{store.name}</p>
                      <p className="text-xs text-gray-600 truncate">{store.address}</p>
                      <p className="text-xs text-blue-600 font-medium mt-1">{store.genre}・{store.city}</p>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </aside>

          <section className="lg:col-span-2 min-h-[52vh] lg:min-h-0" aria-label="店舗マップ">
            <Card className="shadow-md border-0 h-full overflow-hidden">
              <CardContent className="p-0 h-full relative">
                <MapView onMapReady={handleMapReady} className="w-full h-full rounded-lg" initialZoom={10} initialCenter={DEFAULT_CENTER} />
                {isGeocoding && <div className="absolute top-3 left-3 z-10 bg-white/95 shadow rounded-md px-3 py-2 text-xs text-blue-700 flex items-center"><Loader2 className="w-4 h-4 mr-2 animate-spin" />店舗を地図に表示中</div>}
                <div className="absolute top-3 right-3 z-10 max-w-[calc(100%-1.5rem)] rounded-lg border border-white/80 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800"><MapPin className="w-3.5 h-3.5 text-blue-600" />検索結果の{mapPinStores.length}件をピン表示</p>
                  <p className="mt-1 text-[11px] text-slate-600">地図範囲内: {visibleStores.length}件</p>
                  {isPinning && <p className="mt-1 flex items-center gap-1 text-[11px] text-blue-700"><Loader2 className="w-3 h-3 animate-spin" />住所からピンを作成中</p>}
                </div>
                <div className="absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-lg border border-white/80 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm" aria-label="ピンのジャンル別凡例">
                  <p className="mb-1 text-[10px] font-semibold tracking-wide text-slate-500">ジャンル別ピン</p>
                  <div className="flex max-w-[310px] flex-wrap gap-x-2.5 gap-y-1">
                    {GENRE_FILTERS.map((genreFilter) => <span key={genreFilter.id} className="flex items-center gap-1 text-[10px] text-slate-700"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: GENRE_PIN_COLORS[genreFilter.id] }} />{genreFilter.label}</span>)}
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>
      </main>

      {selectedStore && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="店舗詳細">
          <div className="bg-white w-full sm:max-w-md rounded-t-lg sm:rounded-lg shadow-lg animate-in slide-in-from-bottom sm:slide-in-from-center">
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-start gap-4">
                <div><h2 className="text-xl font-bold text-gray-900">{selectedStore.name}</h2><p className="text-sm text-blue-600 font-medium mt-1">{selectedStore.genre}</p></div>
                <button onClick={() => setSelectedStore(null)} className="text-gray-400 hover:text-gray-600" aria-label="閉じる"><X className="w-5 h-5" /></button>
              </div>
              <div className="space-y-2 border-t border-gray-200 pt-4">
                <p className="text-sm text-gray-600"><span className="font-semibold">住所:</span> {selectedStore.address}</p>
                <p className="text-sm text-gray-600"><span className="font-semibold">市区町村:</span> {selectedStore.city}</p>
              </div>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedStore.name} ${selectedStore.address}`)}`}
                target="_blank"
                rel="noreferrer"
                className="flex h-10 w-full items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-4 text-sm font-medium text-blue-700 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Google Mapsで開く
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
              <Button onClick={() => setSelectedStore(null)} className="w-full bg-slate-700 hover:bg-slate-800 text-white">閉じる</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
