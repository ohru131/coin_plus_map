import { useEffect, useState } from 'react';
import { MapView } from '@/components/Map';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapPin, Search, Loader2, Navigation, X } from 'lucide-react';

interface Store {
  name: string;
  address: string;
  lat: number;
  lng: number;
  genre: string;
  city: string;
}

export default function Home() {
  const [stores, setStores] = useState<Store[]>([]);
  const [filteredStores, setFilteredStores] = useState<Store[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [markers, setMarkers] = useState<google.maps.Marker[]>([]);
  const [loading, setLoading] = useState(true);

  // Load store data
  useEffect(() => {
    fetch('/stores.json')
      .then(res => res.json())
      .then(data => {
        setStores(data);
        setFilteredStores(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load stores:', err);
        setLoading(false);
      });
  }, []);

  // Get user location
  const handleGetLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation({ lat: latitude, lng: longitude });
          if (map) {
            map.setCenter({ lat: latitude, lng: longitude });
            map.setZoom(15);
          }
        },
        (error) => {
          console.error('Geolocation error:', error);
          alert('現在地を取得できませんでした');
        }
      );
    }
  };

  // Handle search
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.trim() === '') {
      setFilteredStores(stores);
    } else {
      const filtered = stores.filter(store =>
        store.name.toLowerCase().includes(query.toLowerCase()) ||
        store.address.toLowerCase().includes(query.toLowerCase()) ||
        store.genre.toLowerCase().includes(query.toLowerCase())
      );
      setFilteredStores(filtered);
    }
  };

  // Handle map ready
  const handleMapReady = (mapInstance: google.maps.Map) => {
    setMap(mapInstance);
    mapInstance.setCenter({ lat: 34.9, lng: 135.6 });
    mapInstance.setZoom(10);
  };

  // Update markers when filtered stores change
  useEffect(() => {
    if (!map) return;

    // Clear existing markers
    markers.forEach(marker => marker.setMap(null));

    // Create new markers
    const newMarkers = filteredStores.map(store => {
      const marker = new google.maps.Marker({
        position: { lat: store.lat, lng: store.lng },
        map: map,
        title: store.name,
      });

      marker.addListener('click', () => {
        setSelectedStore(store);
      });

      return marker;
    });

    setMarkers(newMarkers);

    // Add user location marker if available
    if (userLocation) {
      const userMarker = new google.maps.Marker({
        position: userLocation,
        map: map,
        title: '現在地',
        icon: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png',
      });
      newMarkers.push(userMarker);
    }
  }, [map, filteredStores, userLocation]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-6 h-6 text-blue-600 flex-shrink-0" />
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">COIN+ ストア マップ</h1>
          </div>
          <p className="text-xs sm:text-sm text-gray-600 ml-8">大阪茨木市・京都市のCOIN+利用可能店舗を検索</p>
        </div>
      </div>

      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 h-full">
          {/* Left Panel - Search & List */}
          <div className="lg:col-span-1 space-y-4 flex flex-col">
            {/* Search Box */}
            <Card className="shadow-md border-0">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">店舗検索</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="店舗名・住所・ジャンルで検索"
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Button
                  onClick={handleGetLocation}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Navigation className="w-4 h-4 mr-2" />
                  現在地から検索
                </Button>
              </CardContent>
            </Card>

            {/* Store List */}
            <Card className="shadow-md border-0 flex-1 flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  店舗一覧 ({filteredStores.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden flex flex-col">
                <div className="space-y-2 overflow-y-auto flex-1 pr-2">
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                    </div>
                  ) : filteredStores.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">
                      該当する店舗がありません
                    </p>
                  ) : (
                    filteredStores.map((store, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedStore(store)}
                        className={`w-full text-left p-3 rounded-lg transition-all ${
                          selectedStore?.name === store.name
                            ? 'bg-blue-100 border-l-4 border-blue-600'
                            : 'hover:bg-gray-50 border-l-4 border-transparent'
                        }`}
                      >
                        <p className="font-semibold text-sm text-gray-900 truncate">
                          {store.name}
                        </p>
                        <p className="text-xs text-gray-600 truncate">{store.address}</p>
                        <p className="text-xs text-blue-600 font-medium mt-1">{store.genre}</p>
                      </button>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Panel - Map */}
          <div className="lg:col-span-2">
            <Card className="shadow-md border-0 h-full">
              <CardContent className="p-0 h-full">
                <MapView
                  onMapReady={handleMapReady}
                  className="w-full h-full rounded-lg"
                  initialZoom={10}
                  initialCenter={{ lat: 34.9, lng: 135.6 }}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Store Detail Modal */}
      {selectedStore && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end z-50 sm:items-center sm:justify-center">
          <div className="bg-white w-full sm:max-w-md rounded-t-lg sm:rounded-lg shadow-lg animate-in slide-in-from-bottom sm:slide-in-from-center">
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{selectedStore.name}</h2>
                  <p className="text-sm text-blue-600 font-medium mt-1">{selectedStore.genre}</p>
                </div>
                <button
                  onClick={() => setSelectedStore(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-2 border-t border-gray-200 pt-4">
                <p className="text-sm text-gray-600">
                  <span className="font-semibold">住所:</span> {selectedStore.address}
                </p>
                <p className="text-sm text-gray-600">
                  <span className="font-semibold">市区町村:</span> {selectedStore.city}
                </p>
              </div>
              <Button
                onClick={() => setSelectedStore(null)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                閉じる
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
