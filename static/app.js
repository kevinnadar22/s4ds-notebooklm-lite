/* Product UI client for NotebookLM Lite */
const state = {
  sessionId: null,
  mode: "conversing",
  sources: [],
  uploading: false,
  voiceOpen: false,
  voiceBusy: false,
  mediaStream: null,
  mediaRecorder: null,
  audioChunks: [],
  audioCtx: null,
  analyser: null,
  vadTimer: null,
  spokenStarted: false,
  silenceMs: 0,
  libraryOpen: true,
};

const SPEECH_THRESHOLD = 0.018;

const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const emptyEl = $("empty-state");
const typingEl = $("typing");
const statusEl = $("status");
const questionEl = $("question");
const uploadOverlay = $("upload-overlay");
const voiceOverlay = $("voice-overlay");
const doneOverlay = $("done-overlay");
const voicePhase = $("voice-phase");
const voiceCaption = $("voice-caption");

function setStatus(text) {
  statusEl.textContent = text || "";
}

function setUiLocked(on) {
  document.body.classList.toggle("ui-locked", on);
  questionEl.disabled = on;
  $("send-btn").disabled = on;
  $("mic-btn").disabled = on && !state.voiceOpen;
  $("pdf-input").disabled = on;
  $("new-session").disabled = on;
}

function showUploadOverlay(on, sub) {
  uploadOverlay.classList.toggle("hidden", !on);
  uploadOverlay.setAttribute("aria-hidden", on ? "false" : "true");
  if (sub) $("upload-overlay-sub").textContent = sub;
  setUiLocked(on || state.voiceOpen || !doneOverlay.classList.contains("hidden"));
}

function showDoneOverlay(on, title = "Done") {
  doneOverlay.classList.toggle("hidden", !on);
  doneOverlay.setAttribute("aria-hidden", on ? "false" : "true");
  if (title) $("done-overlay-title").textContent = title;
  setUiLocked(on || state.uploading || state.voiceOpen);
}

async function flashDone(title = "Done", ms = 2000) {
  showDoneOverlay(true, title);
  await new Promise((r) => setTimeout(r, ms));
  showDoneOverlay(false);
}

function showVoiceOverlay(on) {
  state.voiceOpen = on;
  voiceOverlay.classList.toggle("hidden", !on);
  voiceOverlay.setAttribute("aria-hidden", on ? "false" : "true");
  setUiLocked(on || state.uploading);
  if (!on) voiceCaption.textContent = "";
}

function setVoicePhase(text) {
  voicePhase.textContent = text;
}

function showChat() {
  emptyEl.classList.add("hidden");
  messagesEl.classList.remove("hidden");
}

function resetChatPane() {
  messagesEl.innerHTML = "";
  messagesEl.classList.add("hidden");
  emptyEl.classList.remove("hidden");
  typingEl.classList.add("hidden");
}

function scrollChatToBottom() {
  const scroller = messagesEl?.closest(".overflow-y-auto");
  if (scroller) {
    scroller.scrollTop = scroller.scrollHeight;
    return;
  }
  const last = messagesEl?.lastElementChild || typingEl;
  last?.scrollIntoView({ behavior: "smooth", block: "end" });
}

