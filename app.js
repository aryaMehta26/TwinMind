// ─────────────────────────────────────────────
//  TwinMind Live Suggestions — app.js
//  Models: whisper-large-v3 (STT) | llama-3.3-70b-versatile (LLM)
//  Change model in Settings to gpt-oss-120b when submitting for grading
// ─────────────────────────────────────────────

// ── STATE ────────────────────────────────────
const state = {
  groqKey: "",
  isRecording: false,
  mediaRecorder: null,
  transcript: [],        // { id, timestamp, text }
  suggestionBatches: [], // { id, timestamp, suggestions: [{type,preview,detail}] }
  chatHistory: [],       // { role, content }

  settings: {
    modelTranscribe: "whisper-large-v3",
    modelLlm: "llama-3.3-70b-versatile",

    promptSuggestions: `You are a real-time AI meeting copilot. Analyze the MOST RECENT part of the transcript and generate exactly 3 highly specific, immediately actionable suggestions.

CRITICAL RULES:
- Focus on the LAST thing said — that is what needs a response right now.
- Be SPECIFIC: use exact terms, names, numbers, or concepts from the transcript. Never be generic.
- Infer meeting type (job interview, technical discussion, sales call, lecture, casual) and tailor suggestions.
- Each of the 3 suggestions MUST be a different type:
  * "answer" — give a direct, specific answer to a question just asked in the transcript
  * "question" — a sharp follow-up question the speaker should ask next
  * "talking-point" — a specific fact, stat, or insight to add right now
  * "fact-check" — verify or correct a specific claim made in the transcript
  * "clarification" — resolve a specific ambiguous term or concept just mentioned
- "preview": 1 punchy, standalone sentence with SPECIFIC details (not vague). Should be useful WITHOUT clicking.
- "detail": 3-5 sentences packed with specifics — examples, numbers, definitions, comparisons.
- Do NOT repeat types. Do NOT be vague. Do NOT give generic meeting advice.

OUTPUT: valid JSON array only, no markdown wrapper:
[
  {"type":"answer","preview":"<specific 1-sentence answer>","detail":"<3-5 specific sentences>"},
  {"type":"question","preview":"<specific follow-up question>","detail":"<why ask this + what to listen for>"},
  {"type":"talking-point","preview":"<specific fact or insight>","detail":"<supporting details with numbers/examples>"}
]`,

    promptExpanded: `You are a knowledgeable AI assistant with access to a live conversation transcript. The user clicked a suggestion card — give them a thorough, specific, actionable answer grounded in what was actually said. Reference specific statements from the transcript. Avoid generic advice. Be concrete and direct.`,

    promptChat: `You are a helpful AI assistant embedded in a live meeting tool. You have the full conversation transcript as context. Answer the user's question accurately and concisely, referencing relevant parts of the transcript where helpful.`,

    ctxSuggestionsChunks: 10,
    ctxExpandedChunks: 50,
  },

  refreshCountdown: 30,
  _refreshTimer: null,
  _countdownTimer: null,
};

// ── DOM REFS ──────────────────────────────────
const el = {
  micBtn:          document.getElementById("mic-btn"),
  recStatus:       document.getElementById("recording-status"),
  transcriptBox:   document.getElementById("transcript-container"),

  refreshBtn:      document.getElementById("refresh-suggestions-btn"),
  countdown:       document.getElementById("countdown"),
  suggestionsBox:  document.getElementById("suggestions-container"),
  batchCount:      document.getElementById("batch-count-val"),

  chatBox:         document.getElementById("chat-container"),
  chatInput:       document.getElementById("chat-textarea"),
  chatSend:        document.getElementById("send-chat-btn"),

  settingsBtn:     document.getElementById("settings-btn"),
  settingsModal:   document.getElementById("settings-modal"),
  closeSettings:   document.getElementById("close-settings"),
  saveSettings:    document.getElementById("save-settings"),
  exportBtn:       document.getElementById("export-btn"),

  // settings inputs
  inpKey:          document.getElementById("groq-api-key"),
  inpSug:          document.getElementById("prompt-suggestions"),
  inpExpanded:     document.getElementById("prompt-expanded"),
  inpChat:         document.getElementById("prompt-chat"),
  inpModel:        document.getElementById("model-llm"),
  inpCtxSug:       document.getElementById("ctx-suggestions"),
  inpCtxExpanded:  document.getElementById("ctx-expanded"),
};

// ── INIT ──────────────────────────────────────
function init() {
  // Restore key from localStorage so refreshes don't wipe it
  state.groqKey = localStorage.getItem("twinmind_groq_key") || "";
  syncSettingsInputs();
  bindEvents();
  if (!state.groqKey) openSettings();
}

function syncSettingsInputs() {
  el.inpKey.value        = state.groqKey;
  el.inpSug.value        = state.settings.promptSuggestions;
  el.inpExpanded.value   = state.settings.promptExpanded;
  el.inpChat.value       = state.settings.promptChat;
  el.inpModel.value      = state.settings.modelLlm;
  el.inpCtxSug.value     = state.settings.ctxSuggestionsChunks;
  el.inpCtxExpanded.value = state.settings.ctxExpandedChunks;
}

