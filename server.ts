import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  reverseGeocodeLocation,
  type ExistingPlaceRef,
  type SupportedLang,
} from './server/placesAlongRoute.ts';
import {
  createSingleQuiz,
  generateRouteQuizzes,
  getAgentProvider,
  handleAgentTurn,
  type TripSnapshot,
} from './server/voiceAgent.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const DATA_DIR = path.resolve(__dirname, 'data');
const DIST_DIR = path.resolve(__dirname, 'dist');

const ALLOWED_LANGUAGES = new Set(['en-IN', 'hi-IN', 'ta-IN']);
const GMP_ATTRIBUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

const MURF_VOICES: Record<string, { voiceId: string; locale: string }> = {
  'en-IN': { voiceId: 'en-IN-rohan', locale: 'en-IN' },
  'hi-IN': { voiceId: 'hi-IN-kabir', locale: 'hi-IN' },
  'ta-IN': { voiceId: 'ta-IN-iniya', locale: 'ta-IN' },
};

// Bounded server-side TTS audio cache
const MAX_CACHE_ENTRIES = 160;
const ttsCache = new Map<string, Buffer>();

function setTtsCache(key: string, audio: Buffer) {
  if (ttsCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = ttsCache.keys().next().value;
    if (oldestKey) ttsCache.delete(oldestKey);
  }
  ttsCache.set(key, audio);
}

// Polite Nominatim 1 req/s rate limiter (only used if Google Maps key is unset)
let lastNominatimRequestAt = 0;

