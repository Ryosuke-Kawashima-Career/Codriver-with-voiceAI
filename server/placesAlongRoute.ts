/**
 * Server-only module: discovers cities, towns, and state crossings along a driving route
 * (Spec 3.2: Overpass API primary with 15 s timeout, Nominatim reverse-lookup fallback)
 * and provides reverse geocoding for the user's live GPS coordinates.
 */

export type SupportedLang = 'en-IN' | 'hi-IN' | 'ta-IN';

export interface DiscoveredLandmark {
  id: string;
  name: Record<SupportedLang, string>;
  rawName: string;
  at_m: number;
  lat: number;
  lon: number;
  question_id: string;
  source: 'osm';
  placeKind: 'town' | 'taluk';
}

export interface DiscoveredRegion {
  id: string;
  name: Record<SupportedLang, string>;
  rawName: string;
  enter_at_m: number;
  lat: number;
  lon: number;
  welcome: Record<SupportedLang, string>;
  greeting: Record<SupportedLang, string>;
  question_id: string;
  source: 'osm';
  placeKind: 'city' | 'state';
}

export interface ExistingPlaceRef {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
  at_m?: number;
}

export interface DiscoverPlacesResult {
  landmarks: DiscoveredLandmark[];
  regions: DiscoveredRegion[];
  source: 'overpass' | 'nominatim' | 'none';
  durationMs: number;
  errors: string[];
}

export interface ReverseGeocodeResult {
  name: string;
  locality: string;
  region: string;
  state: string;
  address: string;
  provider: 'google-places' | 'nominatim' | 'coordinates';
}

const NOMINATIM_USER_AGENT = 'SafarVoiceCoDriverMVP/1.0 (roadtrip-quiz-hackathon)';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

let lastNominatimAt = 0;

async function waitNominatimSlot(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastNominatimAt;
  if (elapsed < 1050) {
    await new Promise((r) => setTimeout(r, 1050 - elapsed));
  }
  lastNominatimAt = Date.now();
}

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

function normalizePlaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(district|taluk|tehsil|city|town|municipality|urban|rural)\b/g, '')
    .replace(/[^a-z0-9\u0900-\u097f\u0b80-\u0bff]+/g, ' ')
    .trim();
}

function slugifyPlace(name: string): string {
  const ascii = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return ascii.slice(0, 36) || `place_${Math.abs(hashString(name))}`;
}

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return h;
}

function buildDefaultLocalizedName(raw: string): Record<SupportedLang, string> {
  return { 'en-IN': raw, 'hi-IN': raw, 'ta-IN': raw };
}

function buildDefaultWelcome(raw: string): Record<SupportedLang, string> {
  return {
    'en-IN': `Welcome to ${raw}.`,
    'hi-IN': `${raw} में आपका स्वागत है।`,
    'ta-IN': `${raw} பகுதிக்கு வரவேற்கிறோம்.`,
  };
}

function buildDefaultGreeting(): Record<SupportedLang, string> {
  return {
    'en-IN': 'Namaste!',
    'hi-IN': 'नमस्ते!',
    'ta-IN': 'வணக்கம்!',
  };
}

function computeCumulativeDistances(pathCoords: [number, number][]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < pathCoords.length; i++) {
    cum.push(
      cum[i - 1] +
        haversineMeters(
          pathCoords[i - 1][0],
          pathCoords[i - 1][1],
          pathCoords[i][0],
          pathCoords[i][1]
        )
    );
  }
  return cum;
}

function projectOntoRoute(
  pathCoords: [number, number][],
  cumDist: number[],
  lat: number,
  lon: number
): { minDistM: number; atM: number } {
  const stride = Math.max(1, Math.floor(pathCoords.length / 450));
  let minDistM = Infinity;
  let atM = 0;

  for (let i = 0; i < pathCoords.length; i += stride) {
    const d = haversineMeters(pathCoords[i][0], pathCoords[i][1], lat, lon);
    if (d < minDistM) {
      minDistM = d;
      atM = cumDist[i];
    }
  }
  const lastIdx = pathCoords.length - 1;
  const dLast = haversineMeters(pathCoords[lastIdx][0], pathCoords[lastIdx][1], lat, lon);
  if (dLast < minDistM) {
    minDistM = dLast;
    atM = cumDist[lastIdx];
  }
  return { minDistM, atM };
}

function pointAtDistance(
  pathCoords: [number, number][],
  cumDist: number[],
  targetM: number
): [number, number] {
  if (targetM <= 0) return pathCoords[0];
  const total = cumDist[cumDist.length - 1] || 0;
  if (targetM >= total) return pathCoords[pathCoords.length - 1];

  let lo = 0;
  let hi = cumDist.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cumDist[mid] <= targetM) lo = mid;
    else hi = mid;
  }
  const span = cumDist[hi] - cumDist[lo];
  const frac = span > 0 ? (targetM - cumDist[lo]) / span : 0;
  return [
    pathCoords[lo][0] + (pathCoords[hi][0] - pathCoords[lo][0]) * frac,
    pathCoords[lo][1] + (pathCoords[hi][1] - pathCoords[lo][1]) * frac,
  ];
}

