import { useMemo } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { LanguageCode, Maneuver, PassedStop, RouteData } from '../types';
import {
  computeCumulativeRouteDistances,
  formatDistance,
  interpolateRoutePoint,
} from '../engine/routeReplay';

interface RouteMapSvgProps {
  route: RouteData;
  language: LanguageCode;
  progressM: number;
  nextManeuver: Maneuver | null;
  isDirectionsFirst: boolean;
  directionsFirstLabel: string;
  landmarksPassed: PassedStop[];
}

const VIEW_W = 640;
const VIEW_H = 300;
const PAD_X = 48;
const PAD_Y = 38;

export function RouteMapSvg({
  route,
  language,
  progressM,
  nextManeuver,
  isDirectionsFirst,
  directionsFirstLabel,
  landmarksPassed,
}: RouteMapSvgProps) {
  const cumDistances = useMemo(() => computeCumulativeRouteDistances(route), [route]);

  const projection = useMemo(() => {
    const lats = route.path.map((p) => p[0]);
    const lons = route.path.map((p) => p[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    const latSpan = Math.max(0.01, maxLat - minLat);
    const lonSpan = Math.max(0.01, maxLon - minLon);

    const usableW = VIEW_W - PAD_X * 2;
    const usableH = VIEW_H - PAD_Y * 2;

    const scale = Math.min(usableW / lonSpan, usableH / latSpan);
    const offsetX = PAD_X + (usableW - lonSpan * scale) / 2;
    const offsetY = PAD_Y + (usableH - latSpan * scale) / 2;

    const project = (lat: number, lon: number): [number, number] => {
      const x = offsetX + (lon - minLon) * scale;
      const y = offsetY + (maxLat - lat) * scale;
      return [x, y];
    };

    const points = route.path.map(([lat, lon]) => project(lat, lon));
    const stride = Math.max(1, Math.floor(points.length / 260));
    const sampled = points.filter((_, idx) => idx % stride === 0 || idx === points.length - 1);
    const polylineAttr = sampled.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

    return { project, points, polylineAttr };
  }, [route]);

  const car = useMemo(() => {
    const interp = interpolateRoutePoint(route, progressM, cumDistances);
    const [x, y] = projection.project(interp.lat, interp.lon);
    return { x, y, angleDeg: interp.angleDeg };
  }, [cumDistances, projection, progressM, route]);

  const completedPolyline = useMemo(() => {
    if (projection.points.length < 2) return '';
    const out: string[] = [];
    const stride = Math.max(1, Math.floor(projection.points.length / 220));
    for (let i = 0; i < projection.points.length; i += stride) {
      if (cumDistances[i] <= progressM) {
        const [x, y] = projection.points[i];
        out.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      } else {
        break;
      }
    }
    out.push(`${car.x.toFixed(1)},${car.y.toFixed(1)}`);
    return out.join(' ');
  }, [car, cumDistances, progressM, projection.points]);

  const nextTurnPoint = useMemo(() => {
    if (!nextManeuver) return null;
    const interp = interpolateRoutePoint(route, nextManeuver.at_m, cumDistances);
    const [x, y] = projection.project(interp.lat, interp.lon);
    return { x, y };
  }, [cumDistances, nextManeuver, projection, route]);

  const landmarkMarkers = useMemo(() => {
    const statusMap: Record<string, PassedStop> = {};
    for (const l of landmarksPassed) statusMap[l.id] = l;
    return route.landmarks.map((lm) => {
      const [x, y] = projection.project(lm.lat, lm.lon);
      const status = statusMap[lm.id];
      return {
        id: lm.id,
        label: lm.name[language] || lm.name['en-IN'],
        x,
        y,
        passed: progressM >= lm.at_m,
        answered: Boolean(status?.answeredCorrectly),
      };
    });
  }, [landmarksPassed, language, progressM, projection, route]);

  const remainingM = Math.max(0, route.length_m - progressM);

  return (
    <div
      className="relative w-full h-full min-h-[190px] rounded-2xl bg-slate-50 border border-slate-200 overflow-hidden select-none"
      aria-label="Route navigation map"
    >
      {isDirectionsFirst && (
        <div
          role="status"
          className="absolute top-3 left-3 z-20 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white px-2.5 py-1 text-xs font-semibold shadow-sm"
        >
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          <span className="whitespace-nowrap">{directionsFirstLabel}</span>
        </div>
      )}

      <div className="absolute top-3 right-3 z-10 flex items-center gap-2 text-xs text-slate-600 font-mono tabular-nums bg-white/92 border border-slate-200 px-2.5 py-1 rounded-lg">
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

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full block"
      >
        <defs>
          <pattern id="safar-grid-light" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(15, 23, 42, 0.06)" strokeWidth="1" />
          </pattern>
        </defs>

        <rect width={VIEW_W} height={VIEW_H} fill="url(#safar-grid-light)" />

        <polyline
          points={projection.polylineAttr}
          fill="none"
          stroke="rgba(100, 116, 139, 0.25)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={projection.polylineAttr}
          fill="none"
          stroke="#94A3B8"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {completedPolyline && (
          <polyline
            points={completedPolyline}
            fill="none"
            stroke="#059669"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {landmarkMarkers.map((lm, idx) => {
          const offsetY = idx % 2 === 0 ? -12 : 18;
          return (
            <g key={lm.id} transform={`translate(${lm.x}, ${lm.y})`}>
              <circle
                r="5.5"
                fill={lm.answered ? '#059669' : lm.passed ? '#94A3B8' : '#D97706'}
                stroke="#FFFFFF"
                strokeWidth="2"
              />
              <text
                x="0"
                y={offsetY}
                textAnchor="middle"
                fill="#1E293B"
                fontSize="10"
                fontWeight="600"
              >
                {lm.label}
              </text>
            </g>
          );
        })}

        {nextTurnPoint && (
          <g transform={`translate(${nextTurnPoint.x}, ${nextTurnPoint.y})`}>
            <circle
              r="8"
              fill={isDirectionsFirst ? 'rgba(5, 150, 105, 0.2)' : 'rgba(2, 132, 199, 0.16)'}
              stroke={isDirectionsFirst ? '#059669' : '#0284C7'}
              strokeWidth="1.5"
            />
            <circle r="3" fill={isDirectionsFirst ? '#059669' : '#0284C7'} />
          </g>
        )}

        <g transform={`translate(${car.x.toFixed(1)}, ${car.y.toFixed(1)}) rotate(${car.angleDeg.toFixed(1)})`}>
          <circle r="11" fill="rgba(5, 150, 105, 0.18)" />
          <path
            d="M 9 0 L -6 6.2 L -3.2 0 L -6 -6.2 Z"
            fill="#059669"
            stroke="#FFFFFF"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </div>
  );
}