function setTyping(on) {
  typingEl.classList.toggle("hidden", !on);
  if (on) {
    showChat();
    scrollChatToBottom();
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setMarkdown(el, text) {
  el.classList.remove("whitespace-pre-wrap");
  el.classList.add("md-body");
  if (window.marked) {
    el.innerHTML = marked.parse(text || "", { breaks: true, gfm: true });
  } else {
    el.textContent = text || "";
  }
}

function bubble(role, content = "") {
  showChat();
  const row = document.createElement("div");
  row.className =
    "msg-enter flex gap-3 items-start " + (role === "user" ? "flex-row-reverse" : "");

  const avatar = document.createElement("div");
  avatar.className = "h-8 w-8 rounded-full shrink-0 overflow-hidden";
  avatar.innerHTML =
    role === "user"
      ? `<img src="/static/user.png" alt="" class="h-full w-full object-cover" />`
      : `<img src="/static/bot.png" alt="" class="h-full w-full object-cover" />`;

  const col = document.createElement("div");
  col.className =
    "max-w-[85%] min-w-0 flex flex-col gap-2 " +
    (role === "user" ? "items-end" : "items-start");

  const body = document.createElement("div");
  body.className =
    "rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-sm " +
    (role === "user"
      ? "bg-primary text-primary-foreground rounded-tr-md whitespace-pre-wrap"
      : "bg-card border border-border text-card-foreground rounded-tl-md md-body");

  if (role === "assistant") setMarkdown(body, content);
  else body.textContent = content;

  col.appendChild(body);
  row.append(avatar, col);
  messagesEl.appendChild(row);
  scrollChatToBottom();
  return { body, col, row };
}

function renderRetrievalAccordion(col, chunks) {
  const details = document.createElement("details");
  details.className =
    "retrieval-acc w-full rounded-xl border border-border bg-muted/50 overflow-hidden";

  const count = chunks?.length || 0;
  const summary = document.createElement("summary");
  summary.className =
    "cursor-pointer select-none px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground list-none flex items-center justify-between gap-2";
  summary.innerHTML = `
    <span>Retrieved chunks · ${count}</span>
    <span class="text-[10px] uppercase tracking-wide opacity-70">toggle</span>
  `;

  const panel = document.createElement("div");
  panel.className = "border-t border-border px-3 py-2 space-y-2 max-h-64 overflow-y-auto";

  if (!count) {
    panel.innerHTML = `<p class="text-xs text-muted-foreground py-1">No chunks retrieved (chat without RAG).</p>`;
  } else {
    panel.innerHTML = chunks
      .map((c, i) => {
        const page = c.page != null ? ` · p.${Number(c.page) + 1}` : "";
        const preview =
          escapeHtml((c.text || "").slice(0, 280)) +
          ((c.text || "").length > 280 ? "…" : "");
        return `
        <article class="rounded-lg border border-border bg-card px-3 py-2">
          <div class="flex flex-wrap items-center gap-2 mb-1.5 text-[11px]">
            <span class="font-semibold text-foreground">#${i + 1}</span>
            <span class="rounded-md bg-accent text-accent-foreground px-1.5 py-0.5 font-medium">${escapeHtml(c.source || "unknown")}${page}</span>
            <span class="rounded-md bg-secondary text-secondary-foreground px-1.5 py-0.5 tabular-nums">relevance ${Number(c.relevance).toFixed(3)}</span>
            <span class="text-muted-foreground tabular-nums">distance ${Number(c.distance).toFixed(4)}</span>
          </div>
          <p class="text-xs leading-relaxed text-card-foreground whitespace-pre-wrap">${preview}</p>
        </article>`;
      })
      .join("");
  }

  details.append(summary, panel);
  col.appendChild(details);
}

function formatBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return iso;
  }
}

function renderDocsPanel(docs) {
  state.sources = docs || [];
  const list = $("docs-list");
  const count = state.sources.length;
  $("docs-count").textContent =
    count === 1 ? "1 source indexed" : `${count} sources indexed`;

  if (!count) {
    list.innerHTML = `<p id="docs-empty" class="text-xs text-muted-foreground px-2 py-6 text-center">No documents yet. Upload a PDF from chat.</p>`;
    return;
  }

  list.innerHTML = state.sources
    .map(
      (d) => `
      <article class="rounded-xl border border-border bg-card px-3 py-3 shadow-sm">
        <div class="flex items-start gap-2.5">
          <img src="/static/pdf.svg" alt="" class="mt-0.5 h-8 w-8 shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold truncate" title="${escapeHtml(d.filename)}">${escapeHtml(d.filename)}</p>
            <p class="doc-meta text-[11px] text-muted-foreground mt-1 leading-relaxed">
              ${d.chunks} chunks · ${formatBytes(d.bytes)}
              ${d.created_at ? `<br>${escapeHtml(formatWhen(d.created_at))}` : ""}
            </p>
          </div>
          <button type="button" class="doc-delete h-8 w-8 shrink-0 rounded-lg border border-border grid place-items-center text-muted-foreground hover:text-destructive hover:bg-accent transition" data-id="${d.id}" data-name="${escapeHtml(d.filename)}" title="Delete PDF" aria-label="Delete ${escapeHtml(d.filename)}">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h18"/>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              <line x1="10" x2="10" y1="11" y2="17"/>
              <line x1="14" x2="14" y1="11" y2="17"/>
            </svg>
          </button>
        </div>
      </article>`
    )
    .join("");

  list.querySelectorAll(".doc-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteDocument(btn.dataset.id, btn.dataset.name));
  });
}

async function deleteDocument(id, name) {
  if (!id || state.uploading || state.voiceOpen) return;
  const label = name || "this PDF";
  if (!window.confirm(`Delete ${label}? This removes it from the library and search index.`)) {
    return;
  }
  try {
    await api(`/documents/${id}`, { method: "DELETE" });
    await loadDocuments();
    $("upload-status").textContent = `Deleted ${label}`;
  } catch (err) {
    $("upload-status").textContent = err.message || "Delete failed";
  }
}

async function loadDocuments() {
  try {
    const res = await api("/documents");
    const data = await res.json();
    renderDocsPanel(data.documents || []);
  } catch (_) {
    renderDocsPanel([]);
  }
}

function renderSources() {
  // Kept for compatibility — library panel is the source of truth
  loadDocuments();
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data.detail || JSON.stringify(data);
    } catch (_) { }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res;
}