interface RawCandidate {
  rawName: string;
  lat: number;
  lon: number;
  atM: number;
  kind: 'city' | 'town' | 'state' | 'taluk';
}

function conflictsWithCurated(
  cand: RawCandidate,
  existing: ExistingPlaceRef[]
): boolean {
  const normCand = normalizePlaceName(cand.rawName);
  for (const ex of existing) {
    if (normCand && normalizePlaceName(ex.name) === normCand) {
      return true;
    }
    if (typeof ex.lat === 'number' && typeof ex.lon === 'number') {
      if (haversineMeters(cand.lat, cand.lon, ex.lat, ex.lon) <= 5000) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Selects up to `maxCount` candidates spread evenly along the route,
 * avoiding duplicates and places already covered by curated entries.
 */
function selectSpreadCandidates(
  candidates: RawCandidate[],
  existing: ExistingPlaceRef[],
  totalLengthM: number,
  maxCount = 8
): RawCandidate[] {
  const sorted = [...candidates]
    .filter((c) => c.atM >= 1500 && c.atM <= Math.max(2000, totalLengthM - 500))
    .sort((a, b) => a.atM - b.atM);

  const deduped: RawCandidate[] = [];
  const seenNames = new Set<string>();

  for (const cand of sorted) {
    const norm = normalizePlaceName(cand.rawName);
    if (!norm || seenNames.has(norm)) continue;
    if (conflictsWithCurated(cand, existing)) continue;
    // Skip if another already-kept candidate is within 4 km along the route
    if (deduped.some((kept) => Math.abs(kept.atM - cand.atM) < 4000)) continue;
    seenNames.add(norm);
    deduped.push(cand);
  }

  if (deduped.length <= maxCount) {
    return deduped;
  }

  // Spread up to maxCount evenly across route buckets
  const chosen: RawCandidate[] = [];
  const bucketSize = totalLengthM / maxCount;
  for (let b = 0; b < maxCount; b++) {
    const start = b * bucketSize;
    const end = (b + 1) * bucketSize;
    const inBucket = deduped.filter((c) => c.atM >= start && c.atM < end);
    if (inBucket.length > 0) {
      // Prefer state/city first, then middle of bucket
      const preferred =
        inBucket.find((c) => c.kind === 'state') ??
        inBucket.find((c) => c.kind === 'city') ??
        inBucket[Math.floor(inBucket.length / 2)];
      chosen.push(preferred);
    }
  }

  if (chosen.length < maxCount) {
    const chosenIds = new Set(chosen.map((c) => normalizePlaceName(c.rawName)));
    for (const c of deduped) {
      if (chosen.length >= maxCount) break;
      const norm = normalizePlaceName(c.rawName);
      if (!chosenIds.has(norm)) {
        chosenIds.add(norm);
        chosen.push(c);
      }
    }
  }

  return chosen.sort((a, b) => a.atM - b.atM);
}

/**
 * Source 1: Overpass API query for place=city and place=town nodes in route bounding box,
 * kept if within 3 km of the route (15 s timeout).
 */
async function queryOverpassAlongRoute(
  pathCoords: [number, number][],
  cumDist: number[]
): Promise<{ candidates: RawCandidate[]; error?: string }> {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const [lat, lon] of pathCoords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  // Pad bbox slightly (~3 km ≈ 0.03 deg)
  const pad = 0.03;
  const south = (minLat - pad).toFixed(4);
  const west = (minLon - pad).toFixed(4);
  const north = (maxLat + pad).toFixed(4);
  const east = (maxLon + pad).toFixed(4);

  const query = `[out:json][timeout:12];(node["place"~"^(city|town)$"](${south},${west},${north},${east}););out body;`;

  let lastError = 'Overpass request failed';
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': NOMINATIM_USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        lastError = `Overpass HTTP ${res.status}`;
        continue;
      }

      const data = (await res.json()) as {
        elements?: Array<{
          lat?: number;
          lon?: number;
          tags?: { name?: string; 'name:en'?: string; place?: string };
        }>;
      };

      const startLat = pathCoords[0][0];
      const startLon = pathCoords[0][1];
      const candidates: RawCandidate[] = [];

      for (const el of data.elements ?? []) {
        if (typeof el.lat !== 'number' || typeof el.lon !== 'number') continue;
        const name = (el.tags?.['name:en'] || el.tags?.name || '').trim();
        if (!name) continue;

        // Skip places right at the start point (within 3 km of origin)
        if (haversineMeters(startLat, startLon, el.lat, el.lon) < 3000) continue;

        const { minDistM, atM } = projectOntoRoute(pathCoords, cumDist, el.lat, el.lon);
        // Spec 3.2: keep if within 3 km of the route
        if (minDistM <= 3000) {
          candidates.push({
            rawName: name,
            lat: el.lat,
            lon: el.lon,
            atM: Math.round(atM),
            kind: el.tags?.place === 'city' ? 'city' : 'town',
          });
        }
      }

      return { candidates };
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err.message : 'Overpass timeout';
    }
  }

  return { candidates: [], error: lastError };
}

