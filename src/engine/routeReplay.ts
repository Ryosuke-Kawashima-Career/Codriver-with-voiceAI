import type { Landmark, Maneuver, Region, RouteData } from '../types';

export interface NavZoneSettings {
  directionsZoneBeforeM: number; // Default 900 m before turn
  directionsZoneAfterM: number; // Default 100 m after turn
  announceEarlyM: number; // Default 800 m before turn
  announceFinalM: number; // Default 100 m before turn
  landmarkTriggerBeforeM: number; // Default 2000 m before landmark
}

export const DEFAULT_NAV_SETTINGS: NavZoneSettings = {
  directionsZoneBeforeM: 900,
  directionsZoneAfterM: 100,
  announceEarlyM: 800,
  announceFinalM: 100,
  landmarkTriggerBeforeM: 2000,
};

// Base highway cruise speed at 1x speed (~80 km/h = 22.2 m/s)
export const BASE_SPEED_MPS = 22.2;

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
 * Interpolates [lat, lon] and heading angle along the route polyline for a given progress_m.
 */
export function interpolateRoutePoint(
  route: RouteData,
  progressM: number
): { lat: number; lon: number; fraction: number; angleDeg: number } {
  const pts = route.path;
  if (pts.length === 0) return { lat: 0, lon: 0, fraction: 0, angleDeg: 0 };
  if (pts.length === 1) return { lat: pts[0][0], lon: pts[0][1], fraction: 0, angleDeg: 0 };

  // Compute cumulative Euclidean segment lengths in coordinate space
  const segLengths: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dLat = pts[i + 1][0] - pts[i][0];
    const dLon = pts[i + 1][1] - pts[i][1];
    const seg = Math.hypot(dLat, dLon);
    segLengths.push(seg);
    totalLen += seg;
  }

  const fraction = Math.max(0, Math.min(1, progressM / Math.max(1, route.length_m)));
  const targetLen = fraction * totalLen;

  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const seg = segLengths[i];
    if (acc + seg >= targetLen || i === segLengths.length - 1) {
      const localT = seg > 0 ? Math.max(0, Math.min(1, (targetLen - acc) / seg)) : 0;
      const lat = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * localT;
      const lon = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * localT;
      // SVG Y increases downward while latitude increases upward
      const dx = pts[i + 1][1] - pts[i][1];
      const dy = -(pts[i + 1][0] - pts[i][0]);
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      return { lat, lon, fraction, angleDeg };
    }
    acc += seg;
  }

  const last = pts[pts.length - 1];
  return { lat: last[0], lon: last[1], fraction: 1, angleDeg: 0 };
}

export interface RouteStepEvents {
  maneuvers800: Maneuver[];
  maneuvers100: Maneuver[];
  landmarksDue: Landmark[];
  landmarksPassed: Landmark[];
  regionsEntered: Region[];
  completed: boolean;
}

export interface FiredRouteTriggers {
  maneuver800: Set<string>;
  maneuver100: Set<string>;
  landmarkDue: Set<string>;
  landmarkPassed: Set<string>;
  regionEntered: Set<string>;
}

export function createFiredTriggers(): FiredRouteTriggers {
  return {
    maneuver800: new Set(),
    maneuver100: new Set(),
    landmarkDue: new Set(),
    landmarkPassed: new Set(),
    regionEntered: new Set(),
  };
}

/**
 * Marks triggers already behind a jump point as fired so jumping forward
 * doesn't flood old announcements, while keeping the upcoming target fresh.
 */
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
  const maneuvers800: Maneuver[] = [];
  const maneuvers100: Maneuver[] = [];
  const landmarksDue: Landmark[] = [];
  const landmarksPassed: Landmark[] = [];
  const regionsEntered: Region[] = [];

  for (const m of route.maneuvers) {
    const dist = m.at_m - progressM;
    if (dist <= settings.announceEarlyM && dist > settings.announceFinalM && !fired.maneuver800.has(m.id)) {
      fired.maneuver800.add(m.id);
      maneuvers800.push(m);
    }
    if (dist <= settings.announceFinalM && dist >= -80 && !fired.maneuver100.has(m.id)) {
      fired.maneuver100.add(m.id);
      // Avoid firing 800m after 100m
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
    maneuvers800,
    maneuvers100,
    landmarksDue,
    landmarksPassed,
    regionsEntered,
    completed: progressM >= route.length_m,
  };
}