async function streamAsk(res, bodyEl) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let chunks = [];
  let lastScroll = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch (_) {
        continue;
      }
      if (evt.type === "sources") chunks = evt.chunks || [];
      else if (evt.type === "token") {
        full += evt.text || "";
        setMarkdown(bodyEl, full);
        const now = Date.now();
        if (now - lastScroll > 80) {
          lastScroll = now;
          scrollChatToBottom();
        }
      } else if (evt.type === "error") {
        full += (full ? "\n\n" : "") + (evt.text || "error");
        setMarkdown(bodyEl, full);
        scrollChatToBottom();
      }
    }
  }
  scrollChatToBottom();
  return { full, chunks };
}

async function ensureSession() {
  if (state.sessionId) return state.sessionId;
  const res = await api("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: state.mode }),
  });
  const data = await res.json();
  state.sessionId = data.id;
  $("session-meta").textContent = `Session #${data.id} · ${data.mode}`;
  return state.sessionId;
}

async function startSession(resetChat = true) {
  state.sessionId = null;
  if (resetChat) resetChatPane();
  await ensureSession();
  setStatus("");
}

function paintModeButtons() {
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    const on = btn.dataset.mode === state.mode;
    btn.className =
      "mode-btn rounded-lg px-3 py-1.5 text-xs font-semibold transition-all " +
      (on
        ? "bg-card text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground");
  });
}

document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (state.uploading || state.voiceOpen) return;
    state.mode = btn.dataset.mode;
    paintModeButtons();
    questionEl.placeholder =
      state.mode === "quiz"
        ? "Say “start quiz” or answer the current question…"
        : "Ask about your PDF…";
    await startSession(true);
  });
});

$("new-session").addEventListener("click", () => {
  if (state.uploading || state.voiceOpen) return;
  startSession(true);
});

/* ---------- Upload overlay ---------- */
$("pdf-input").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file || state.uploading || state.voiceOpen) return;
  state.uploading = true;
  showUploadOverlay(true, `Uploading ${file.name}…`);
  $("upload-status").textContent = "Indexing…";
  try {
    const body = new FormData();
    body.append("file", file);
    const res = await api("/upload", { method: "POST", body });
    const data = await res.json();
    state.sources.unshift({
      filename: data.filename,
      chunks: data.chunks,
      bytes: data.document?.bytes,
      created_at: data.document?.created_at,
    });
    await loadDocuments();
    $("upload-status").textContent = `${data.chunks} chunks ready`;
    showUploadOverlay(false);
    state.uploading = false;
    await flashDone("PDF indexed", 2000);
  } catch (err) {
    $("upload-status").textContent = err.message;
    showUploadOverlay(false);
    state.uploading = false;
  } finally {
    e.target.value = "";
  }
});

$("ask-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.uploading || state.voiceOpen) return;
  const question = questionEl.value.trim();
  if (!question) return;
  bubble("user", question);
  questionEl.value = "";
  setStatus("");
  setTyping(true);
  try {
    const sessionId = await ensureSession();
    const res = await api("/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, question }),
    });
    setTyping(false);
    const { body, col } = bubble("assistant", "");
    const { full, chunks } = await streamAsk(res, body);
    setMarkdown(body, full);
    renderRetrievalAccordion(col, chunks);
    scrollChatToBottom();
  } catch (err) {
    setTyping(false);
    setStatus(err.message);
  }
});

/* ---------- Live voice agent (manual ✓ to send) ---------- */
const voiceOrb = $("voice-orb");
const voiceSendBtn = $("voice-send");

function rmsLevel(analyser) {
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

function stopVad() {
  if (state.vadTimer) {
    clearInterval(state.vadTimer);
    state.vadTimer = null;
  }
}

function setVoiceUi(phase) {
  // phase: listening | processing | speaking
  voicePhase.dataset.state = phase;
  voiceOrb.classList.toggle("is-listening", phase === "listening");
  voiceOrb.classList.toggle("is-busy", phase !== "listening");
  if (phase !== "listening") voiceOrb.classList.remove("is-speaking");

  if (phase === "listening") {
    setVoicePhase("speak, then tap ✓");
    voiceSendBtn.disabled = false;
  } else if (phase === "processing") {
    setVoicePhase("Agent is thinking…");
    voiceSendBtn.disabled = true;
  } else if (phase === "speaking") {
    setVoicePhase("Agent speaking…");
    voiceSendBtn.disabled = true;
  }
}

function teardownMic() {
  stopVad();
  voiceOrb.classList.remove("is-speaking");
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    try {
      state.mediaRecorder.onstop = null;
      state.mediaRecorder.stop();
    } catch (_) { }
  }
  state.mediaRecorder = null;
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((t) => t.stop());
    state.mediaStream = null;
  }
  if (state.audioCtx) {
    state.audioCtx.close().catch(() => { });
    state.audioCtx = null;
  }
  state.analyser = null;
}