/**
 * Source 2 (fallback): Nominatim reverse lookups sampled every 12 km (max 15 lookups, 1 req/s).
 * Also detects state crossings.
 */
async function queryNominatimAlongRoute(
  pathCoords: [number, number][],
  cumDist: number[],
  totalLengthM: number
): Promise<{ candidates: RawCandidate[]; error?: string }> {
  const candidates: RawCandidate[] = [];
  const stepM = Math.max(12000, totalLengthM / 14);
  const sampleDistances: number[] = [];

  // Always check origin (0 m) to record starting state so we detect crossings cleanly
  sampleDistances.push(0);
  for (let d = stepM; d < totalLengthM - 1500 && sampleDistances.length < 15; d += stepM) {
    sampleDistances.push(d);
  }
  if (totalLengthM >= 4000 && sampleDistances.length < 15) {
    sampleDistances.push(totalLengthM - 1000);
  }

  let currentState = '';
  let errors = 0;

  for (const distM of sampleDistances) {
    const [lat, lon] = pointAtDistance(pathCoords, cumDist, distM);
    await waitNominatimSlot();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const url = new URL('https://nominatim.openstreetmap.org/reverse');
      url.searchParams.set('lat', lat.toFixed(5));
      url.searchParams.set('lon', lon.toFixed(5));
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('zoom', '10'); // town/city level
      url.searchParams.set('accept-language', 'en');

      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': NOMINATIM_USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        errors += 1;
        continue;
      }

      const data = (await res.json()) as {
        address?: {
          city?: string;
          town?: string;
          village?: string;
          county?: string;
          state_district?: string;
          state?: string;
        };
      };

      const addr = data.address;
      if (!addr) continue;

      const state = (addr.state || '').trim();
      if (distM === 0) {
        currentState = state;
        continue;
      }

      // Detect state crossing
      if (state && currentState && normalizePlaceName(state) !== normalizePlaceName(currentState)) {
        candidates.push({
          rawName: state,
          lat,
          lon,
          atM: Math.round(distM),
          kind: 'state',
        });
        currentState = state;
      } else if (state && !currentState) {
        currentState = state;
      }

      if (addr.city) {
        candidates.push({
          rawName: addr.city.trim(),
          lat,
          lon,
          atM: Math.round(distM),
          kind: 'city',
        });
      } else if (addr.town) {
        candidates.push({
          rawName: addr.town.trim(),
          lat,
          lon,
          atM: Math.round(distM),
          kind: 'town',
        });
      } else if (addr.county || addr.state_district) {
        candidates.push({
          rawName: (addr.county || addr.state_district || '').trim(),
          lat,
          lon,
          atM: Math.round(distM),
          kind: 'taluk',
        });
      }
    } catch {
      clearTimeout(timer);
      errors += 1;
    }
  }

  return {
    candidates,
    error: errors > 0 && candidates.length === 0 ? 'Nominatim reverse lookup failed' : undefined,
  };
}

/**
 * Discovers up to 8 places along a route polyline (Spec 3.2).
 * Uses Overpass API first, falling back to Nominatim reverse lookups.
 */
