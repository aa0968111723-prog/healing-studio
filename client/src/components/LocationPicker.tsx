/**
 * LocationPicker — pick a shoot location for a calendar event.
 *
 * Wraps `MapView` and adds:
 *   - A search box with Google Places Autocomplete (Place id + display name).
 *   - Click-to-place marker fallback with reverse geocoding for the address.
 *   - Emits a stable `{ name, address?, lat, lng, placeId? }` payload via
 *     `onChange`, matching the schedule.location schema on the server.
 */

/// <reference types="@types/google.maps" />

import { useCallback, useEffect, useRef, useState } from "react";
import { MapView } from "@/components/Map";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MapPin, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ScheduleLocation = {
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
};

interface LocationPickerProps {
  value?: ScheduleLocation | null;
  onChange: (loc: ScheduleLocation | null) => void;
  className?: string;
}

export function LocationPicker({ value, onChange, className }: LocationPickerProps) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [query, setQuery] = useState(value?.name ?? "");

  // Keep input in sync if value is cleared / replaced from outside.
  useEffect(() => {
    setQuery(value?.name ?? "");
  }, [value?.name]);

  const placeMarker = useCallback(
    (loc: google.maps.LatLngLiteral, label?: string) => {
      const map = mapRef.current;
      if (!map || !window.google) return;
      if (markerRef.current) {
        markerRef.current.map = null;
      }
      markerRef.current = new window.google.maps.marker.AdvancedMarkerElement({
        map,
        position: loc,
        title: label,
      });
      map.panTo(loc);
      if ((map.getZoom() ?? 0) < 14) map.setZoom(15);
    },
    []
  );

  const reverseGeocode = useCallback(
    async (loc: google.maps.LatLngLiteral): Promise<string | undefined> => {
      if (!window.google) return undefined;
      const geocoder = new window.google.maps.Geocoder();
      try {
        const result = await geocoder.geocode({ location: loc });
        return result.results[0]?.formatted_address;
      } catch {
        return undefined;
      }
    },
    []
  );

  const handleMapReady = useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map;

      if (value?.lat != null && value?.lng != null) {
        placeMarker({ lat: value.lat, lng: value.lng }, value.name);
      }

      map.addListener("click", async (e: google.maps.MapMouseEvent) => {
        const latLng = e.latLng;
        if (!latLng) return;
        const lat = latLng.lat();
        const lng = latLng.lng();
        const address = await reverseGeocode({ lat, lng });
        const next: ScheduleLocation = {
          name: address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          address,
          lat,
          lng,
        };
        placeMarker({ lat, lng }, next.name);
        setQuery(next.name);
        onChange(next);
      });

      // Wire up the Places autocomplete once the script is loaded.
      if (searchInputRef.current && window.google?.maps?.places) {
        autocompleteRef.current = new window.google.maps.places.Autocomplete(
          searchInputRef.current,
          { fields: ["place_id", "name", "formatted_address", "geometry"] }
        );
        autocompleteRef.current.bindTo("bounds", map);
        autocompleteRef.current.addListener("place_changed", () => {
          const place = autocompleteRef.current?.getPlace();
          if (!place?.geometry?.location) return;
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          const next: ScheduleLocation = {
            name: place.name ?? place.formatted_address ?? "選定地點",
            address: place.formatted_address ?? undefined,
            lat,
            lng,
            placeId: place.place_id ?? undefined,
          };
          placeMarker({ lat, lng }, next.name);
          setQuery(next.name);
          onChange(next);
        });
      }
    },
    [onChange, placeMarker, reverseGeocode, value?.lat, value?.lng, value?.name]
  );

  const clear = () => {
    if (markerRef.current) {
      markerRef.current.map = null;
      markerRef.current = null;
    }
    setQuery("");
    onChange(null);
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
        <Input
          ref={searchInputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜尋外拍地點（地址、地標、店名）"
          className="pl-7 pr-8 text-xs bg-card/5 border-white/10"
        />
        {value && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-card/10 text-muted-foreground/60 hover:text-red-400"
            aria-label="清除地點"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <MapView
        className="h-[260px] rounded-lg overflow-hidden border border-white/10"
        initialCenter={
          value?.lat != null && value?.lng != null
            ? { lat: value.lat, lng: value.lng }
            : { lat: 25.0339, lng: 121.5645 } // 預設台北
        }
        initialZoom={value?.lat != null ? 15 : 12}
        onMapReady={handleMapReady}
      />

      {value && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[11px] flex items-start gap-1.5">
          <MapPin className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground/90 truncate">{value.name}</p>
            {value.address && value.address !== value.name && (
              <p className="text-muted-foreground/70 truncate">{value.address}</p>
            )}
            {value.lat != null && value.lng != null && (
              <p className="text-muted-foreground/40 tabular-nums">
                {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
              </p>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
            onClick={() => {
              if (value.lat != null && value.lng != null) {
                window.open(
                  `https://www.google.com/maps/dir/?api=1&destination=${value.lat},${value.lng}`,
                  "_blank",
                  "noopener"
                );
              }
            }}
          >
            導航
          </Button>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/50">
        在地圖上點擊任一處可放置標記，或用上方搜尋框找地點。
      </p>
    </div>
  );
}
