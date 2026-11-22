import { useEffect, useMemo, useRef } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  useMap,
} from '@vis.gl/react-google-maps';
import { Check, MapPin, ShieldAlert } from 'lucide-react';
import type { LanguageCode, Maneuver, PassedStop, RouteData } from '../types';
import {
  computeCumulativeRouteDistances,
  formatDistance,
  interpolateRoutePoint,
} from '../engine/routeReplay';
import { RouteMapSvg } from './RouteMapSvg';

interface GoogleRouteMapProps {
  apiKey: string;
  route: RouteData;
  language: LanguageCode;
  progressM: number;
  nextManeuver: Maneuver | null;
  isDirectionsFirst: boolean;
  directionsFirstLabel: string;
  landmarksPassed: PassedStop[];
}

interface RouteOverlayProps {
  route: RouteData;
  cumDistances: number[];
  carPosition: { lat: number; lng: number };
  progressM: number;
}

function RoutePolylineOverlay({
  route,
  cumDistances,
  carPosition,
  progressM,
}: RouteOverlayProps) {
  const map = useMap();
  const baseLineRef = useRef<google.maps.Polyline | null>(null);
  const drivenLineRef = useRef<google.maps.Polyline | null>(null);
  const lastPanAtRef = useRef(0);
  const hasFittedBoundsRef = useRef(false);

  const fullPathLatLng = useMemo(
    () => route.path.map(([lat, lng]) => ({ lat, lng })),
    [route.path]
  );

  // Create/update the full remaining route polyline and fit initial bounds
  useEffect(() => {
    if (!map || fullPathLatLng.length === 0) return;

    const baseLine = new google.maps.Polyline({
      path: fullPathLatLng,
      strokeColor: '#64748B',
      strokeOpacity: 0.72,
      strokeWeight: 5,
      zIndex: 1,
      map,
    });
    baseLineRef.current = baseLine;

    const drivenLine = new google.maps.Polyline({
      path: [fullPathLatLng[0]],
      strokeColor: '#059669',
      strokeOpacity: 0.95,
      strokeWeight: 6,
      zIndex: 2,
      map,
    });
    drivenLineRef.current = drivenLine;

    if (!hasFittedBoundsRef.current) {
      hasFittedBoundsRef.current = true;
      const bounds = new google.maps.LatLngBounds();
      const stride = Math.max(1, Math.floor(fullPathLatLng.length / 80));
      for (let i = 0; i < fullPathLatLng.length; i += stride) {
        bounds.extend(fullPathLatLng[i]);
      }
      bounds.extend(fullPathLatLng[fullPathLatLng.length - 1]);
      map.fitBounds(bounds, 44);
    }

    return () => {
      baseLine.setMap(null);
      drivenLine.setMap(null);
      baseLineRef.current = null;
      drivenLineRef.current = null;
      hasFittedBoundsRef.current = false;
    };
  }, [fullPathLatLng, map]);

  // Update driven track segment and gently pan camera to follow moving car
  useEffect(() => {
    if (!map || !drivenLineRef.current || fullPathLatLng.length === 0) return;

    const drivenPts: google.maps.LatLngLiteral[] = [];
    for (let i = 0; i < fullPathLatLng.length; i++) {
      if (cumDistances[i] <= progressM) {
        drivenPts.push(fullPathLatLng[i]);
      } else {
        break;
      }
    }
    drivenPts.push(carPosition);
    drivenLineRef.current.setPath(drivenPts);

    const now = performance.now();
    if (progressM > 20 && now - lastPanAtRef.current > 450) {
      lastPanAtRef.current = now;
      if ((map.getZoom() ?? 10) < 12) {
        map.setZoom(13);
      }
      map.panTo(carPosition);
    }
  }, [carPosition, cumDistances, fullPathLatLng, map, progressM]);

  return null;
}