function getMapsApiKey(): string {
  return (process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Standard Google Encoded Polyline Algorithm decoder.
 */
function decodeEncodedPolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    const dLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dLat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    const dLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dLng;

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

interface PlaceLandmarkSeed {
  id: string;
  name: Record<'en-IN' | 'hi-IN' | 'ta-IN', string>;
  lat: number;
  lon: number;
  question_id: string;
}

interface PlaceRegionSeed {
  id: string;
  name: Record<'en-IN' | 'hi-IN' | 'ta-IN', string>;
  lat: number;
  lon: number;
  radius_m: number;
  welcome: Record<'en-IN' | 'hi-IN' | 'ta-IN', string>;
  greeting: Record<'en-IN' | 'hi-IN' | 'ta-IN', string>;
  question_id: string;
}

interface PlacesFile {
  landmarks: PlaceLandmarkSeed[];
  regions: PlaceRegionSeed[];
}

async function loadPlaces(): Promise<PlacesFile> {
  const placesPath = path.resolve(DATA_DIR, 'places.json');
  if (!placesPath.startsWith(DATA_DIR + path.sep)) {
    throw new Error('Invalid places path');
  }
  const raw = await fs.readFile(placesPath, 'utf-8');
  return JSON.parse(raw) as PlacesFile;
}

/**
 * Computes cumulative distances along a decoded route path, then attaches:
 * - Curated landmarks within 5 km of the route line (at closest point along route)
 * - Curated circular regions entered by the route (first point inside circle; skip if start point is inside)
 */
function attachCuratedPlaces(
  pathCoords: [number, number][],
  totalLengthM: number,
  places: PlacesFile
) {
  if (pathCoords.length < 2) {
    return { landmarks: [], regions: [] };
  }

  // Compute cumulative distance at every polyline vertex
  const cumDist: number[] = [0];
  for (let i = 1; i < pathCoords.length; i++) {
    const seg = haversineMeters(
      pathCoords[i - 1][0],
      pathCoords[i - 1][1],
      pathCoords[i][0],
      pathCoords[i][1]
    );
    cumDist.push(cumDist[i - 1] + seg);
  }
  const rawTotal = cumDist[cumDist.length - 1] || 1;
  const scale = totalLengthM > 0 ? totalLengthM / rawTotal : 1;

  // Sample densely enough without excessive O(N) work on huge polylines
  const stride = Math.max(1, Math.floor(pathCoords.length / 600));

  const attachedLandmarks = [];
  for (const lm of places.landmarks) {
    let minDist = Infinity;
    let bestAtM = 0;

    for (let i = 0; i < pathCoords.length; i += stride) {
      const d = haversineMeters(pathCoords[i][0], pathCoords[i][1], lm.lat, lm.lon);
      if (d < minDist) {
        minDist = d;
        bestAtM = cumDist[i] * scale;
      }
    }
    // Check last point explicitly
    const lastIdx = pathCoords.length - 1;
    const dLast = haversineMeters(pathCoords[lastIdx][0], pathCoords[lastIdx][1], lm.lat, lm.lon);
    if (dLast < minDist) {
      minDist = dLast;
      bestAtM = cumDist[lastIdx] * scale;
    }

    // Spec 3.4: attach every landmark within 5 km (5000 m) of the route line
    if (minDist <= 5000 && bestAtM > 1500) {
      attachedLandmarks.push({
        id: lm.id,
        name: lm.name,
        at_m: Math.round(bestAtM),
        lat: lm.lat,
        lon: lm.lon,
        question_id: lm.question_id,
      });
    }
  }
  attachedLandmarks.sort((a, b) => a.at_m - b.at_m);

  const startCoord = pathCoords[0];
  const attachedRegions = [];
  for (const reg of places.regions) {
    // Spec 3.4: skip a region that already contains the start point
    const distFromStart = haversineMeters(startCoord[0], startCoord[1], reg.lat, reg.lon);
    if (distFromStart <= reg.radius_m) {
      continue;
    }

    // Find first point along route inside the region circle
    for (let i = 1; i < pathCoords.length; i += stride) {
      const d = haversineMeters(pathCoords[i][0], pathCoords[i][1], reg.lat, reg.lon);
      if (d <= reg.radius_m) {
        attachedRegions.push({
          id: reg.id,
          name: reg.name,
          enter_at_m: Math.round(cumDist[i] * scale),
          welcome: reg.welcome,
          greeting: reg.greeting,
          question_id: reg.question_id,
        });
        break;
      }
    }
  }
  attachedRegions.sort((a, b) => a.enter_at_m - b.enter_at_m);

  return { landmarks: attachedLandmarks, regions: attachedRegions };
}

type ManeuverIcon = 'left' | 'right' | 'exit' | 'roundabout' | 'straight' | 'arrive';

function extractRoadName(instructionText: string): string {
  const cleaned = instructionText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  const ontoMatch = cleaned.match(/\b(?:onto|on|toward|towards)\s+([^,.;]+)/i);
  if (ontoMatch?.[1]) {
    return ontoMatch[1].trim().slice(0, 60);
  }
  return '';
}

function buildLocalizedManeuver(
  maneuverType: string,
  roadName: string,
  fallbackInstruction: string
): { icon: ManeuverIcon; text: Record<'en-IN' | 'hi-IN' | 'ta-IN', string> } | null {
  const m = (maneuverType || '').toUpperCase();

  // Spec 3.5: skip steps that need no action (depart, continue straight, name change)
  if (!m || m === 'DEPART' || m === 'STRAIGHT' || m === 'NAME_CHANGE' || m === 'MANEUVER_UNSPECIFIED') {
    return null;
  }

  const roadEn = roadName ? ` onto ${roadName}` : '';
  const roadHi = roadName ? `${roadName} पर ` : '';
  const roadTa = roadName ? `${roadName} சாலையில் ` : '';

  if (m.includes('ROUNDABOUT')) {
    return {
      icon: 'roundabout',
      text: {
        'en-IN': roadName ? `At the roundabout, exit toward ${roadName}` : 'Enter the roundabout and take your exit',
        'hi-IN': roadName ? `गोलचक्कर से ${roadName} की ओर निकलें` : 'गोलचक्कर से आगे निकलें',
        'ta-IN': roadName ? `வட்டச் சந்திப்பில் ${roadName} நோக்கிச் செல்லவும்` : 'வட்டச் சந்திப்பில் வெளியேறவும்',
      },
    };
  }

  if (m.includes('RAMP') || m.includes('EXIT') || m.includes('FORK') || m.includes('MERGE')) {
    const isLeft = m.includes('LEFT');
    const isRight = m.includes('RIGHT');
    return {
      icon: 'exit',
      text: {
        'en-IN': isLeft
          ? `Keep left${roadEn}`
          : isRight
            ? `Take the exit on the right${roadEn}`
            : `Take the exit${roadEn}`,
        'hi-IN': isLeft
          ? `${roadHi}बाएँ लेन में रहें`
          : isRight
            ? `${roadHi}दाएँ निकास से निकलें`
            : `${roadHi}निकास लें`,
        'ta-IN': isLeft
          ? `${roadTa}இடதுபுறம் செல்லவும்`
          : isRight
            ? `${roadTa}வலதுபுற வழியில் வெளியேறவும்`
            : `${roadTa}வெளியேறும் பாதையில் செல்லவும்`,
      },
    };
  }

  if (m.includes('UTURN')) {
    return {
      icon: m.includes('RIGHT') ? 'right' : 'left',
      text: {
        'en-IN': `Make a U-turn${roadEn}`,
        'hi-IN': `${roadHi}यू-टर्न लें`,
        'ta-IN': `${roadTa}யூ-டர்ன் திரும்பவும்`,
      },
    };
  }

  if (m.includes('LEFT')) {
    const slight = m.includes('SLIGHT');
    return {
      icon: 'left',
      text: {
        'en-IN': slight ? `Keep slightly left${roadEn}` : `Turn left${roadEn}`,
        'hi-IN': slight ? `${roadHi}हल्का बाएँ मुड़ें` : `${roadHi}बाएँ मुड़ें`,
        'ta-IN': slight ? `${roadTa}சற்று இடதுபுறம் திரும்பவும்` : `${roadTa}இடதுபுறம் திரும்பவும்`,
      },
    };
  }

  if (m.includes('RIGHT')) {
    const slight = m.includes('SLIGHT');
    return {
      icon: 'right',
      text: {
        'en-IN': slight ? `Keep slightly right${roadEn}` : `Turn right${roadEn}`,
        'hi-IN': slight ? `${roadHi}हल्का दाएँ मुड़ें` : `${roadHi}दाएँ मुड़ें`,
        'ta-IN': slight ? `${roadTa}சற்று வலதுபுறம் திரும்பவும்` : `${roadTa}வலதுபுறம் திரும்பவும்`,
      },
    };
  }

  if (fallbackInstruction) {
    return {
      icon: 'straight',
      text: {
        'en-IN': fallbackInstruction.slice(0, 120),
        'hi-IN': `${roadHi}आगे बढ़ें`,
        'ta-IN': `${roadTa}தொடர்ந்து செல்லவும்`,
      },
    };
  }

  return null;
}

function makeArriveManeuver(lengthM: number) {
  return {
    id: 'm_arrive',
    at_m: Math.max(0, Math.round(lengthM)),
    icon: 'arrive' as ManeuverIcon,
    text: {
      'en-IN': 'You have arrived at your destination',
      'hi-IN': 'आप अपनी मंज़िल पर पहुँच गए हैं',
      'ta-IN': 'நீங்கள் உங்கள் இலக்கை அடைந்துவிட்டீர்கள்',
    },
    text_early: {
      'en-IN': 'Your destination is 800 metres ahead',
      'hi-IN': 'आपकी मंज़िल 800 मीटर आगे है',
      'ta-IN': 'உங்கள் இலக்கு 800 மீட்டர் தொலைவில் உள்ளது',
    },
  };
}

function parseLatLonPair(raw: unknown): { lat: number; lon: number } | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 2) return null;
  const [lat, lon] = parts;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

const app = express();
app.use(express.json({ limit: '512kb' }));

// Public non-secret client config (scoped browser Maps JS API key + active TTS/Agent providers)
app.get('/api/config', (_req, res) => {
  res.json({
    googleMapsApiKey: getMapsApiKey(),
    ttsProvider: process.env.MURF_API_KEY ? 'murf-falcon-2' : 'browser-speech',
    agentProvider: getAgentProvider(),
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mapsProvider: getMapsApiKey() ? 'google-maps-platform' : 'osm-fallback',
    ttsProvider: process.env.MURF_API_KEY ? 'murf-falcon-2' : 'browser-speech',
    agentProvider: getAgentProvider(),
  });
});

// GET /api/reverse-geocode?lat=...&lon=...&lang=...
// Resolves the user's live GPS coordinates into a human-readable current location name.
app.get('/api/reverse-geocode', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      res.status(400).json({ error: 'Valid lat and lon parameters are required.' });
      return;
    }

    const rawLang = typeof req.query.lang === 'string' ? req.query.lang : 'en-IN';
    const lang: SupportedLang = ALLOWED_LANGUAGES.has(rawLang)
      ? (rawLang as SupportedLang)
      : 'en-IN';

    const result = await reverseGeocodeLocation(
      lat,
      lon,
      lang,
      getMapsApiKey(),
      GMP_ATTRIBUTION_ID
    );
    res.json(result);
  } catch (err) {
    console.error('Reverse geocode error:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Unable to resolve current location name.' });
  }
});

