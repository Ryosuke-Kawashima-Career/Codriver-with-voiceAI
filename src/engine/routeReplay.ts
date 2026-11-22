import type { Landmark, Maneuver, Region, RouteData } from '../types';

export interface NavZoneSettings {
  directionsZoneBeforeM: number; // Default 900 m before turn
  directionsZoneAfterM: number; // Default 100 m after turn
  announceEarlyM: number; // Default 800 m before turn
  announceFinalM: number; // Default 100 m before turn
  minGapForEarlyAnnounceM: number; // Default 900 m gap from previous maneuver (Spec 5.1)
  prefetchAheadM: number; // Default 3000 m lookahead for maneuver audio caching (Spec 5.1)
  landmarkTriggerBeforeM: number; // Default 2000 m before landmark
  gpsSnapBehindM: number; // Default 200 m behind car (Spec 5.1)
  gpsSnapAheadM: number; // Default 3000 m ahead of car (Spec 5.1)
  gpsMaxOffRouteM: number; // Default 100 m off-route ignore threshold (Spec 5.1)
}

export const DEFAULT_NAV_SETTINGS: NavZoneSettings = {
  directionsZoneBeforeM: 900,
  directionsZoneAfterM: 100,
  announceEarlyM: 800,
  announceFinalM: 100,
  minGapForEarlyAnnounceM: 900,
  prefetchAheadM: 3000,
  landmarkTriggerBeforeM: 2000,
  gpsSnapBehindM: 200,
  gpsSnapAheadM: 3000,
  gpsMaxOffRouteM: 100,
};

// Base highway cruise speed at 1x speed (~80 km/h = 22.2 m/s)
export const BASE_SPEED_MPS = 22.2;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(meters: number): string {
  const clamped = Math.max(0, Math.round(meters));
  if (clamped >= 1000) {
    const km = clamped / 1000;
    return km >= 10 ? `${km.toFixed(0)} km` : `${km.toFixed(1)} km`;
  }
  if (clamped >= 100) {
    return `${Math.round(clamped / 10) * 10} m`;
  }
  return `${clamped} m`;
}

export function isInDirectionsFirstZone(
  route: RouteData | null,
  progressM: number,
  settings: NavZoneSettings = DEFAULT_NAV_SETTINGS
): Maneuver | null {
  if (!route) return null;
  for (const m of route.maneuvers) {
    if (
      progressM >= m.at_m - settings.directionsZoneBeforeM &&
      progressM <= m.at_m + settings.directionsZoneAfterM
    ) {
      return m;
    }
  }
  return null;
}

export function getNextManeuver(route: RouteData | null, progressM: number): Maneuver | null {
  if (!route) return null;
  for (const m of route.maneuvers) {
    if (m.at_m >= progressM - 30) {
      return m;
    }
  }
  return route.maneuvers[route.maneuvers.length - 1] ?? null;
}

export function getCurrentRegion(route: RouteData | null, progressM: number): Region | null {
  if (!route) return null;
  let current: Region | null = null;
  for (const r of route.regions) {
    if (progressM >= r.enter_at_m) {
      current = r;
    }
  }
  return current;
}

export function getNextLandmark(route: RouteData | null, progressM: number): Landmark | null {
  if (!route) return null;
  return route.landmarks.find((lm) => lm.at_m > progressM + 100) ?? null;
}

export function getNextRegion(route: RouteData | null, progressM: number): Region | null {
  if (!route) return null;
  return route.regions.find((r) => r.enter_at_m > progressM + 50) ?? null;
}

/**
 * Computes cumulative geodesic meter distances at every vertex of route.path.
 */
export function computeCumulativeRouteDistances(route: RouteData): number[] {
  const pts = route.path;
  if (pts.length === 0) return [];
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + haversineMeters(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  }
  const rawTotal = cum[cum.length - 1] || 1;
  const scale = route.length_m > 0 ? route.length_m / rawTotal : 1;
  return cum.map((d) => d * scale);
}