export function GoogleRouteMap({
  apiKey,
  route,
  language,
  progressM,
  nextManeuver,
  isDirectionsFirst,
  directionsFirstLabel,
  landmarksPassed,
}: GoogleRouteMapProps) {
  const cumDistances = useMemo(() => computeCumulativeRouteDistances(route), [route]);

  const car = useMemo(() => {
    const interp = interpolateRoutePoint(route, progressM, cumDistances);
    return {
      lat: interp.lat,
      lng: interp.lon,
      headingCompassDeg: interp.headingCompassDeg,
    };
  }, [cumDistances, progressM, route]);

  const nextTurnPosition = useMemo(() => {
    if (!nextManeuver) return null;
    const interp = interpolateRoutePoint(route, nextManeuver.at_m, cumDistances);
    return { lat: interp.lat, lng: interp.lon };
  }, [cumDistances, nextManeuver, route]);

  // Avoid global Map constructor shadowing: use plain object dictionary Record<string, PassedStop>
  const passedLookup = useMemo(() => {
    const dict: Record<string, PassedStop> = {};
    for (const item of landmarksPassed) {
      dict[item.id] = item;
    }
    return dict;
  }, [landmarksPassed]);

  // Fallback cleanly to Light-Mode offline SVG map if no Google Maps API key is configured
  if (!apiKey) {
    return (
      <RouteMapSvg
        route={route}
        language={language}
        progressM={progressM}
        nextManeuver={nextManeuver}
        isDirectionsFirst={isDirectionsFirst}
        directionsFirstLabel={directionsFirstLabel}
        landmarksPassed={landmarksPassed}
      />
    );
  }

  const startCenter = route.path[0]
    ? { lat: route.path[0][0], lng: route.path[0][1] }
    : { lat: 12.9716, lng: 77.5946 };

  const remainingM = Math.max(0, route.length_m - progressM);

  return (
    <div
      className="relative w-full h-full min-h-[190px] rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden select-none"
      aria-label="Google Maps route navigation view"
    >
      {/* Directions-first active chip (Spec 5.2) */}
      {isDirectionsFirst && (
        <div
          role="status"
          className="absolute top-3 left-3 z-20 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white px-2.5 py-1 text-xs font-semibold shadow-sm"
        >
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="whitespace-nowrap">{directionsFirstLabel}</span>
        </div>
      )}

      {/* Quiet distance readout */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2 text-xs text-slate-600 font-mono tabular-nums bg-white/92 border border-slate-200/80 px-2.5 py-1 rounded-lg shadow-sm backdrop-blur-sm">
        <span className="text-slate-900 font-semibold">{formatDistance(progressM)}</span>
        <span aria-hidden="true">/</span>
        <span>{formatDistance(route.length_m)}</span>
        <span aria-hidden="true" className="hidden sm:inline">
          ·
        </span>
        <span className="hidden sm:inline text-emerald-700 font-medium">
          {formatDistance(remainingM)} left
        </span>
      </div>

      <APIProvider
        apiKey={apiKey}
        language={language.split('-')[0]}
        region="IN"
      >
        <GoogleMap
          style={{ width: '100%', height: '100%' }}
          defaultCenter={startCenter}
          defaultZoom={11}
          mapId="DEMO_MAP_ID"
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          disableDefaultUI
          gestureHandling="cooperative"
        >
          <RoutePolylineOverlay
            route={route}
            cumDistances={cumDistances}
            carPosition={{ lat: car.lat, lng: car.lng }}
            progressM={progressM}
          />

          {/* Curated Landmark Pins */}
          {route.landmarks.map((lm) => {
            const status = passedLookup[lm.id];
            const answered = Boolean(status?.answeredCorrectly);
            const passed = progressM >= lm.at_m;
            const label = lm.name[language] || lm.name['en-IN'];
            return (
              <AdvancedMarker
                key={lm.id}
                position={{ lat: lm.lat, lng: lm.lon }}
                title={label}
                zIndex={10}
              >
                <div className="flex flex-col items-center">
                  <div
                    className={`w-7 h-7 rounded-full border-2 border-white shadow-md flex items-center justify-center ${
                      answered
                        ? 'bg-emerald-600 text-white'
                        : passed
                          ? 'bg-slate-400 text-white'
                          : 'bg-amber-500 text-white'
                    }`}
                  >
                    {answered ? (
                      <Check className="w-3.5 h-3.5 stroke-[2.75]" aria-hidden="true" />
                    ) : (
                      <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                  </div>
                  <span className="mt-0.5 px-1.5 py-0.5 rounded bg-white/95 border border-slate-200 text-[10px] font-semibold text-slate-800 shadow-xs whitespace-nowrap max-w-[110px] truncate">
                    {label}
                  </span>
                </div>
              </AdvancedMarker>
            );
          })}

          {/* Next Turn Marker */}
          {nextTurnPosition && (
            <AdvancedMarker position={nextTurnPosition} title="Next turn" zIndex={15}>
              <div
                className={`w-5 h-5 rounded-full border-2 border-white shadow-md flex items-center justify-center ${
                  isDirectionsFirst ? 'bg-emerald-600' : 'bg-sky-600'
                }`}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-white" />
              </div>
            </AdvancedMarker>
          )}

          {/* Moving Car Marker */}
          <AdvancedMarker position={{ lat: car.lat, lng: car.lng }} title="Your car" zIndex={30}>
            <div
              className="w-9 h-9 rounded-full bg-white border-2 border-emerald-600 shadow-lg flex items-center justify-center"
              style={{ transform: `rotate(${car.headingCompassDeg.toFixed(0)}deg)` }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 1.5L13.5 13.5L8 10.6L2.5 13.5L8 1.5Z" fill="#059669" />
              </svg>
            </div>
          </AdvancedMarker>
        </GoogleMap>
      </APIProvider>
    </div>
  );
}
