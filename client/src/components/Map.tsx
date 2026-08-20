/**
 * Design: OpenStreetMapを明確な帰属表示とともに表示する、APIキー不要のLeaflet地図基盤。
 */
import { useEffect } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { LatLngBounds, LatLngExpression, Map as LeafletMap } from 'leaflet';
import { cn } from '@/lib/utils';
import 'leaflet/dist/leaflet.css';

interface MapLifecycleProps {
  onMapReady?: (map: LeafletMap) => void;
  onBoundsChange?: (bounds: LatLngBounds) => void;
}

function MapLifecycle({ onMapReady, onBoundsChange }: MapLifecycleProps) {
  const map = useMap();
  useMapEvents({
    moveend: () => onBoundsChange?.(map.getBounds()),
  });

  useEffect(() => {
    onMapReady?.(map);
    onBoundsChange?.(map.getBounds());
  }, [map, onBoundsChange, onMapReady]);

  return null;
}

interface MapViewProps {
  className?: string;
  initialCenter?: LatLngExpression;
  initialZoom?: number;
  onMapReady?: (map: LeafletMap) => void;
  onBoundsChange?: (bounds: LatLngBounds) => void;
  children?: React.ReactNode;
}

export function MapView({
  className,
  initialCenter = [34.842, 135.62],
  initialZoom = 10,
  onMapReady,
  onBoundsChange,
  children,
}: MapViewProps) {
  return (
    <MapContainer center={initialCenter} zoom={initialZoom} className={cn('h-[500px] w-full', className)} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapLifecycle onMapReady={onMapReady} onBoundsChange={onBoundsChange} />
      {children}
    </MapContainer>
  );
}