/**
 * Spec 5.1 GPS Snapping:
 * Snaps a GPS fix to the nearest point along the route within [progressM - 200m, progressM + 3000m].
 * Ignores fixes > 100m away from the route line and only moves progress forward.
 */
export function snapGpsFixToRoute(
  route: RouteData,
  cumDistances: number[],
  currentProgressM: number,
  lat: number,
  lon: number,
  settings: NavZoneSettings = DEFAULT_NAV_SETTINGS
): { snappedProgressM: number; offRouteMeters: number } | null {
  const pts = route.path;
  if (pts.length < 2 || cumDistances.length !== pts.length) return null;

  const minWindow = Math.max(0, currentProgressM - settings.gpsSnapBehindM);
  const maxWindow = Math.min(route.length_m, currentProgressM + settings.gpsSnapAheadM);

  let bestDist = Infinity;
  let bestProgress = currentProgressM;

  for (let i = 0; i < pts.length; i++) {
    const dAlong = cumDistances[i];
    if (dAlong < minWindow || dAlong > maxWindow) continue;
    const distToFix = haversineMeters(lat, lon, pts[i][0], pts[i][1]);
    if (distToFix < bestDist) {
      bestDist = distToFix;
      bestProgress = dAlong;
    }
  }

  if (bestDist > settings.gpsMaxOffRouteM) {
    return null;
  }

  return {
    snappedProgressM: Math.max(currentProgressM, bestProgress),
    offRouteMeters: Math.round(bestDist),
  };
}

/**
 * Interpolates [lat, lon] and compass heading along the route polyline for a given progress_m.
 */
export function interpolateRoutePoint(
  route: RouteData,
  progressM: number,
  cumDistances?: number[]
): { lat: number; lon: number; fraction: number; angleDeg: number; headingCompassDeg: number } {
  const pts = route.path;
  if (pts.length === 0) {
    return { lat: 0, lon: 0, fraction: 0, angleDeg: 0, headingCompassDeg: 0 };
  }
  if (pts.length === 1) {
    return { lat: pts[0][0], lon: pts[0][1], fraction: 0, angleDeg: 0, headingCompassDeg: 0 };
  }

  const cum = cumDistances && cumDistances.length === pts.length
    ? cumDistances
    : computeCumulativeRouteDistances(route);

  const totalLen = Math.max(1, cum[cum.length - 1] || route.length_m);
  const targetM = Math.max(0, Math.min(totalLen, progressM));
  const fraction = targetM / totalLen;

  // Binary search for segment containing targetM
  let lo = 0;
  let hi = cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= targetM) lo = mid;
    else hi = mid - 1;
  }

  const i = lo;
  const segStart = cum[i];
  const segEnd = cum[i + 1];
  const segLen = segEnd - segStart;
  const localT = segLen > 0 ? Math.max(0, Math.min(1, (targetM - segStart) / segLen)) : 0;

  const lat = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * localT;
  const lon = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * localT;

  const dx = pts[i + 1][1] - pts[i][1];
  const dy = -(pts[i + 1][0] - pts[i][0]);
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  // Compass heading (0 = North, 90 = East, 180 = South, 270 = West)
  const headingCompassDeg = (angleDeg + 90 + 360) % 360;

  return { lat, lon, fraction, angleDeg, headingCompassDeg };
}

export interface RouteStepEvents {
  maneuversToPrefetch: Maneuver[];
  maneuvers800: Maneuver[];
  maneuvers100: Maneuver[];
  landmarksDue: Landmark[];
  landmarksPassed: Landmark[];
  regionsEntered: Region[];
  completed: boolean;
}

export interface FiredRouteTriggers {
  maneuverPrefetched: Set<string>;
  maneuver800: Set<string>;
  maneuver100: Set<string>;
  landmarkDue: Set<string>;
  landmarkPassed: Set<string>;
  regionEntered: Set<string>;
}

export function createFiredTriggers(): FiredRouteTriggers {
  return {
    maneuverPrefetched: new Set(),
    maneuver800: new Set(),
    maneuver100: new Set(),
    landmarkDue: new Set(),
    landmarkPassed: new Set(),
    regionEntered: new Set(),
  };
}

