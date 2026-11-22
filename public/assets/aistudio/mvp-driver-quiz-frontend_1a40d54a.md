# MVP Spec: Voice Quiz Co-Driver (Frontend)

Status: draft for hackathon MVP
Goal of the MVP: let a reviewer **see and hear how the app works** and give feedback. It is a browser prototype of an in-car voice host that (1) navigates a driver on a map and (2) keeps them entertained with voice quizzes along the way.

---

## 1. What the MVP must show

1. **Navigation:** a route on a map, a moving car, and spoken turn-by-turn directions.
2. **Quizzes by voice**, asked by the host and answered aloud:
   - **Landmark quiz:** about a famous place near the road as the car approaches it.
   - **City / state quiz:** a welcome and one easy question when the car enters a new city or state.
   - **Other trivia:** e.g. cricket, cinema, food.
3. **Navigation comes first:** the host never starts a quiz just before a turn, and directions interrupt any quiz.
4. **Indian languages:** Hindi, Tamil and English voices (Murf Falcon 2), picked at the start.

Out of scope for the MVP: accounts, scores across sessions, passenger/team modes, mid-session language switching, safety nudges, re-routing, fleet features, real vehicle data.

---

## 2. User flow

```
Home (pick language + route) -> Drive (map + voice quiz) -> Summary
```

Voice commands at any time: `skip`, `repeat`, `pause`, `resume`, `stop`.

### 2.1 Quiz round (one round)
```
OFFER -> ASK -> LISTEN -> JUDGE -> FEEDBACK -> (next round)
```
| Step | What happens |
|---|---|
| OFFER | Host: "Ready for a quick one?" Waits for yes / skip / stop (8 s, then goes quiet). Not used for route-triggered questions. |
| ASK | Host speaks one short question. |
| LISTEN | Mic opens, no countdown. 8 s of silence counts as "no answer". |
| JUDGE | Compare the transcript with the accepted answers (see 5.4). |
| FEEDBACK | Warm reply, the answer, and a one-line fun fact. No penalties. |

Rules: one question at a time, short host sentences, answers in one or two words, no timers, no streaks, no "wrong" red styling.

---

## 3. Content

### 3.1 Question types
| Type | Shape | Example (verify before use) |
|---|---|---|
| Landmark (route) | Up to 3 clues, hardest first, asked ~2 km before the landmark | "A palace city famous for its Dasara festival. Which city?" |
| Region welcome (route) | Welcome + local greeting + 1 easy question when entering a region | "Welcome to Tamil Nadu. Vanakkam! Which soft steamed rice cake is a famous breakfast?" -> Idli |
| Trivia | Short factual question (cricket, cinema, food, geography) | "Who captained India to the 1983 World Cup?" -> Kapil Dev |

### 3.2 Question format
```json
{
  "id": "q_0001",
  "type": "landmark | region | trivia",
  "language": "hi-IN",
  "prompt": "spoken by the host (for landmark: first clue)",
  "clues": ["optional extra clue", "optional extra clue"],
  "answers": ["idli", "idly", "इडली"],
  "fun_fact": "one short sentence"
}
```

### 3.3 Content rules
- Written natively in each language, not machine-translated.
- Answerable from memory. Never ask the driver to look at, spot or read anything. Say "we are near", never "on your left".
- Every fact checked by a human before the demo. Avoid disputed borders and sensitive topics.
- Seed set: about 8 trivia questions each in Hindi, Tamil and English, plus the route content below. Stored in JSON files, no database.

### 3.4 Route file (one demo route)
Position is simulated as **distance along the route** (`progress_m`), so triggers need no coordinate matching. Coordinates are only used to draw the map.

```json
{
  "route_id": "blr-mysuru",
  "name": "Bengaluru to Mysuru",
  "length_m": 0,
  "path": [[12.97, 77.59], [12.30, 76.65]],
  "maneuvers": [
    { "at_m": 0, "icon": "left | right | exit | roundabout | straight",
      "text": { "en-IN": "Turn left onto ...", "hi-IN": "...", "ta-IN": "..." } }
  ],
  "landmarks": [
    { "name": { "en-IN": "..." }, "at_m": 0, "lat": 0, "lon": 0, "question_id": "q_0101" }
  ],
  "regions": [
    { "name": { "en-IN": "..." }, "enter_at_m": 0,
      "welcome": { "en-IN": "...", "hi-IN": "...", "ta-IN": "..." },
      "greeting": "Vanakkam", "question_id": "q_0201" }
  ]
}
```
MVP content: one route, 6-8 maneuvers, 4-5 landmarks, 2 regions. Leave at least one long stretch with no turns so quizzes have room. All coordinates and facts are verified by hand.

---

## 4. Frontend UI

Single-page web app, mobile-first, dark theme by default, fonts that render Devanagari and Tamil. The screen is for the audience; the driver only listens and talks.

### 4.1 Home
- App name, one-line tagline.
- Language picker (Hindi / Tamil / English).
- Route picker, plus "No route (quiz only)".
- **Start** button, with a microphone-permission check and a plain retry message if denied.

### 4.2 Drive (main screen, no scrolling)
Top to bottom:
1. **Status bar:** language, current region name.
2. **Map panel:** route line, moving car marker, landmark pins, next turn marked. Read-only.
3. **Next-turn strip:** big arrow icon, distance to the turn, instruction text in the chosen language. Always in the same place.
4. **Voice orb:** animates while the host speaks, pulses while listening, still when paused. A label shows `Directions` vs `Quiz`.
5. **Caption area:** host sentence and what the app heard, in the right script, large text.
6. **State label and score:** `Asking / Listening / Checking / Paused`, plus "correct answers" count.
7. **Controls:** Pause/Resume, Skip, Stop (at least 56 px high).