// GET /api/questions?language=en-IN&type=trivia
app.get('/api/questions', async (req, res) => {
  try {
    const rawLang = typeof req.query.language === 'string' ? req.query.language : undefined;
    const rawType = typeof req.query.type === 'string' ? req.query.type : undefined;

    if (rawLang && !ALLOWED_LANGUAGES.has(rawLang)) {
      res.status(400).json({ error: 'Unsupported language parameter.' });
      return;
    }

    const questionsPath = path.resolve(DATA_DIR, 'questions.json');
    if (!questionsPath.startsWith(DATA_DIR + path.sep)) {
      res.status(400).json({ error: 'Invalid path.' });
      return;
    }

    const content = await fs.readFile(questionsPath, 'utf-8');
    let questions = JSON.parse(content) as Array<Record<string, unknown>>;

    if (rawLang) {
      questions = questions.filter((q) => q.language === rawLang);
    }
    if (rawType && ['landmark', 'region', 'trivia'].includes(rawType)) {
      questions = questions.filter((q) => q.type === rawType);
    }

    res.json({ questions });
  } catch (err) {
    console.error('Failed to read questions:', err);
    res.status(500).json({ error: 'Unable to load questions.' });
  }
});

// GET /api/geocode?q=...&lat=...&lon=...&lang=...
// Uses Google Places API (New) Text Search on submit, sorted nearest-first (max 5 results).
app.get('/api/geocode', async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query.length < 2 || query.length > 120) {
      res.status(400).json({ error: 'Please enter a destination (2 to 120 characters).' });
      return;
    }

    const nearPair = parseLatLonPair(req.query.near);
    const userLat = nearPair
      ? nearPair.lat
      : typeof req.query.lat === 'string'
        ? Number(req.query.lat)
        : NaN;
    const userLon = nearPair
      ? nearPair.lon
      : typeof req.query.lon === 'string'
        ? Number(req.query.lon)
        : NaN;
    const hasOrigin =
      Number.isFinite(userLat) &&
      Number.isFinite(userLon) &&
      userLat >= -90 &&
      userLat <= 90 &&
      userLon >= -180 &&
      userLon <= 180;

    const rawLang = typeof req.query.lang === 'string' ? req.query.lang : 'en-IN';
    const langCode = ALLOWED_LANGUAGES.has(rawLang) ? rawLang.split('-')[0] : 'en';

    const mapsKey = getMapsApiKey();
    if (mapsKey) {
      const isWithinIndia =
        !hasOrigin || (userLat >= 6 && userLat <= 37 && userLon >= 68 && userLon <= 98);

      const requestBody: Record<string, unknown> = {
        textQuery: query,
        pageSize: 5,
        languageCode: langCode,
        ...(isWithinIndia ? { regionCode: 'IN' } : {}),
      };

      if (hasOrigin) {
        requestBody.locationBias = {
          circle: {
            center: { latitude: userLat, longitude: userLon },
            radius: 50000.0,
          },
        };
      }

      const placesRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': mapsKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
          'X-Goog-Maps-Solution-ID': GMP_ATTRIBUTION_ID,
        },
        body: JSON.stringify(requestBody),
      });

      if (placesRes.ok) {
        const data = (await placesRes.json()) as {
          places?: Array<{
            id?: string;
            displayName?: { text?: string };
            formattedAddress?: string;
            location?: { latitude?: number; longitude?: number };
          }>;
        };

        const results = (data.places ?? [])
          .filter(
            (p) =>
              typeof p.location?.latitude === 'number' && typeof p.location?.longitude === 'number'
          )
          .map((p, idx) => {
            const lat = p.location!.latitude!;
            const lon = p.location!.longitude!;
            return {
              id: p.id || `place_${idx}`,
              name: p.displayName?.text || p.formattedAddress || query,
              address: p.formattedAddress || '',
              lat,
              lon,
              distance_m: hasOrigin ? Math.round(haversineMeters(userLat, userLon, lat, lon)) : undefined,
            };
          });

        if (hasOrigin) {
          results.sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));
        }

        res.json({ results: results.slice(0, 5), provider: 'google-places' });
        return;
      }

      const errText = await placesRes.text().catch(() => '');
      console.error('Google Places search failed:', placesRes.status, errText.slice(0, 200));
    }

    // Graceful fallback to Nominatim (polite 1 req/s rate limit) if Google Places is unavailable
    const now = Date.now();
    const waitMs = Math.max(0, 1050 - (now - lastNominatimRequestAt));
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }
    lastNominatimRequestAt = Date.now();

    const nomUrl = new URL('https://nominatim.openstreetmap.org/search');
    nomUrl.searchParams.set('q', query);
    nomUrl.searchParams.set('format', 'json');
    nomUrl.searchParams.set('limit', '5');
    nomUrl.searchParams.set('addressdetails', '1');

    const nomRes = await fetch(nomUrl.toString(), {
      headers: {
        'User-Agent': 'SafarVoiceCoDriverMVP/1.0',
        'Accept-Language': langCode,
      },
    });

    if (!nomRes.ok) {
      res.status(502).json({ error: 'Unable to search destinations right now. Please try again.' });
      return;
    }

    const nomData = (await nomRes.json()) as Array<{
      place_id: number;
      name?: string;
      display_name: string;
      lat: string;
      lon: string;
    }>;

    const results = nomData
      .map((item) => {
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        return {
          id: String(item.place_id),
          name: item.name || item.display_name.split(',')[0],
          address: item.display_name,
          lat,
          lon,
          distance_m: hasOrigin ? Math.round(haversineMeters(userLat, userLon, lat, lon)) : undefined,
        };
      })
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));

    if (hasOrigin) {
      results.sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));
    }

    res.json({ results: results.slice(0, 5), provider: 'nominatim' });
  } catch (err) {
    console.error('Geocode error:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Destination search failed. Please try again.' });
  }
});