export async function discoverPlacesAlongRoute(
  pathCoords: [number, number][],
  existingPlaces: ExistingPlaceRef[]
): Promise<DiscoverPlacesResult> {
  const startedAt = Date.now();
  const errors: string[] = [];

  if (!Array.isArray(pathCoords) || pathCoords.length < 2) {
    return {
      landmarks: [],
      regions: [],
      source: 'none',
      durationMs: Date.now() - startedAt,
      errors: [],
    };
  }

  const cumDist = computeCumulativeDistances(pathCoords);
  const totalLengthM = cumDist[cumDist.length - 1] || 0;
  if (totalLengthM < 2500) {
    return {
      landmarks: [],
      regions: [],
      source: 'none',
      durationMs: Date.now() - startedAt,
      errors: [],
    };
  }

  let source: 'overpass' | 'nominatim' | 'none' = 'none';
  let rawCandidates: RawCandidate[] = [];

  // Source 1: Overpass API
  const overpass = await queryOverpassAlongRoute(pathCoords, cumDist);
  if (overpass.error) {
    errors.push(`overpass: ${overpass.error}`);
  }
  if (overpass.candidates.length > 0) {
    source = 'overpass';
    rawCandidates = overpass.candidates;
  } else {
    // Source 2: Nominatim reverse lookups fallback
    const nom = await queryNominatimAlongRoute(pathCoords, cumDist, totalLengthM);
    if (nom.error) {
      errors.push(`nominatim: ${nom.error}`);
    }
    if (nom.candidates.length > 0) {
      source = 'nominatim';
      rawCandidates = nom.candidates;
    }
  }

  const selected = selectSpreadCandidates(rawCandidates, existingPlaces, totalLengthM, 8);

  const landmarks: DiscoveredLandmark[] = [];
  const regions: DiscoveredRegion[] = [];

  for (const item of selected) {
    const slug = slugifyPlace(item.rawName);
    if (item.kind === 'city' || item.kind === 'state') {
      const id = `osm_reg_${slug}`;
      regions.push({
        id,
        name: buildDefaultLocalizedName(item.rawName),
        rawName: item.rawName,
        enter_at_m: item.atM,
        lat: item.lat,
        lon: item.lon,
        welcome: buildDefaultWelcome(item.rawName),
        greeting: buildDefaultGreeting(),
        question_id: `q_${id}`,
        source: 'osm',
        placeKind: item.kind,
      });
    } else {
      const id = `osm_lm_${slug}`;
      landmarks.push({
        id,
        name: buildDefaultLocalizedName(item.rawName),
        rawName: item.rawName,
        at_m: item.atM,
        lat: item.lat,
        lon: item.lon,
        question_id: `q_${id}`,
        source: 'osm',
        placeKind: item.kind,
      });
    }
  }

  return {
    landmarks,
    regions,
    source,
    durationMs: Date.now() - startedAt,
    errors,
  };
}

/**
 * Resolves live GPS (lat, lon) into a clean human-readable current location name.
 * Uses Google Places API (New) nearby search when available, then Nominatim reverse lookup.
 */
export async function reverseGeocodeLocation(
  lat: number,
  lon: number,
  lang: SupportedLang,
  mapsApiKey: string,
  attributionId: string
): Promise<ReverseGeocodeResult> {
  // 1. Try Nominatim reverse (gives clean locality, city, state for any coordinate worldwide)
  // and optionally enrich with Google Places nearby if Nominatim fails or is slow
  try {
    await waitNominatimSlot();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('lat', lat.toFixed(6));
    url.searchParams.set('lon', lon.toFixed(6));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('zoom', '14');
    url.searchParams.set('accept-language', lang.split('-')[0] || 'en');

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': NOMINATIM_USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = (await res.json()) as {
        display_name?: string;
        address?: {
          neighbourhood?: string;
          suburb?: string;
          city_district?: string;
          town?: string;
          city?: string;
          village?: string;
          county?: string;
          state_district?: string;
          state?: string;
          country?: string;
        };
      };
      const a = data.address;
      if (a) {
        const locality = a.suburb || a.neighbourhood || a.village || a.town || a.city_district || '';
        const region = a.city || a.town || a.state_district || a.county || a.state || '';
        const state = a.state || '';
        const parts = [locality, region].filter((p, idx, arr) => p && arr.indexOf(p) === idx);
        const name = parts.join(', ') || region || state || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        return {
          name,
          locality: locality || region || name,
          region: region || state || name,
          state,
          address: data.display_name || name,
          provider: 'nominatim',
        };
      }
    }
  } catch {
    // Fall through to Google Places Nearby
  }

  // 2. Fallback to Google Places API (New) Nearby Search
  if (mapsApiKey) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': mapsApiKey,
          'X-Goog-Maps-Solution-ID': attributionId,
          'X-Goog-FieldMask': 'places.displayName,places.shortFormattedAddress,places.formattedAddress',
        },
        body: JSON.stringify({
          maxResultCount: 1,
          languageCode: lang,
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lon },
              radius: 1500,
            },
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = (await res.json()) as {
          places?: Array<{
            displayName?: { text?: string };
            shortFormattedAddress?: string;
            formattedAddress?: string;
          }>;
        };
        const p = data.places?.[0];
        if (p) {
          const shortAddr = p.shortFormattedAddress || p.formattedAddress || p.displayName?.text || '';
          const name = shortAddr || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
          return {
            name,
            locality: p.displayName?.text || name,
            region: shortAddr || name,
            state: '',
            address: p.formattedAddress || name,
            provider: 'google-places',
          };
        }
      }
    } catch {
      // Fall through to coordinates
    }
  }

  const fallbackName = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  return {
    name: fallbackName,
    locality: fallbackName,
    region: fallbackName,
    state: '',
    address: fallbackName,
    provider: 'coordinates',
  };
}