Without a route, the map and next-turn strip are hidden.

### 4.3 Summary
Questions asked, correct count, landmarks and regions passed (answered ones marked), a spoken goodbye. Buttons: Play again, Home.

### 4.4 Demo Panel (hidden, press `D`)
| Control | Effect |
|---|---|
| Play / pause | Moves the simulated car along the route |
| Speed (1x / 5x / 20x) | Shows a whole route in a few minutes |
| Jump to next turn / landmark / region | Moves the car ~1-2 km before it, to show each trigger quickly |
| Type an answer | Fallback when speech recognition fails |
| Debug | Shows the raw transcript, match result and the "held / played / dropped" decisions for speech |

---

## 5. Behaviour

### 5.1 GPS and navigation
- **Position:** the app holds `progress_m`. The Demo Panel replay advances it. (Stretch goal: use the browser Geolocation API on a real device and snap the position to the route line.)
- **Instructions:** each maneuver is spoken twice, in the chosen language: 800 m before ("In 800 metres, turn left") and 100 m before ("Turn left"). Instructions are short and flat. Their audio is rendered and cached when the route starts.
- **Next-turn strip** updates with the distance in real time.

### 5.2 Navigation first
One rule set decides who speaks:
1. A navigation instruction **interrupts** any quiz speech immediately. An unanswered question is repeated once, briefly, after the instruction ("Back to the question: ...").
2. **No new quiz speech** from 900 m before a turn until 100 m after it (the "directions first" zone). The map shows a small "Directions first" chip while it is active.
3. A landmark question that would fall in that zone is dropped (or becomes a one-line fun fact after the zone). A region welcome waits until the zone ends.
4. Only one question is active at a time.
5. Distances are settings and may be tuned.

### 5.3 Route quizzes
- **Landmark:** triggered when the car is ~2 km before the landmark. The host asks one clue at a time, hardest first; an early correct answer skips the rest; after the last clue it gives the answer and a fun fact.
- **Region:** triggered once when the car crosses a region boundary: welcome line, local greeting in that language, one easy question, answer and fun fact. The host keeps the language the user chose.

### 5.4 Answer judging
Lowercase, trim and strip punctuation. Accept any listed answer (including local-script and spelling variants), allow a small edit distance, and accept a sentence that contains the answer ("I think it is Hyderabad"). On a miss, the host gives the answer. No retry.

### 5.5 Voice
- **Speaking:** Murf Falcon 2 TTS, one warm, calm voice per language. Common phrases are cached.
- **Listening:** browser speech recognition (Web Speech API, best in Chrome) with the chosen language tag. The mic is closed while the host speaks.
- **Key safety:** the Murf key stays on a small backend (`.env`), never in the browser.

---

## 6. Technical outline

| Part | Choice |
|---|---|
| Frontend | React (Vite) or plain JS, whatever is fastest |
| Map | SVG polyline drawn from the route file (works offline, no tile service) |
| Position replay | A small module that advances `progress_m` and emits events: turn ahead, landmark due, region entered |
| Speech arbiter | A small module in front of the audio player that implements 5.2 |
| Backend | Tiny Node or Python server: `POST /api/tts`, `GET /api/questions`, `GET /api/routes/:id` |
| Data | `data/questions.json`, `data/routes/blr-mysuru.json` |

---

## 7. Done when (acceptance)

1. Pick a language and route, press Start, and hear the host greet and offer a round.
2. Answer a trivia question by voice and hear the right/wrong reaction with a fun fact.
3. Press Play: the car moves on the map and the next-turn strip and spoken directions (800 m and 100 m) match each turn.
4. No quiz speech starts in the "directions first" zone, and the chip shows while it holds back.
5. A navigation instruction interrupts a running quiz, which is then repeated briefly or dropped.
6. "Jump to next landmark" gives a landmark quiz with clues, and an early correct answer skips the remaining clues.
7. "Jump to next region" plays the welcome, local greeting and one easy question once.
8. `skip`, `repeat`, `pause`, `resume`, `stop` work by voice and by button, and the Summary appears after Stop.
9. No timers, streaks or penalty messages appear anywhere, and the Murf key is not visible in the browser.

---

## 8. Open questions and risks

- Which Indian languages and voices Falcon 2 offers, and whether audio can stream. Check the docs before fixing the language list.
- Browser speech recognition quality for Hindi and Tamil. Keep the typed-answer fallback.
- Question and route facts need human checking, and the demo route needs hand-made coordinates.
- Real GPS, map tiles and routing APIs have their own terms and cost, and real navigation audio of other apps cannot be controlled. The MVP avoids both by replaying a stored route.
- Do not claim the app improves road safety without real validation. It is a prototype of the interaction.

---

## 9. Build order

1. Backend `/api/tts` and a button that speaks one Hindi sentence.
2. Quiz round with typed answers, then voice input.
3. Home / Drive / Summary screens and the voice orb.
4. Route file, SVG map, replay with speed and jump buttons.
5. Spoken directions and the next-turn strip.
6. "Directions first" rules (5.2).
7. Landmark and region quizzes.
8. Tamil and English content, polish, rehearse the demo.