// GET /api/route?from=lat,lon&to=lat,lon&destName=...
// Uses Google Maps Platform Routes API (v2:computeRoutes) and attaches curated landmarks (<= 5km) & regions.
app.get('/api/route', async (req, res) => {
  try {
    const origin = parseLatLonPair(req.query.from);
    const dest = parseLatLonPair(req.query.to);
    if (!origin || !dest) {
      res.status(400).json({ error: 'Valid from=lat,lon and to=lat,lon parameters are required.' });
      return;
    }

    const rawDestName =
      typeof req.query.destName === 'string' && req.query.destName.trim()
        ? req.query.destName.trim().slice(0, 80)
        : typeof req.query.name === 'string' && req.query.name.trim()
          ? req.query.name.trim().slice(0, 80)
          : 'Destination';

    const rawStartName =
      typeof req.query.startName === 'string' && req.query.startName.trim()
        ? req.query.startName.trim().slice(0, 80)
        : '';

    const startRegionLocalized = rawStartName
      ? {
          'en-IN': rawStartName,
          'hi-IN': rawStartName,
          'ta-IN': rawStartName,
        }
      : {
          'en-IN': 'Current location',
          'hi-IN': 'वर्तमान स्थान',
          'ta-IN': 'தற்போதைய இடம்',
        };

    const places = await loadPlaces();
    const mapsKey = getMapsApiKey();

    if (mapsKey) {
      const routesRes = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': mapsKey,
          'X-Goog-Maps-Solution-ID': GMP_ATTRIBUTION_ID,
          'X-Goog-FieldMask':
            'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.startLocation,routes.legs.steps.endLocation,routes.legs.steps.navigationInstruction',
        },
        body: JSON.stringify({
          origin: {
            location: { latLng: { latitude: origin.lat, longitude: origin.lon } },
          },
          destination: {
            location: { latLng: { latitude: dest.lat, longitude: dest.lon } },
          },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_UNAWARE',
          computeAlternativeRoutes: false,
          units: 'METRIC',
          languageCode: 'en-IN',
        }),
      });

      if (routesRes.ok) {
        const data = (await routesRes.json()) as {
          routes?: Array<{
            distanceMeters?: number;
            duration?: string;
            polyline?: { encodedPolyline?: string };
            legs?: Array<{
              steps?: Array<{
                distanceMeters?: number;
                navigationInstruction?: { maneuver?: string; instructions?: string };
              }>;
            }>;
          }>;
        };

        const primary = data.routes?.[0];
        if (!primary || !primary.polyline?.encodedPolyline) {
          res.status(404).json({ error: 'No driving route found between these locations.' });
          return;
        }

        const pathCoords = decodeEncodedPolyline(primary.polyline.encodedPolyline);
        const totalLengthM = primary.distanceMeters ?? 0;
        const durationS = primary.duration ? parseInt(primary.duration.replace('s', ''), 10) || 0 : 0;

        // Build localized maneuvers from route leg steps
        const maneuvers = [];
        let cursorM = 0;
        const steps = primary.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const nav = step.navigationInstruction;
          if (nav && cursorM > 30) {
            const road = extractRoadName(nav.instructions || '');
            const localized = buildLocalizedManeuver(
              nav.maneuver || '',
              road,
              nav.instructions || ''
            );
            if (localized) {
              maneuvers.push({
                id: `m_${i}`,
                at_m: Math.round(cursorM),
                icon: localized.icon,
                text: localized.text,
              });
            }
          }
          cursorM += step.distanceMeters ?? 0;
        }
        maneuvers.push(makeArriveManeuver(totalLengthM));

        const { landmarks, regions } = attachCuratedPlaces(pathCoords, totalLengthM, places);

        res.json({
          route_id: 'live',
          name: {
            'en-IN': rawDestName,
            'hi-IN': rawDestName,
            'ta-IN': rawDestName,
          },
          length_m: Math.round(totalLengthM),
          duration_s: durationS,
          start_region: startRegionLocalized,
          path: pathCoords,
          maneuvers,
          landmarks,
          regions,
          provider: 'google-routes',
        });
        return;
      }

      const errText = await routesRes.text().catch(() => '');
      console.error('Google Routes compute failed:', routesRes.status, errText.slice(0, 200));
    }

    // Fallback to OSRM public demo server if Google Maps key is unavailable
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?overview=full&geometries=geojson&steps=true`;
    const osrmRes = await fetch(osrmUrl, {
      headers: { 'User-Agent': 'SafarVoiceCoDriverMVP/1.0' },
    });

    if (!osrmRes.ok) {
      res.status(502).json({ error: 'Unable to calculate a driving route right now.' });
      return;
    }

    const osrmData = (await osrmRes.json()) as {
      code: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
        legs: Array<{
          steps: Array<{
            distance: number;
            name: string;
            maneuver: { type: string; modifier?: string };
          }>;
        }>;
      }>;
    };

    const osrmRoute = osrmData.routes?.[0];
    if (osrmData.code !== 'Ok' || !osrmRoute) {
      res.status(404).json({ error: 'No driving route found between these locations.' });
      return;
    }

    const pathCoords: [number, number][] = osrmRoute.geometry.coordinates.map(([lon, lat]) => [
      lat,
      lon,
    ]);
    const totalLengthM = Math.round(osrmRoute.distance);

    const maneuvers = [];
    let cursorM = 0;
    const steps = osrmRoute.legs.flatMap((leg) => leg.steps);
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const mType = `${step.maneuver.type}_${step.maneuver.modifier || ''}`.toUpperCase();
      if (cursorM > 30 && step.maneuver.type !== 'depart' && step.maneuver.type !== 'arrive') {
        const localized = buildLocalizedManeuver(mType, step.name || '', '');
        if (localized) {
          maneuvers.push({
            id: `m_${i}`,
            at_m: Math.round(cursorM),
            icon: localized.icon,
            text: localized.text,
          });
        }
      }
      cursorM += step.distance;
    }
    maneuvers.push(makeArriveManeuver(totalLengthM));

    const { landmarks, regions } = attachCuratedPlaces(pathCoords, totalLengthM, places);

    res.json({
      route_id: 'live',
      name: {
        'en-IN': rawDestName,
        'hi-IN': rawDestName,
        'ta-IN': rawDestName,
      },
      length_m: totalLengthM,
      duration_s: Math.round(osrmRoute.duration),
      start_region: startRegionLocalized,
      path: pathCoords,
      maneuvers,
      landmarks,
      regions,
      provider: 'osrm',
    });
  } catch (err) {
    console.error('Route calculation error:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Could not calculate route. Please try again.' });
  }
});

// POST /api/agent/turn — Live Voice AI Agent for driver trip questions & quiz requests (Spec 4.2)
app.post('/api/agent/turn', async (req, res) => {
  try {
    const body = req.body as {
      language?: unknown;
      utterance?: unknown;
      trip?: unknown;
    };

    const rawLang = typeof body.language === 'string' ? body.language : 'en-IN';
    if (!ALLOWED_LANGUAGES.has(rawLang)) {
      res.status(400).json({ error: 'Unsupported language.' });
      return;
    }
    const language = rawLang as SupportedLang;

    const utterance = typeof body.utterance === 'string' ? body.utterance.trim() : '';
    if (!utterance || utterance.length > 400) {
      res.status(400).json({ error: 'Utterance must be between 1 and 400 characters.' });
      return;
    }

    if (getAgentProvider() === 'none') {
      res.status(503).json({ error: 'Voice AI Agent is not configured on the server.' });
      return;
    }

    // Sanitize optional trip snapshot (only facts; never raw GPS history or secrets)
    let trip: TripSnapshot | null = null;
    if (body.trip && typeof body.trip === 'object') {
      const t = body.trip as Record<string, unknown>;
      const locObj =
        t.current_location && typeof t.current_location === 'object'
          ? (t.current_location as Record<string, unknown>)
          : null;
      const nextM =
        t.next_maneuver && typeof t.next_maneuver === 'object'
          ? (t.next_maneuver as Record<string, unknown>)
          : null;
      const nextLm =
        t.next_landmark && typeof t.next_landmark === 'object'
          ? (t.next_landmark as Record<string, unknown>)
          : null;

      trip = {
        destination: typeof t.destination === 'string' ? t.destination.slice(0, 120) : null,
        current_location:
          locObj && typeof locObj.name === 'string'
            ? {
                name: locObj.name.slice(0, 120),
                lat: typeof locObj.lat === 'number' && Number.isFinite(locObj.lat) ? locObj.lat : undefined,
                lon: typeof locObj.lon === 'number' && Number.isFinite(locObj.lon) ? locObj.lon : undefined,
              }
            : null,
        remaining_m:
          typeof t.remaining_m === 'number' && Number.isFinite(t.remaining_m)
            ? Math.max(0, Math.round(t.remaining_m))
            : null,
        remaining_s:
          typeof t.remaining_s === 'number' && Number.isFinite(t.remaining_s)
            ? Math.max(0, Math.round(t.remaining_s))
            : null,
        arrival_time: typeof t.arrival_time === 'string' ? t.arrival_time.slice(0, 20) : null,
        next_maneuver:
          nextM && typeof nextM.text === 'string' && typeof nextM.distance_m === 'number'
            ? {
                text: nextM.text.slice(0, 200),
                distance_m: Math.max(0, Math.round(nextM.distance_m)),
              }
            : null,
        region: typeof t.region === 'string' ? t.region.slice(0, 120) : null,
        next_landmark:
          nextLm && typeof nextLm.name === 'string' && typeof nextLm.distance_m === 'number'
            ? {
                name: nextLm.name.slice(0, 120),
                distance_m: Math.max(0, Math.round(nextLm.distance_m)),
              }
            : null,
      };
    }

    const result = await Promise.race([
      handleAgentTurn({ dataDir: DATA_DIR, language, utterance, trip }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Agent turn timed out')), 7800)
      ),
    ]);

    res.json(result);
  } catch (err) {
    console.error('Agent turn error:', err instanceof Error ? err.message : 'unknown');
    res.status(502).json({ error: 'Voice agent could not answer right now.' });
  }
});

// POST /api/agent/quiz/create — On-demand single quiz creation for the active drive or topic
app.post('/api/agent/quiz/create', async (req, res) => {
  try {
    const body = req.body as {
      language?: unknown;
      topic?: unknown;
      trip?: unknown;
    };

    const rawLang = typeof body.language === 'string' ? body.language : 'en-IN';
    if (!ALLOWED_LANGUAGES.has(rawLang)) {
      res.status(400).json({ error: 'Unsupported language.' });
      return;
    }
    const language = rawLang as SupportedLang;
    const topic = typeof body.topic === 'string' ? body.topic.trim().slice(0, 120) : undefined;

    if (getAgentProvider() === 'none') {
      res.status(503).json({ error: 'Voice AI Agent is not configured on the server.' });
      return;
    }

    let trip: TripSnapshot | null = null;
    if (body.trip && typeof body.trip === 'object') {
      const t = body.trip as Record<string, unknown>;
      const locObj =
        t.current_location && typeof t.current_location === 'object'
          ? (t.current_location as Record<string, unknown>)
          : null;
      trip = {
        destination: typeof t.destination === 'string' ? t.destination.slice(0, 120) : null,
        current_location:
          locObj && typeof locObj.name === 'string'
            ? { name: locObj.name.slice(0, 120) }
            : null,
        remaining_m:
          typeof t.remaining_m === 'number' && Number.isFinite(t.remaining_m)
            ? Math.max(0, Math.round(t.remaining_m))
            : null,
        remaining_s:
          typeof t.remaining_s === 'number' && Number.isFinite(t.remaining_s)
            ? Math.max(0, Math.round(t.remaining_s))
            : null,
        arrival_time: typeof t.arrival_time === 'string' ? t.arrival_time.slice(0, 20) : null,
        next_maneuver: null,
        region: typeof t.region === 'string' ? t.region.slice(0, 120) : null,
        next_landmark: null,
      };
    }

    const result = await Promise.race([
      createSingleQuiz({ dataDir: DATA_DIR, language, topic, trip }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Quiz creation timed out')), 7800)
      ),
    ]);

    res.json(result);
  } catch (err) {
    console.error('On-demand quiz create error:', err instanceof Error ? err.message : 'unknown');
    res.status(502).json({ error: 'Unable to create a quiz right now.' });
  }
});

// POST /api/agent/quiz — Background place discovery + route quiz generation (Spec 3.2 & 4.3)
app.post('/api/agent/quiz', async (req, res) => {
  try {
    const body = req.body as {
      language?: unknown;
      path?: unknown;
      trivia_count?: unknown;
    };

    const rawLang = typeof body.language === 'string' ? body.language : 'en-IN';
    if (!ALLOWED_LANGUAGES.has(rawLang)) {
      res.status(400).json({ error: 'Unsupported language.' });
      return;
    }
    const language = rawLang as SupportedLang;

    let pathCoords: [number, number][] | null = null;
    if (Array.isArray(body.path)) {
      const cleaned: [number, number][] = [];
      for (const pt of body.path) {
        if (
          Array.isArray(pt) &&
          pt.length >= 2 &&
          typeof pt[0] === 'number' &&
          typeof pt[1] === 'number' &&
          Number.isFinite(pt[0]) &&
          Number.isFinite(pt[1]) &&
          pt[0] >= -90 &&
          pt[0] <= 90 &&
          pt[1] >= -180 &&
          pt[1] <= 180
        ) {
          cleaned.push([pt[0], pt[1]]);
        }
      }
      if (cleaned.length >= 2) {
        // Bound max polyline points processed
        const stride = Math.max(1, Math.floor(cleaned.length / 500));
        pathCoords = cleaned.filter((_, idx) => idx % stride === 0 || idx === cleaned.length - 1);
      }
    }

    const rawTriviaCount =
      typeof body.trivia_count === 'number' && Number.isFinite(body.trivia_count)
        ? Math.round(body.trivia_count)
        : 5;

    // Load curated places & questions so curated items always win over discovered/generated ones
    const places = await loadPlaces();
    const existingPlaces: ExistingPlaceRef[] = [
      ...places.landmarks.map((l) => ({
        id: l.id,
        name: l.name['en-IN'],
        lat: l.lat,
        lon: l.lon,
      })),
      ...places.regions.map((r) => ({
        id: r.id,
        name: r.name['en-IN'],
        lat: r.lat,
        lon: r.lon,
      })),
    ];

    const questionsPath = path.resolve(DATA_DIR, 'questions.json');
    const curatedRaw = await fs.readFile(questionsPath, 'utf-8');
    const curatedQuestions = JSON.parse(curatedRaw) as Array<{
      id?: string;
      group_id?: string;
      language?: string;
    }>;
    const curatedQuestionIds = new Set<string>();
    for (const q of curatedQuestions) {
      if (q.language === language) {
        if (q.id) curatedQuestionIds.add(q.id);
        if (q.group_id) curatedQuestionIds.add(q.group_id);
      }
    }

    const result = await generateRouteQuizzes({
      dataDir: DATA_DIR,
      language,
      pathCoords,
      existingPlaces,
      curatedQuestionIds,
      triviaCount: rawTriviaCount,
    });

    res.json(result);
  } catch (err) {
    console.error('Agent quiz generation error:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Unable to generate route quizzes right now.' });
  }
});

// POST /api/tts — Murf Falcon 2 TTS proxy with server-side caching and safe browser fallback
app.post('/api/tts', async (req, res) => {
  try {
    const body = req.body as { text?: unknown; language?: unknown; channel?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const language = typeof body.language === 'string' ? body.language : 'en-IN';
    const channel = body.channel === 'directions' ? 'directions' : 'quiz';

    if (!text || text.length > 600) {
      res.status(400).json({ error: 'Text must be between 1 and 600 characters.' });
      return;
    }
    if (!ALLOWED_LANGUAGES.has(language)) {
      res.status(400).json({ error: 'Unsupported language.' });
      return;
    }

    const murfApiKey = process.env.MURF_API_KEY?.trim();
    if (!murfApiKey) {
      res.json({ fallback: 'browser_tts', language, channel });
      return;
    }

    const cacheKey = `${language}:${channel}:${text}`;
    const cached = ttsCache.get(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('X-TTS-Cache', 'HIT');
      res.send(cached);
      return;
    }

    const voiceConfig = MURF_VOICES[language] ?? MURF_VOICES['en-IN'];

    const murfResponse = await fetch('https://global.api.murf.ai/v1/speech/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': murfApiKey,
      },
      body: JSON.stringify({
        text,
        voiceId: voiceConfig.voiceId,
        model: 'FALCON',
        locale: voiceConfig.locale,
        format: 'MP3',
        sampleRate: 24000,
        rate: channel === 'directions' ? 4 : 0,
      }),
    });

    if (murfResponse.ok) {
      const arrayBuf = await murfResponse.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuf);
      if (audioBuffer.length > 0) {
        setTtsCache(cacheKey, audioBuffer);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('X-TTS-Cache', 'MISS');
        res.send(audioBuffer);
        return;
      }
    }

    res.json({ fallback: 'browser_tts', language, channel });
  } catch (err) {
    console.error('TTS route error:', err instanceof Error ? err.message : 'unknown');
    res.json({ fallback: 'browser_tts', language: 'en-IN', channel: 'quiz' });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(DIST_DIR));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Safar Co-Driver server running at http://localhost:${PORT}`);
  });
}

startServer();
