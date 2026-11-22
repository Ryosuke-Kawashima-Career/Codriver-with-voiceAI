# Safar — Voice Quiz Co-Driver

Safar is a hands-free, voice-first Indian road-trip co-driver and quiz companion built with React, TypeScript, Express, and Google Maps Platform. It pairs real turn-by-turn driving routes with a spoken quiz tied to nearby landmarks and regions in **English (India)**, **Hindi (`hi-IN`)**, and **Tamil (`ta-IN`)**, while strictly prioritizing navigation directions over quiz audio.

---

## Core Capabilities

- **Live GPS & Destination Search**: Uses the browser Geolocation API to detect your current location, lets you search for a destination (submit-only, up to 5 nearest matches), or start in **No route (quiz only)** mode.
- **Real Driving Routes & Interactive Map**: Computes driving routes with Google Maps Platform (**Routes API**, **Places API (New)**, and **Maps JavaScript API** via `@vis.gl/react-google-maps`) and automatically attaches curated landmarks within **5 km** of the route and circular regions entered along the drive.
- **Navigation-First Audio Arbitrator**: Every turn instruction (`800 m` and `200 m` thresholds, with automatic suppression of redundant `800 m` alerts when turns are `< 900 m` apart) interrupts active quiz speech immediately and resumes the quiz once the road ahead is clear.
- **Pre-Cached Voice Pipeline**: Uses **Murf Falcon 2** through a server-side proxy (`/api/tts`) with ~3 km look-ahead pre-caching for upcoming turns, falling back cleanly to the browser's Web Speech API when no `MURF_API_KEY` is configured.
- **GPS-to-Route Snapping & Simulation Mode**: Snaps live `watchPosition` GPS updates onto the active route (ignoring off-route fixes `> 100 m`), and lets you switch to deterministic simulation anytime via the hidden Demo Panel.
- **Glanceable Light Mode UI**: Defaults to a high-contrast daytime Light theme with a subtle toggle for Dark mode, large touch targets, and no timers or red "wrong" states.

---

