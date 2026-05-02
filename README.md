<div align="center">

# 🧠 TwinMind — Live Suggestions Web App

### Real-time AI meeting copilot that listens, understands, and surfaces actionable suggestions as you speak.

<br/>

![Home Page](./screenshots/home.png)

<br/>

[![Live Demo](https://img.shields.io/badge/🚀%20Live%20Demo-Click%20Here-6366f1?style=for-the-badge)](https://twinmindtest.netlify.app)
[![Built With](https://img.shields.io/badge/Built%20With-Vanilla%20JS%20%2B%20Groq-10b981?style=for-the-badge)](#)
[![Model](https://img.shields.io/badge/LLM-Llama%203.3%2070B-f59e0b?style=for-the-badge)](#)
[![STT](https://img.shields.io/badge/STT-Whisper%20Large%20V3-3b82f6?style=for-the-badge)](#)

</div>

---

## 📖 What is this?

This is a submission for the **TwinMind Live Suggestions Engineering Challenge**. The goal: build a real-time web app that listens to your microphone and continuously surfaces 3 contextually-aware, immediately-actionable suggestions based on what is being said — exactly like TwinMind's live suggestions feature, but built from scratch.

The app solves one of the hardest problems in AI-assisted conversation tools:

> **Showing the right thing at the right time, while a conversation is happening.**

Every suggestion must feel like it was generated *for this exact moment* in the conversation — not generic advice, not a summary. That's the bar this project is built to clear.

---

## 🖥️ Interface

The app is a clean **3-column dark-mode layout**:

| Column | Purpose |
|--------|---------|
| 🎙️ **Left** | Mic button + live rolling transcript with timestamps |
| 💡 **Middle** | 3 AI suggestion cards, refreshed every ~30s, stacked newest-first |
| 💬 **Right** | Streaming chat — click a card or type directly |

![Dashboard](./screenshots/dashboard.png)

---

## ⚡ Quick Start

### 1. Get a Free Groq API Key
1. Go to **[console.groq.com](https://console.groq.com)**
2. Sign up for free (takes 30 seconds)
3. Click **"API Keys"** → **"Create API Key"**
4. Copy your key (it starts with `gsk_...`)

### 2. Open the App
**Option A — Use the live deploy:**
👉 **[https://twinmindtest.netlify.app](https://twinmindtest.netlify.app)**

**Option B — Run locally (zero install required):**
```bash
git clone https://github.com/aryaMehta26/TwinMind.git
cd TwinMind
python3 -m http.server 8000
# Open http://localhost:8000
```

### 3. Paste Your API Key
When the app loads, a **Settings modal** appears automatically. Paste your `gsk_...` key and click **Save Settings**. The key is saved to your browser's `localStorage` — you'll never need to enter it again on this device.

### 4. Start Talking
1. Click the **blue mic button** (left column)
2. Speak naturally — the transcript appears every ~30 seconds
3. Watch the **middle column** populate with 3 smart suggestion cards
4. Click any card to get a **detailed streaming answer** in the right chat panel
5. Or type directly in the chat input at the bottom right

### 5. Export Your Session
Click **📤 Export** in the header to download a full JSON file with:
- Every transcript chunk + timestamp
- Every suggestion batch + timestamp  
- Full chat history

---

## 🛠️ Technical Architecture

### Why No Framework, No Backend, No Build Step?

The assignment explicitly said: *"Do not over-engineer."* This entire app is 4 files:

```
TwinMind/
├── index.html     # Structure & settings modal
├── styles.css     # Full dark-mode design system
├── app.js         # All logic (~430 lines, zero dependencies)
└── README.md
```

**No React. No Node. No Webpack. No `package.json`.** This means:
- **Deploy anywhere in seconds** — drag a folder into Netlify
- **Zero cold starts** — every resource is served as a static file
- **Readable code** — any engineer can open `app.js` and understand it immediately
- **Groq's API is CORS-enabled** — browser calls go directly to Groq, no proxy needed

### Audio Pipeline

```
Mic (getUserMedia)
    ↓
MediaRecorder (timeslice: 30,000ms)
    ↓  [30s WebM audio chunks]
groqTranscribe() — POST /audio/transcriptions
    ↓  [whisper-large-v3]
transcript[] — in-memory array of { id, timestamp, text }
    ↓
generateSuggestions() — POST /chat/completions
    ↓  [llama-3.3-70b-versatile, temp: 0.9]
3 suggestion cards rendered in middle column
```

**Manual Refresh:** Calls `mediaRecorder.requestData()` to flush the current partial audio buffer immediately — so you don't have to wait for the 30s timer if you want fresh suggestions right now.

### Models

| Task | Model | Why |
|------|-------|-----|
| Speech-to-Text | `whisper-large-v3` | Highest accuracy Whisper model on Groq. ~1s per 30s chunk. |
| Suggestions + Chat | `llama-3.3-70b-versatile` | Groq's current flagship. 800+ tokens/second. Zero perceptible latency on streaming chat. |

> **Note for graders:** The `model` field is editable in the Settings modal. To test with `gpt-oss-120b`, open Settings and change the model name — no code change needed.

### State Management

No Redux, no Zustand. One plain JS object:

```js
const state = {
  groqKey: "",          // loaded from localStorage
  transcript: [],       // { id, timestamp, text }
  suggestionBatches: [], // { id, timestamp, suggestions[] }
  chatHistory: [],      // { role, content } — passed to every chat call
  settings: { ... }    // all prompts + context window sizes
};
```

This is intentional. The app is session-scoped by design — the assignment said "no persistence needed when reloading." A single state object is the cleanest way to model that.

---

## 🧠 Prompt Engineering Strategy

This is the core of the assignment. Here's every decision and why.

### The Suggestions Prompt

The most important realization: **generic prompts produce generic suggestions.** The model needs explicit constraints on what it is *not* allowed to do.

```
You are a real-time AI meeting copilot. Analyze the MOST RECENT part 
of the transcript and generate exactly 3 highly specific, immediately 
actionable suggestions.

CRITICAL RULES:
- Focus on the LAST thing said — that is what needs a response right now.
- Be SPECIFIC: use exact terms, names, numbers, or concepts from the transcript. Never be generic.
- Each of the 3 suggestions MUST be a different type (answer/question/talking-point/fact-check/clarification)
- "preview": 1 punchy sentence. Must be useful WITHOUT clicking.
- "detail": 3-5 sentences with specifics — examples, numbers, definitions.
- Do NOT repeat types. Do NOT be vague. Do NOT give generic meeting advice.
```

**Key decisions:**

1. **Recency bias** — "Focus on the LAST thing said." Without this, the model summarizes the whole conversation instead of reacting to the current moment. This was the single biggest quality improvement.

2. **Forced type diversity** — Each card must be a different type. Without this, you get 3 variations of the same idea. With it, you get an `answer`, a `question`, and a `talking-point` — three genuinely different angles on the same moment.

3. **Preview must work standalone** — The preview should deliver value even if the user never clicks. This pushes the model to put real information in the preview, not just a teaser.

4. **Temperature 0.9** — High enough to prevent repetition across refreshes. Low enough to stay grounded in the transcript.

### Meeting Type Inference

Rather than asking users to label their meeting type, the prompt infers it:

> *"Infer meeting type (job interview, technical discussion, sales call, lecture, casual) and tailor suggestions."*

In testing, when the transcript shifts from "tell me about yourself" → "describe microservices architecture," the suggestions shift from interview coaching to technical definitions and architecture questions automatically.

### Context Window Strategy

| Use Case | Window | Rationale |
|----------|--------|-----------|
| Suggestions | Last **10 chunks** (~5 min) | Recent enough to be relevant. Prevents the model from over-indexing on old context. |
| Expanded answer (on card click) | Last **50 chunks** | User wants depth. More context = better grounding for a detailed answer. |
| Chat (free-form) | Full transcript | The user is asking a direct question and deserves the complete picture. |

### Separate Prompts for Suggestions vs. Chat vs. Expanded

Using one prompt for everything would degrade everything:
- **Suggestions prompt** → optimize for speed, brevity, JSON output, 3 items exactly
- **Expanded prompt** → optimize for depth, specificity, grounded in transcript, prose format
- **Chat prompt** → optimize for conversational accuracy, full context awareness

All 3 are independently editable in the Settings modal so evaluators can tune them.

### Streaming Chat

Chat responses stream token-by-token using Groq's SSE endpoint:

```js
const reader = res.body.getReader();
while (true) {
  const { value, done } = await reader.read();
  // parse SSE line → extract delta.content → append to bubble
  aiBubble.innerHTML = escHtml(full).replace(/\n/g, "<br>");
}
```

Time-to-first-token is typically **< 300ms** on Groq. The streaming render makes it feel instant.

---

## ⚙️ Settings Reference

Every parameter is editable in the **⚙️ Settings modal** without touching code.

| Setting | Default | Effect |
|---------|---------|--------|
| Groq API Key | *(blank)* | Required. Stored in `localStorage`. |
| Live Suggestions Prompt | (optimized) | The system prompt sent with each suggestion request. |
| Expanded Answer Prompt | (optimized) | Used when user clicks a suggestion card. |
| Chat System Prompt | (optimized) | Used for free-form chat messages. |
| Suggestions Context Window | `10` chunks | How many past transcript chunks to send for suggestions. |
| Expanded Answer Context Window | `50` chunks | How many past chunks to send for card-click answers. |
| Transcription Model | `whisper-large-v3` | Read-only display. |
| Suggestions/Chat Model | `llama-3.3-70b-versatile` | Change to `gpt-oss-120b` for grading evaluation. |

---

## 📤 Export Format

The Export button downloads a JSON file structured as:

```json
{
  "exportDate": "2026-05-02T12:00:00.000Z",
  "transcript": [
    { "id": 1234567890, "timestamp": "4:53:21 AM", "text": "Tell me about yourself." }
  ],
  "suggestions": [
    {
      "id": 1234567891,
      "timestamp": "4:53:29 AM",
      "suggestions": [
        {
          "type": "answer",
          "preview": "Microservices split apps into small, independently deployable services.",
          "detail": "Each microservice owns one business capability..."
        }
      ]
    }
  ],
  "chat": [
    { "role": "user", "content": "Expand: Microservices split apps..." },
    { "role": "assistant", "content": "Great question. Microservices architecture..." }
  ]
}
```

---

## 🚧 Tradeoffs & What I'd Do With More Time

| Decision | Tradeoff |
|----------|----------|
| No backend | Groq key exposed to browser network tab. For production, a thin proxy would hide it. For a demo with user-supplied keys, this is fine. |
| Browser MediaRecorder (WebM) | Not all browsers support `audio/webm`. Safari requires `audio/mp4`. A production version would detect codec support and set the MIME type accordingly. |
| In-memory state (no DB) | Session is lost on page refresh, by design. For production, transcript + chat would persist to a backend store. |
| Vanilla JS | Slightly more verbose than React for state updates, but zero build overhead and completely readable by any engineer on the team. |
| Fixed 30s chunks | For fast-paced conversations, 30s might be too slow. A smarter version would detect silence and flush early, giving more frequent transcript + suggestion updates. |

---

## 👤 Author

**Arya Mehta** — [@aryaMehta26](https://github.com/aryaMehta26)

Built as part of the TwinMind Engineering Challenge, April 2026.