function bindEvents() {
  el.settingsBtn.addEventListener("click", openSettings);
  el.closeSettings.addEventListener("click", closeSettingsModal);
  el.saveSettings.addEventListener("click", saveSettings);

  el.micBtn.addEventListener("click", toggleMic);
  el.refreshBtn.addEventListener("click", manualRefresh);

  el.chatSend.addEventListener("click", () => sendChat());
  el.chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  el.exportBtn.addEventListener("click", exportSession);
}

function openSettings()       { el.settingsModal.classList.remove("hidden"); }
function closeSettingsModal() { el.settingsModal.classList.add("hidden"); }

function saveSettings() {
  state.groqKey = el.inpKey.value.trim();
  localStorage.setItem("twinmind_groq_key", state.groqKey); // persist across refreshes
  state.settings.promptSuggestions        = el.inpSug.value;
  state.settings.promptExpanded           = el.inpExpanded.value;
  state.settings.promptChat               = el.inpChat.value;
  state.settings.modelLlm                 = el.inpModel.value.trim();
  state.settings.ctxSuggestionsChunks     = toInt(el.inpCtxSug.value, 1, 50, 10);
  state.settings.ctxExpandedChunks        = toInt(el.inpCtxExpanded.value, 1, 200, 50);
  closeSettingsModal();
}

function toInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  return isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// ── GROQ API ──────────────────────────────────
async function groqTranscribe(blob) {
  const form = new FormData();
  form.append("file", blob, "audio.webm");
  form.append("model", state.settings.modelTranscribe);
  form.append("response_format", "json");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${state.groqKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper error ${res.status}: ${await res.text()}`);
  return (await res.json()).text || "";
}

async function groqChat(messages, stream = false) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${state.groqKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: state.settings.modelLlm,
      messages,
      temperature: 0.9,
      stream,
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  return res;
}

// ── MICROPHONE ────────────────────────────────
async function toggleMic() {
  state.isRecording ? stopMic() : await startMic();
}

async function startMic() {
  if (!state.groqKey) { openSettings(); return; }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    state.mediaRecorder._stream = stream;

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) handleAudioChunk(e.data);
    };

    state.mediaRecorder.start(30000); // chunk every 30s
    state.isRecording = true;

    el.micBtn.classList.add("active");
    el.recStatus.textContent = "RECORDING (LIVE)";
    el.recStatus.className = "status-badge recording";

    if (state.transcript.length === 0) el.transcriptBox.innerHTML = "";

    startTimers();
  } catch (err) {
    alert("Could not access microphone: " + err.message);
  }
}

function stopMic() {
  if (state.mediaRecorder?.state !== "inactive") state.mediaRecorder.stop();
  state.mediaRecorder?._stream?.getTracks().forEach((t) => t.stop());

  state.isRecording = false;
  el.micBtn.classList.remove("active");
  el.recStatus.textContent = "IDLE";
  el.recStatus.className = "status-badge idle";

  stopTimers();

  // Auto-generate suggestions on stop
  if (state.transcript.length > 0) generateSuggestions();
}

async function handleAudioChunk(blob) {
  try {
    const text = await groqTranscribe(blob);
    if (!text.trim()) return;

    const chunk = { id: Date.now(), timestamp: new Date().toLocaleTimeString(), text };
    state.transcript.push(chunk);

    const div = document.createElement("div");
    div.className = "transcript-chunk";
    div.innerHTML = `<span class="chunk-time">${chunk.timestamp}</span>${chunk.text}`;
    el.transcriptBox.appendChild(div);
    el.transcriptBox.scrollTop = el.transcriptBox.scrollHeight;
  } catch (err) {
    console.error("Transcription failed:", err);
  }
}

// ── TIMERS ────────────────────────────────────
function startTimers() {
  state.refreshCountdown = 30;
  el.countdown.textContent = 30;

  state._countdownTimer = setInterval(() => {
    state.refreshCountdown = Math.max(0, state.refreshCountdown - 1);
    el.countdown.textContent = state.refreshCountdown || 30;
    if (state.refreshCountdown === 0) state.refreshCountdown = 30;
  }, 1000);

  state._refreshTimer = setInterval(generateSuggestions, 30000);
}

function stopTimers() {
  clearInterval(state._refreshTimer);
  clearInterval(state._countdownTimer);
  el.countdown.textContent = 30;
}

// ── SUGGESTIONS ───────────────────────────────
async function manualRefresh() {
  el.refreshBtn.textContent = "↻ Processing...";
  el.refreshBtn.disabled = true;

  // Flush current mic buffer immediately
  if (state.mediaRecorder?.state === "recording") {
    await new Promise((resolve) => {
      const onData = async (e) => {
        state.mediaRecorder.removeEventListener("dataavailable", onData);
        if (e.data?.size > 0) await handleAudioChunk(e.data);
        resolve();
      };
      state.mediaRecorder.addEventListener("dataavailable", onData, { once: true });
      state.mediaRecorder.requestData();
    });
  }

  await generateSuggestions();

  el.refreshBtn.textContent = "↻ Reload suggestions";
  el.refreshBtn.disabled = false;
}

async function generateSuggestions() {
  if (state.transcript.length === 0) return;

  const n = state.settings.ctxSuggestionsChunks;
  const ctx = state.transcript.slice(-n).map((c) => c.text).join(" ");

  try {
    const res = await groqChat([
      { role: "system", content: state.settings.promptSuggestions },
      { role: "user", content: `Recent transcript:\n\n${ctx}\n\nGenerate the 3 suggestions JSON now.` },
    ]);

    const raw = (await res.json()).choices[0].message.content;
    const arrStart = raw.indexOf("[");
    const arrEnd   = raw.lastIndexOf("]") + 1;
    if (arrStart < 0) throw new Error("No JSON array in response");

    const suggestions = JSON.parse(raw.slice(arrStart, arrEnd));
    if (!Array.isArray(suggestions) || suggestions.length === 0) throw new Error("Empty suggestions array");

    const batch = { id: Date.now(), timestamp: new Date().toLocaleTimeString(), suggestions };
    state.suggestionBatches.unshift(batch);
    el.batchCount.textContent = state.suggestionBatches.length;
    renderSuggestions();
  } catch (err) {
    console.error("Suggestions error:", err);
    showSuggestionError(err.message);
  }
}

function renderSuggestions() {
  el.suggestionsBox.innerHTML = "";

  state.suggestionBatches.forEach((batch, i) => {
    const wrap = document.createElement("div");
    wrap.className = `suggestion-batch${i > 0 ? " faded" : ""}`;

    if (i > 0) {
      wrap.innerHTML = `<div class="batch-divider">OLDER BATCH — ${batch.timestamp}</div>`;
    }

    batch.suggestions.forEach((sug) => {
      const card = document.createElement("div");
      card.className = "suggestion-card";
      card.dataset.type = sug.type || "question";
      card.innerHTML = `<span class="card-type">${sug.type}</span><div class="card-preview">${sug.preview}</div>`;
      card.addEventListener("click", () => sendChat(`Expand: ${sug.preview}`, sug.detail, true));
      wrap.appendChild(card);
    });

    el.suggestionsBox.appendChild(wrap);
  });
}

function showSuggestionError(msg) {
  const wrap = document.createElement("div");
  wrap.className = "suggestion-batch";
  wrap.innerHTML = `<div class="suggestion-card" data-type="error"><span class="card-type">error</span><div class="card-preview">⚠ ${msg}</div></div>`;
  el.suggestionsBox.prepend(wrap);
}

// ── CHAT ──────────────────────────────────────
async function sendChat(displayText = null, hiddenPrompt = null, isExpanded = false) {
  const typed    = el.chatInput.value.trim();
  const toShow   = displayText || typed;
  const toSend   = hiddenPrompt || typed;
  if (!toShow) return;

  el.chatInput.value = "";
  if (state.chatHistory.length === 0) el.chatBox.innerHTML = "";

  // User bubble
  const userBubble = document.createElement("div");
  userBubble.className = "chat-bubble user";
  userBubble.textContent = toShow;
  el.chatBox.appendChild(userBubble);
  el.chatBox.scrollTop = el.chatBox.scrollHeight;

  // AI bubble (streaming)
  const aiBubble = document.createElement("div");
  aiBubble.className = "chat-bubble ai";
  aiBubble.innerHTML = '<div class="loading-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
  el.chatBox.appendChild(aiBubble);
  el.chatBox.scrollTop = el.chatBox.scrollHeight;

  const sysPrompt = isExpanded ? state.settings.promptExpanded : state.settings.promptChat;
  const n         = isExpanded ? state.settings.ctxExpandedChunks : state.transcript.length;
  const ctx       = state.transcript.slice(-n).map((c) => c.text).join(" ");

  const messages = [
    { role: "system", content: `${sysPrompt}\n\nTranscript:\n${ctx}` },
    ...state.chatHistory,
    { role: "user", content: toSend },
  ];

  try {
    const res    = await groqChat(messages, true);
    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let full     = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const line of dec.decode(value, { stream: true }).split("\n")) {
        const s = line.replace(/^data: /, "").trim();
        if (!s || s === "[DONE]") continue;
        try {
          const token = JSON.parse(s).choices[0].delta?.content || "";
          full += token;
          aiBubble.innerHTML = escHtml(full).replace(/\n/g, "<br>");
          el.chatBox.scrollTop = el.chatBox.scrollHeight;
        } catch {}
      }
    }

    state.chatHistory.push({ role: "user", content: toSend });
    state.chatHistory.push({ role: "assistant", content: full });
  } catch (err) {
    aiBubble.textContent = "⚠ " + err.message;
  }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── EXPORT ────────────────────────────────────
function exportSession() {
  const data = {
    exportDate:  new Date().toISOString(),
    transcript:  state.transcript,
    suggestions: state.suggestionBatches,
    chat:        state.chatHistory,
  };
  const a  = document.createElement("a");
  a.href   = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `TwinMind_${Date.now()}.json`;
  a.click();
}

// ── BOOT ──────────────────────────────────────
window.addEventListener("load", init);