async function startListeningTurn() {
  if (!state.voiceOpen || state.voiceBusy) return;

  setVoiceUi("listening");
  voiceCaption.textContent = "";

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.mediaStream = stream;
  state.audioCtx = new AudioContext();
  const source = state.audioCtx.createMediaStreamSource(stream);
  state.analyser = state.audioCtx.createAnalyser();
  state.analyser.fftSize = 2048;
  source.connect(state.analyser);

  state.audioChunks = [];
  const recorder = new MediaRecorder(stream);
  state.mediaRecorder = recorder;
  recorder.ondataavailable = (ev) => {
    if (ev.data.size) state.audioChunks.push(ev.data);
  };
  recorder.start(200);

  // Glow only while user is speaking — does NOT auto-end the turn
  state.vadTimer = setInterval(() => {
    if (!state.voiceOpen || state.voiceBusy || !state.analyser) return;
    const speaking = rmsLevel(state.analyser) >= SPEECH_THRESHOLD;
    voiceOrb.classList.toggle("is-speaking", speaking);
  }, 80);
}

function submitVoiceTurn() {
  if (!state.voiceOpen || state.voiceBusy) return;
  if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") return;

  state.voiceBusy = true;
  setVoiceUi("processing");
  stopVad();
  voiceOrb.classList.remove("is-speaking");

  const recorder = state.mediaRecorder;
  recorder.onstop = () => {
    const blob = new Blob(state.audioChunks, { type: "audio/webm" });
    // Stop tracks after we have the blob
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((t) => t.stop());
      state.mediaStream = null;
    }
    if (state.audioCtx) {
      state.audioCtx.close().catch(() => { });
      state.audioCtx = null;
    }
    state.analyser = null;
    state.mediaRecorder = null;
    handleVoiceUtterance(blob);
  };
  recorder.stop();
}

async function handleVoiceUtterance(blob) {
  if (!state.voiceOpen) {
    state.voiceBusy = false;
    return;
  }
  if (!blob.size) {
    state.voiceBusy = false;
    setVoicePhase("Nothing captured — try again");
    startListeningTurn().catch((err) => setVoicePhase(err.message));
    return;
  }

  try {
    const sessionId = await ensureSession();
    const body = new FormData();
    body.append("session_id", String(sessionId));
    body.append("audio", blob, "utterance.webm");
    const res = await api("/ask-voice", { method: "POST", body });
    const data = await res.json();

    bubble("user", data.transcript || "(voice)");
    const { col } = bubble("assistant", data.answer || "");
    renderRetrievalAccordion(col, data.chunks || []);
    voiceCaption.textContent = data.answer || "";

    if (data.audio_base64) {
      setVoiceUi("speaking");
      const bytes = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([bytes], { type: data.audio_mime || "audio/mpeg" })
      );
      await new Promise((resolve) => {
        const audio = new Audio(url);
        audio.onended = resolve;
        audio.onerror = resolve;
        audio.play().catch(resolve);
      });
    }
  } catch (err) {
    setVoicePhase(err.message);
    await new Promise((r) => setTimeout(r, 1000));
  } finally {
    state.voiceBusy = false;
    if (state.voiceOpen) {
      startListeningTurn().catch((err) => setVoicePhase(err.message));
    }
  }
}

async function openVoiceAgent() {
  if (state.uploading || state.voiceOpen) return;
  showVoiceOverlay(true);
  setVoicePhase("Starting…");
  try {
    await ensureSession();
    await startListeningTurn();
  } catch (err) {
    setVoicePhase(err.message);
  }
}

function closeVoiceAgent() {
  state.voiceOpen = false;
  state.voiceBusy = false;
  teardownMic();
  showVoiceOverlay(false);
  setStatus("");
}

$("mic-btn").addEventListener("click", () => openVoiceAgent());
$("voice-close").addEventListener("click", () => closeVoiceAgent());
voiceSendBtn.addEventListener("click", () => submitVoiceTurn());

function setLibraryOpen(open) {
  state.libraryOpen = open;
  const panel = $("docs-panel");
  const toggle = $("docs-toggle");
  panel.classList.toggle("open", open);
  panel.classList.toggle("closed", !open);
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
}

$("docs-toggle").addEventListener("click", () => setLibraryOpen(!state.libraryOpen));
$("docs-close").addEventListener("click", () => setLibraryOpen(false));

questionEl.addEventListener("keydown", (e) => {
  if (state.uploading || state.voiceOpen) {
    e.preventDefault();
    return;
  }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("ask-form").requestSubmit();
  }
});

paintModeButtons();
loadDocuments().catch(() => {});
startSession(false).catch((err) => setStatus(err.message));
