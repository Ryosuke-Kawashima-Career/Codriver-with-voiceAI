import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const DATA_DIR = path.resolve(__dirname, 'data');
const ROUTES_DIR = path.resolve(DATA_DIR, 'routes');
const DIST_DIR = path.resolve(__dirname, 'dist');

const ALLOWED_LANGUAGES = new Set(['en-IN', 'hi-IN', 'ta-IN']);

// Murf Falcon 2 voice mapping (one warm, calm voice per Indian language)
const MURF_VOICES: Record<string, { voiceId: string; locale: string }> = {
  'en-IN': { voiceId: 'en-IN-rohan', locale: 'en-IN' },
  'hi-IN': { voiceId: 'hi-IN-kabir', locale: 'hi-IN' },
  'ta-IN': { voiceId: 'ta-IN-iniya', locale: 'ta-IN' },
};

// Bounded server-side audio cache so common phrases and navigation cues are instant
const MAX_CACHE_ENTRIES = 160;
const ttsCache = new Map<string, Buffer>();

function setTtsCache(key: string, audio: Buffer) {
  if (ttsCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = ttsCache.keys().next().value;
    if (oldestKey) ttsCache.delete(oldestKey);
  }
  ttsCache.set(key, audio);
}

const app = express();
app.use(express.json({ limit: '32kb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    ttsProvider: process.env.MURF_API_KEY ? 'murf-falcon-2' : 'browser-speech',
  });
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

// GET /api/routes — list available demo routes
app.get('/api/routes', async (_req, res) => {
  try {
    const files = await fs.readdir(ROUTES_DIR);
    const routes = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const fullPath = path.resolve(ROUTES_DIR, file);
      if (!fullPath.startsWith(ROUTES_DIR + path.sep)) continue;
      const raw = await fs.readFile(fullPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      routes.push({
        route_id: parsed.route_id,
        name: parsed.name,
        subtitle: parsed.subtitle,
        length_m: parsed.length_m,
        maneuver_count: Array.isArray(parsed.maneuvers) ? parsed.maneuvers.length : 0,
        landmark_count: Array.isArray(parsed.landmarks) ? parsed.landmarks.length : 0,
        region_count: Array.isArray(parsed.regions) ? parsed.regions.length : 0,
      });
    }
    res.json({ routes });
  } catch (err) {
    console.error('Failed to list routes:', err);
    res.status(500).json({ error: 'Unable to list routes.' });
  }
});

// GET /api/routes/:id — fetch specific route file with strict path confinement
app.get('/api/routes/:id', async (req, res) => {
  try {
    const routeId = req.params.id;
    if (!/^[a-z0-9-]+$/.test(routeId)) {
      res.status(400).json({ error: 'Invalid route identifier.' });
      return;
    }

    const resolvedPath = path.resolve(ROUTES_DIR, `${routeId}.json`);
    if (!resolvedPath.startsWith(ROUTES_DIR + path.sep)) {
      res.status(400).json({ error: 'Invalid route path.' });
      return;
    }

    const content = await fs.readFile(resolvedPath, 'utf-8');
    res.json(JSON.parse(content));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      res.status(404).json({ error: 'Route not found.' });
      return;
    }
    console.error('Failed to read route:', err);
    res.status(500).json({ error: 'Unable to load route.' });
  }
});

// POST /api/tts — Murf Falcon 2 TTS proxy with server-side caching and safe fallback
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
      // Graceful browser speech fallback when Murf key is not configured
      res.json({
        fallback: 'browser_tts',
        language,
        channel,
      });
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

    // Call Murf Falcon 2 streaming endpoint
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

    // Fallback gracefully to browser speech if Murf returns an upstream error
    res.json({
      fallback: 'browser_tts',
      language,
      channel,
    });
  } catch (err) {
    console.error('TTS route error:', err instanceof Error ? err.message : 'unknown');
    res.json({
      fallback: 'browser_tts',
      language: 'en-IN',
      channel: 'quiz',
    });
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