## Architecture Overview

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                        Browser (React + Vite SPA)                        │
│                                                                          │
│  HomeScreen ──► DriveScreen (GoogleRouteMap / RouteMapSvg + VoiceOrb)    │
│       │               │                            │                     │
│       │               ▼                            ▼                     │
│       │      useCoDriver (State Machine)     Web Speech API              │
│       │        • Live GPS watchPosition      • SpeechRecognition (STT)   │
│       │        • Route snapping & replay     • speechSynthesis fallback  │
│       │        • Navigation > Quiz priority                              │
│       │        • 3 km maneuver audio cache                               │
└───────┼───────────────────────┬──────────────────────────────────────────┘
        │                       │  REST (/api/*)
        ▼                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     Express Server (server.ts :3000)                     │
│                                                                          │
│  GET  /api/config     → Exposes public Maps browser key & TTS mode       │
│  GET  /api/geocode    → Places API (New) Text Search (Nominatim fallback)│
│  GET  /api/route      → Routes API computeRoutes (OSRM fallback) +       │
│                         attaches data/places.json landmarks & regions    │
│  GET  /api/questions  → Serves curated questions from data/questions.json│
│  POST /api/tts        → Proxies Murf Falcon 2 TTS (server-side secret)   │
└───────┬───────────────────────┬─────────────────────────┬────────────────┘
        │                       │                         │
        ▼                       ▼                         ▼
 Google Maps Platform     Curated JSON Data        Murf Falcon 2 API
 • Maps JS API            • data/places.json       (optional; browser
 • Places API (New)       • data/questions.json     speech fallback)
 • Routes API
```

### How Route Enrichment Works
1. The client calls `GET /api/route?from=<lat>,<lon>&to=<lat>,<lon>&destName=<name>`.
2. The server fetches the real driving route (polyline + maneuver steps), converts each maneuver into natural native templates for `en-IN`, `hi-IN`, and `ta-IN`, filters out non-action steps, and appends an `arrive` step.
3. The server projects every landmark in `data/places.json` onto the polyline and attaches any landmark within **5 km** of the route (sorted by distance along the route).
4. The server checks every circular region in `data/places.json`, skips any region that already contains the trip's start point, and records the first entry point along the route for every newly entered region.

---

## Directory Structure

```text
.
├── server.ts                      # Express server, API routes, Vite dev middleware
├── index.html                     # HTML entry point & Google Fonts (Latin, Devanagari, Tamil)
├── package.json                   # Dependencies and npm scripts
├── vite.config.ts                 # Vite + React + Tailwind v4 configuration
├── .env.example                   # Environment variable template
├── data/
│   ├── places.json                # Curated landmarks & circular regions with localized greetings
│   └── questions.json             # Curated landmark, region, and general trivia questions (en/hi/ta)
└── src/
    ├── main.tsx                   # React root mount
    ├── index.css                  # Tailwind CSS v4 entry & Light/Dark base styles
    ├── App.tsx                    # Top-level screen router, theme toggle, Maps config loader
    ├── types/
    │   └── index.ts               # Shared TypeScript interfaces for routes, maneuvers, quizzes, GPS
    ├── engine/
    │   ├── useCoDriver.ts         # Core drive & quiz state machine, GPS snapping, audio arbitration
    │   ├── routeReplay.ts         # Polyline geometry, Haversine math, GPS snapping, maneuver thresholds
    │   ├── voiceClient.ts         # Audio playback queue, /api/tts client, 3 km prefetch cache, STT
    │   ├── answerMatcher.ts       # Deterministic spoken answer matching (options, keywords, voice commands)
    │   └── i18n.ts                # UI copy and spoken voice prompts for en-IN, hi-IN, and ta-IN
    └── components/
        ├── HomeScreen.tsx         # GPS location status, destination search, language & drive start
        ├── DriveScreen.tsx        # Turn banner, interactive map, active quiz card, VoiceOrb, bottom controls
        ├── GoogleRouteMap.tsx     # Google Maps integration (@vis.gl/react-google-maps) with SVG fallback
        ├── RouteMapSvg.tsx        # Lightweight offline/fallback SVG route visualizer
        ├── VoiceOrb.tsx           # Voice state indicator & tap-to-answer control
        ├── SummaryScreen.tsx      # Post-trip summary of stops passed and questions explored
        └── DemoPanel.tsx          # Hidden testing drawer (playback speed, jump km, force triggers, logs)
```

---

## Setup & Configuration

### Prerequisites
- **Node.js** 20+ and **npm** (or Bun)
- A Google Cloud project with **Google Maps Platform** enabled (optional for local fallback testing, recommended for full map & routing fidelity)

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

| Variable | Required | Description |
| --- | --- | --- |
| `GOOGLE_MAPS_API_KEY` | Recommended | Used server-side by `/api/geocode` (**Places API (New)**) and `/api/route` (**Routes API**). Also exposed to the browser via `/api/config` if `VITE_GOOGLE_MAPS_API_KEY` is not separately set. |
| `VITE_GOOGLE_MAPS_API_KEY` | Optional | Browser key for **Maps JavaScript API** (`@vis.gl/react-google-maps`). If omitted, the frontend automatically reads the key from `GET /api/config`. |
| `MURF_API_KEY` | Optional | Server-side key for Murf Falcon 2 neural TTS via `/api/tts`. Never exposed to the browser. If omitted, the app automatically falls back to the browser's Web Speech API (`speechSynthesis`). |

> **Google Cloud APIs to enable** when using Google Maps Platform:
> - **Maps JavaScript API**
> - **Places API (New)**
> - **Routes API**
>
> **Zero-Key Fallback**: If `GOOGLE_MAPS_API_KEY` is not set, `/api/geocode` falls back to OpenStreetMap Nominatim (rate-limited), `/api/route` falls back to OSRM public routing, and the map view falls back to `RouteMapSvg`.

---

## Running the App

### Development Server (Port 3000)

Runs Express with Vite middleware attached on `http://localhost:3000`:

```bash
npm run dev
```

### Type-Check & Lint

```bash
npm run lint
```

### Production Build & Start

Builds the client bundle into `dist/` and starts the Express server serving static assets and API routes on port `3000`:

```bash
npm run build
npm start
```

---

## Testing Without Driving (Demo Panel)

Because live GPS stays stationary at a desk, Safar includes a hidden **Demo Panel** for testing the full Bengaluru–Mysuru drive or any computed route:

1. On the **Home** screen, allow location access (or use the retry/fallback prompt), search for a destination such as **Mysuru Palace** (or choose **No route (quiz only)**), and tap **Start Drive**.
2. Once on the **Drive** screen, press **`D`** on your keyboard — or **triple-tap the top navigation banner** on touchscreens — to open the **Demo Panel**.
3. Use **Play** (with `1×` to `20×` speed) or **Jump to km** to advance along the route. Once Play or Jump is used, live GPS updates are ignored for the remainder of that trip so simulated playback is never overwritten by stationary GPS coordinates.
4. Use the quick-trigger buttons to test **Force Turn**, **Force Landmark**, **Force Region**, **Interrupt with Turn** (verifies navigation preempts an active quiz), and **Simulate Voice Input**.
