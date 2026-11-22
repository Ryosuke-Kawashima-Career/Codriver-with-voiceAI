import { useMemo } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { LanguageCode, Maneuver, PassedStop, RouteData } from '../types';
import { formatDistance, interpolateRoutePoint } from '../engine/routeReplay';

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

    // Fit preserving aspect ratio cleanly
    const scale = Math.min(usableW / lonSpan, usableH / latSpan);
    const offsetX = PAD_X + (usableW - lonSpan * scale) / 2;
    const offsetY = PAD_Y + (usableH - latSpan * scale) / 2;

    const project = (lat: number, lon: number): [number, number] => {
      const x = offsetX + (lon - minLon) * scale;
      const y = offsetY + (maxLat - lat) * scale;
      return [x, y];
    };

    const points = route.path.map(([lat, lon]) => project(lat, lon));
    const polylineAttr = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

    return { project, points, polylineAttr };
  }, [route]);

  const car = useMemo(() => {
    const interp = interpolateRoutePoint(route, progressM);
    const [x, y] = projection.project(interp.lat, interp.lon);
    return { x, y, angleDeg: interp.angleDeg, fraction: interp.fraction };
  }, [projection, progressM, route]);

  // Build completed route path up to car position
  const completedPolyline = useMemo(() => {
    const pts = route.path;
    if (pts.length < 2) return '';
    const segLengths: number[] = [];
    let totalLen = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      segLengths.push(seg);
      totalLen += seg;
    }
    const targetLen = car.fraction * totalLen;
    const out: string[] = [];
    let acc = 0;
    for (let i = 0; i < segLengths.length; i++) {
      const [x0, y0] = projection.points[i];
      if (i === 0) out.push(`${x0.toFixed(1)},${y0.toFixed(1)}`);
      if (acc + segLengths[i] <= targetLen) {
        const [x1, y1] = projection.points[i + 1];
        out.push(`${x1.toFixed(1)},${y1.toFixed(1)}`);
        acc += segLengths[i];
      } else {
        out.push(`${car.x.toFixed(1)},${car.y.toFixed(1)}`);
        break;
      }
    }
    return out.join(' ');
  }, [car, projection.points, route.path]);

  const nextTurnPoint = useMemo(() => {
    if (!nextManeuver) return null;
    const interp = interpolateRoutePoint(route, nextManeuver.at_m);
    const [x, y] = projection.project(interp.lat, interp.lon);
    return { x, y };
  }, [nextManeuver, projection, route]);

  const regionMarkers = useMemo(() => {
    return route.regions.map((r) => {
      const interp = interpolateRoutePoint(route, r.enter_at_m);
      const [x, y] = projection.project(interp.lat, interp.lon);
      return {
        id: r.id,
        label: r.name[language] || r.name['en-IN'],
        x,
        y,
        passed: progressM >= r.enter_at_m,
      };
    });
  }, [language, progressM, projection, route]);

  const landmarkMarkers = useMemo(() => {
    const statusMap = new Map(landmarksPassed.map((l) => [l.id, l]));
    return route.landmarks.map((lm) => {
      const [x, y] = projection.project(lm.lat, lm.lon);
      const status = statusMap.get(lm.id);
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

  const startPt = projection.points[0];
  const endPt = projection.points[projection.points.length - 1];
  const remainingM = Math.max(0, route.length_m - progressM);

  return (
    <div
      className="relative w-full h-full min-h-[168px] rounded-2xl bg-[#111621] border border-white/[0.08] overflow-hidden select-none"
      aria-label="Route navigation map"
    >
      {/* Directions-first active chip (Section 5.2) */}
      {isDirectionsFirst && (
        <div
          role="status"
          className="absolute top-3 left-3 z-20 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 px-2.5 py-1 text-xs font-semibold text-emerald-200 backdrop-blur-sm"
        >
          <ShieldAlert className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
          <span className="whitespace-nowrap">{directionsFirstLabel}</span>
        </div>
      )}

      {/* Quiet unboxed distance remaining readout */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums bg-[#0B0E14]/75 px-2.5 py-1 rounded-lg backdrop-blur-sm">
        <span className="text-slate-200 font-medium">{formatDistance(progressM)}</span>
        <span aria-hidden="true">/</span>
        <span>{formatDistance(route.length_m)}</span>
        <span aria-hidden="true" className="hidden sm:inline">
          ·
        </span>
        <span className="hidden sm:inline text-emerald-400">{formatDistance(remainingM)} left</span>
      </div>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full block"
      >
        <defs>
          <pattern id="safar-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path
              d="M 32 0 L 0 0 0 32"
              fill="none"
              stroke="rgba(148, 163, 184, 0.06)"
              strokeWidth="1"
            />
          </pattern>
          <filter id="car-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width={VIEW_W} height={VIEW_H} fill="url(#safar-grid)" />

        {/* Subtle road corridor halo */}
        <polyline
          points={projection.polylineAttr}
          fill="none"
          stroke="rgba(148, 163, 184, 0.14)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Remaining route line */}
        <polyline
          points={projection.polylineAttr}
          fill="none"
          stroke="#334155"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Completed route track */}
        {completedPolyline && (
          <polyline
            points={completedPolyline}
            fill="none"
            stroke="#10B981"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Region boundary ticks */}
        {regionMarkers.map((r) => (
          <g key={r.id} transform={`translate(${r.x}, ${r.y})`}>
            <circle
              r="11"
              fill="none"
              stroke={r.passed ? '#10B981' : '#64748B'}
              strokeWidth="1.25"
              strokeDasharray="3 3"
              opacity="0.7"
            />
            <text
              x="15"
              y="4"
              fill={r.passed ? '#A7F3D0' : '#94A3B8'}
              fontSize="10"
              fontWeight="500"
            >
              {r.label}
            </text>
          </g>
        ))}

        {/* Start and end terminal markers */}
        {startPt && (
          <g transform={`translate(${startPt[0]}, ${startPt[1]})`}>
            <circle r="5" fill="#10B981" stroke="#0B0E14" strokeWidth="2" />
            <text x="10" y="4" fill="#CBD5E1" fontSize="10.5" fontWeight="600">
              BLR
            </text>
          </g>
        )}
        {endPt && (
          <g transform={`translate(${endPt[0]}, ${endPt[1]})`}>
            <circle r="5.5" fill="#F59E0B" stroke="#0B0E14" strokeWidth="2" />
            <text x="-34" y="4" fill="#FDE68A" fontSize="10.5" fontWeight="600">
              MYS
            </text>
          </g>
        )}

        {/* Landmark pins */}
        {landmarkMarkers.map((lm, idx) => {
          const offsetY = idx % 2 === 0 ? -13 : 19;
          return (
            <g key={lm.id} transform={`translate(${lm.x}, ${lm.y})`}>
              <circle
                r="5.5"
                fill={lm.answered ? '#10B981' : lm.passed ? '#64748B' : '#F59E0B'}
                stroke="#0B0E14"
                strokeWidth="2"
              />
              <text
                x="0"
                y={offsetY}
                textAnchor="middle"
                fill={lm.answered ? '#A7F3D0' : '#E2E8F0'}
                fontSize="9.5"
                fontWeight="500"
              >
                {lm.label}
              </text>
            </g>
          );
        })}

        {/* Next turn marker */}
        {nextTurnPoint && (
          <g transform={`translate(${nextTurnPoint.x}, ${nextTurnPoint.y})`}>
            <circle
              r="9"
              fill={isDirectionsFirst ? 'rgba(16, 185, 129, 0.25)' : 'rgba(56, 189, 248, 0.16)'}
              stroke={isDirectionsFirst ? '#34D399' : '#38BDF8'}
              strokeWidth="1.5"
            />
            <circle r="3" fill={isDirectionsFirst ? '#34D399' : '#38BDF8'} />
          </g>
        )}

        {/* Moving car marker */}
        <g
          transform={`translate(${car.x.toFixed(1)}, ${car.y.toFixed(1)}) rotate(${car.angleDeg.toFixed(1)})`}
          filter="url(#car-glow)"
        >
          <circle r="11" fill="rgba(16, 185, 129, 0.2)" />
          <path
            d="M 9 0 L -6 6.2 L -3.2 0 L -6 -6.2 Z"
            fill="#F8FAFC"
            stroke="#10B981"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </div>
  );
}