export function syncTriggersForJump(
  route: RouteData,
  targetProgressM: number,
  fired: FiredRouteTriggers,
  settings: NavZoneSettings = DEFAULT_NAV_SETTINGS
) {
  for (const m of route.maneuvers) {
    if (m.at_m - settings.announceEarlyM < targetProgressM - 50) {
      fired.maneuver800.add(m.id);
    } else {
      fired.maneuver800.delete(m.id);
    }
    if (m.at_m - settings.announceFinalM < targetProgressM - 50) {
      fired.maneuver100.add(m.id);
    } else {
      fired.maneuver100.delete(m.id);
    }
  }
  for (const lm of route.landmarks) {
    if (lm.at_m - settings.landmarkTriggerBeforeM < targetProgressM - 150) {
      fired.landmarkDue.add(lm.id);
    } else {
      fired.landmarkDue.delete(lm.id);
    }
    if (lm.at_m < targetProgressM) {
      fired.landmarkPassed.add(lm.id);
    } else {
      fired.landmarkPassed.delete(lm.id);
    }
  }
  for (const r of route.regions) {
    if (r.enter_at_m < targetProgressM) {
      fired.regionEntered.add(r.id);
    } else {
      fired.regionEntered.delete(r.id);
    }
  }
}

export function collectRouteEvents(
  route: RouteData,
  progressM: number,
  fired: FiredRouteTriggers,
  settings: NavZoneSettings = DEFAULT_NAV_SETTINGS
): RouteStepEvents {
  const maneuversToPrefetch: Maneuver[] = [];
  const maneuvers800: Maneuver[] = [];
  const maneuvers100: Maneuver[] = [];
  const landmarksDue: Landmark[] = [];
  const landmarksPassed: Landmark[] = [];
  const regionsEntered: Region[] = [];

  for (let i = 0; i < route.maneuvers.length; i++) {
    const m = route.maneuvers[i];
    const prevM = i > 0 ? route.maneuvers[i - 1] : null;
    const dist = m.at_m - progressM;

    // Spec 5.1: pre-cache maneuver audio when ~3 km away
    if (dist <= settings.prefetchAheadM && dist > 0 && !fired.maneuverPrefetched.has(m.id)) {
      fired.maneuverPrefetched.add(m.id);
      maneuversToPrefetch.push(m);
    }

    // Spec 5.1: skip the 800 m sentence if previous maneuver was < 900 m earlier
    const hasRoomFor800 = !prevM || m.at_m - prevM.at_m >= settings.minGapForEarlyAnnounceM;
    if (
      hasRoomFor800 &&
      dist <= settings.announceEarlyM &&
      dist > settings.announceFinalM &&
      !fired.maneuver800.has(m.id)
    ) {
      fired.maneuver800.add(m.id);
      maneuvers800.push(m);
    }

    if (dist <= settings.announceFinalM && dist >= -80 && !fired.maneuver100.has(m.id)) {
      fired.maneuver100.add(m.id);
      fired.maneuver800.add(m.id);
      maneuvers100.push(m);
    }
  }

  for (const lm of route.landmarks) {
    const dist = lm.at_m - progressM;
    if (dist <= settings.landmarkTriggerBeforeM && dist > 100 && !fired.landmarkDue.has(lm.id)) {
      fired.landmarkDue.add(lm.id);
      landmarksDue.push(lm);
    }
    if (progressM >= lm.at_m && !fired.landmarkPassed.has(lm.id)) {
      fired.landmarkPassed.add(lm.id);
      landmarksPassed.push(lm);
    }
  }

  for (const r of route.regions) {
    if (progressM >= r.enter_at_m && !fired.regionEntered.has(r.id)) {
      fired.regionEntered.add(r.id);
      regionsEntered.push(r);
    }
  }

  return {
    maneuversToPrefetch,
    maneuvers800,
    maneuvers100,
    landmarksDue,
    landmarksPassed,
    regionsEntered,
    completed: progressM >= route.length_m,
  };
}
