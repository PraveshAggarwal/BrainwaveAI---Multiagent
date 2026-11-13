/* ══════════════════════════════════════════════════════════════════════════════
   Brainwave AI – Chatbot Frontend Logic
   (No chat history / localStorage — fresh session every time)
   ══════════════════════════════════════════════════════════════════════════════ */

const API_BASE_DEFAULT = "http://127.0.0.1:5000";
let API_BASE = API_BASE_DEFAULT;

// ── DOM References ──
const chatMessages = document.getElementById("chatMessages");
const welcomeScreen = document.getElementById("welcomeScreen");
const topicInput = document.getElementById("topicInput");
const sendBtn = document.getElementById("sendBtn");
const stopBtn = document.getElementById("stopBtn");
const newChatBtn = document.getElementById("newChatBtn");
const topbarLabel = document.getElementById("topbarLabel");
const topbarStatus = document.getElementById("topbarStatus");
const downloadBtn = document.getElementById("downloadBtn");
const topicChips = document.querySelectorAll(".topic-chip");

// ── State ──
let isRunning = false;
let abortController = null;
let currentReport = null;

// ══════════════════════════════════════════════════════════════════════════════
//  INITIALIZATION
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", async () => {
  // Load API_BASE from backend config
  try {
    const res = await fetch(`${API_BASE_DEFAULT}/api/config`);
    const cfg = await res.json();
    if (cfg.api_base) API_BASE = cfg.api_base;
  } catch {
    // fallback to default — backend may not be running yet
  }

  setupInputAutoResize();

  // Configure marked.js
  marked.setOptions({
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
    breaks: true,
    gfm: true,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  EVENT HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

// Send button
sendBtn.addEventListener("click", () => handleSend());

// Enter key (Shift+Enter = newline)
topicInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// Stop button
stopBtn.addEventListener("click", () => {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  setRunning(false);
  appendSystemMessage("Pipeline stopped by user.");
});

// New chat — just clears the screen
newChatBtn.addEventListener("click", () => startNewChat());

// Quick topic chips
topicChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    topicInput.value = chip.dataset.topic;
    topicInput.focus();
    autoResizeTextarea();
  });
});

// Download report
downloadBtn.addEventListener("click", () => {
  if (!currentReport) return;
  const blob = new Blob([currentReport], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `brainwave_ai_report_${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
});

// ══════════════════════════════════════════════════════════════════════════════
//  CORE: SEND & PIPELINE
// ══════════════════════════════════════════════════════════════════════════════

async function handleSend() {
  const topic = topicInput.value.trim();
  if (!topic || isRunning) return;

  // Hide welcome screen
  const ws = document.getElementById("welcomeScreen");
  if (ws) {
    ws.style.display = "none";
  }

  // Show user message
  appendUserMessage(topic);
  topicInput.value = "";
  autoResizeTextarea();
  topbarLabel.textContent = topic.substring(0, 60);

  // Run pipeline
  setRunning(true);
  currentReport = null;
  downloadBtn.style.display = "none";

  // Show progress bar
  const progressEl = appendProgressBar();

  abortController = new AbortController();

  try {
    const response = await fetch(`${API_BASE}/api/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `Server error (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    let searchContent = null;
    let readerContent = null;
    let writerContent = null;
    let criticContent = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.substring(6).trim();
        if (!jsonStr) continue;

        let event;
        try {
          event = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        switch (event.type) {
          case "step_start":
            updateProgress(progressEl, event.step, "running");
            appendStepIndicator(
              event.step,
              event.title,
              "running",
              event.description,
            );
            topbarStatus.textContent = `Step ${event.step}/4 · ${event.title}`;
            break;

          case "step_done":
            updateProgress(progressEl, event.step, "done");
            updateStepIndicator(event.step, "done");

            if (event.step === 1) searchContent = event.content;
            if (event.step === 2) readerContent = event.content;
            if (event.step === 3) writerContent = event.content;
            if (event.step === 4) criticContent = event.content;
            break;

          case "step_error":
            updateProgress(progressEl, event.step, "error");
            updateStepIndicator(event.step, "error");
            appendAgentMessage("⚠️ Error", event.error, "error");
            break;

          case "rate_limit_error":
            updateProgress(progressEl, event.step, "error");
            updateStepIndicator(event.step, "error");
            appendRateLimitMessage(event.retry_after);
            topbarStatus.textContent = "✗ Rate Limited";
            break;

          case "pipeline_done":
            // Show raw results (collapsible)
            if (searchContent) {
              appendAgentMessage(
                "🔍 Search Agent",
                searchContent,
                "search",
                true,
              );
            }
            if (readerContent) {
              appendAgentMessage(
                "📄 Reader Agent",
                readerContent,
                "reader",
                true,
              );
            }
            // Show report
            if (event.report) {
              appendReport(event.report);
              currentReport = event.report;
              downloadBtn.style.display = "flex";
            }
            // Show feedback
            if (event.feedback) {
              appendFeedback(event.feedback);
            }

            topbarStatus.textContent = "✓ Complete";
            break;

          case "pipeline_error":
            appendSystemMessage(`Pipeline error: ${event.message}`);
            topbarStatus.textContent = "✗ Failed";
            break;

        }
      }
    }
  } catch (err) {
    if (err.name === "AbortError") {
      // User cancelled — already handled
    } else {
      appendSystemMessage(
        `Connection error: ${err.message}. Make sure the API server is running on ${API_BASE}`,
      );
      topbarStatus.textContent = "✗ Connection Error";
    }
  } finally {
    setRunning(false);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  UI RENDERING FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

function appendUserMessage(text) {
  const div = document.createElement("div");
  div.className = "message user";
  div.innerHTML = `<div class="msg-bubble">${escapeHtml(text)}</div>`;
  chatMessages.appendChild(div);
  scrollToBottom();
}

function appendAgentMessage(agentName, content, type = "", collapsed = false) {
  const icons = {
    search: "🔍",
    reader: "📄",
    writer: "✍️",
    critic: "🧐",
    error: "⚠️",
  };
  const icon = icons[type] || "🤖";

  const div = document.createElement("div");
  div.className = "message assistant";

  if (collapsed) {
    // Collapsible raw output
    const id = `raw_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    div.innerHTML = `
            <div class="msg-avatar">${icon}</div>
            <div class="msg-content">
                <div class="msg-agent-name">${escapeHtml(agentName)}</div>
                <button class="raw-toggle" onclick="toggleRaw('${id}', this)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                    View raw output
                </button>
                <div class="raw-content" id="${id}">
                    <div class="raw-content-inner">${escapeHtml(truncate(content, 2000))}</div>
                </div>
            </div>
        `;
  } else {
    div.innerHTML = `
            <div class="msg-avatar">${icon}</div>
            <div class="msg-content">
                <div class="msg-agent-name">${escapeHtml(agentName)}</div>
                <div class="msg-bubble assistant-bubble">${escapeHtml(content)}</div>
            </div>
        `;
  }

  chatMessages.appendChild(div);
  scrollToBottom();
}

function appendStepIndicator(step, title, state, description) {
  const existingEl = document.getElementById(`step-indicator-${step}`);
  if (existingEl) {
    existingEl.remove();
  }

  const div = document.createElement("div");
  div.className = "step-indicator";
  div.id = `step-indicator-${step}`;

  const statusText = {
    running: `<div class="spinner"></div> Running…`,
    done: "✓ Done",
    error: "✗ Error",
  };

  div.innerHTML = `
        <div class="step-pill ${state}">
            <span class="step-num">STEP ${step}/4</span>
            <span class="step-name">${escapeHtml(title)}</span>
            <span class="step-status-text">${statusText[state] || ""}</span>
        </div>
    `;

  chatMessages.appendChild(div);
  scrollToBottom();
}

function updateStepIndicator(step, state) {
  const el = document.getElementById(`step-indicator-${step}`);
  if (!el) return;

  const pill = el.querySelector(".step-pill");
  pill.className = `step-pill ${state}`;

  const statusEl = pill.querySelector(".step-status-text");
  if (state === "done") {
    statusEl.innerHTML = "✓ Done";
  } else if (state === "error") {
    statusEl.innerHTML = "✗ Error";
  }
}

function appendProgressBar() {
  const div = document.createElement("div");
  div.className = "pipeline-progress";
  div.id = "pipeline-progress";

  div.innerHTML = `
        <div class="progress-bar-container">
            <div class="progress-steps">
                <div class="progress-step" id="prog-step-1"></div>
                <div class="progress-step" id="prog-step-2"></div>
                <div class="progress-step" id="prog-step-3"></div>
                <div class="progress-step" id="prog-step-4"></div>
            </div>
            <div class="progress-label">
                <span class="current-step" id="prog-label">Initializing pipeline…</span>
                <span>4 steps</span>
            </div>
        </div>
    `;

  chatMessages.appendChild(div);
  scrollToBottom();
  return div;
}

function updateProgress(progressEl, step, state) {
  if (!progressEl) return;

  const stepEl = progressEl.querySelector(`#prog-step-${step}`);
  if (stepEl) {
    stepEl.className = `progress-step ${state}`;
  }

  const label = progressEl.querySelector("#prog-label");
  const stepNames = {
    1: "Search Agent",
    2: "Reader Agent",
    3: "Writer Agent",
    4: "Critic Agent",
  };

  if (state === "running") {
    label.textContent = `Running ${stepNames[step]}…`;
  } else if (state === "done" && step === 4) {
    label.textContent = "Pipeline complete ✓";
    label.style.color = "var(--green)";
  } else if (state === "done") {
    label.textContent = `${stepNames[step]} done · Moving to next…`;
  }
}

function appendReport(reportMd) {
  const div = document.createElement("div");
  div.className = "message assistant";

  div.innerHTML = `
        <div class="msg-avatar">✍️</div>
        <div class="msg-content">
            <div class="msg-agent-name">Final Research Report</div>
            <div class="report-panel">
                <div class="report-label">📝 Research Report</div>
                <div class="md-content">${marked.parse(reportMd)}</div>
            </div>
        </div>
    `;

  chatMessages.appendChild(div);
  scrollToBottom();
}

function appendFeedback(feedbackMd) {
  const div = document.createElement("div");
  div.className = "message assistant";

  div.innerHTML = `
        <div class="msg-avatar">🧐</div>
        <div class="msg-content">
            <div class="msg-agent-name">Critic Feedback</div>
            <div class="feedback-panel">
                <div class="feedback-label">🧐 Review & Score</div>
                <div class="md-content">${marked.parse(feedbackMd)}</div>
            </div>
        </div>
    `;

  chatMessages.appendChild(div);
  scrollToBottom();
}

function appendSystemMessage(text) {
  const div = document.createElement("div");
  div.className = "message assistant";
  div.innerHTML = `
        <div class="msg-avatar">⚙️</div>
        <div class="msg-content">
            <div class="msg-agent-name">System</div>
            <div class="msg-bubble assistant-bubble" style="border-color: rgba(248,113,113,0.2); color: var(--text-secondary);">
                ${escapeHtml(text)}
            </div>
        </div>
    `;
  chatMessages.appendChild(div);
  scrollToBottom();
}

function appendRateLimitMessage(retryAfter) {
  const retryNote = retryAfter
    ? `The limit should reset around <strong>${retryAfter}</strong> — please try again then.`
    : `Please wait a few minutes for the quota to reset, then try again.`;

  const div = document.createElement("div");
  div.className = "message assistant";
  div.innerHTML = `
        <div class="msg-avatar">⏳</div>
        <div class="msg-content">
            <div class="msg-agent-name">Rate Limit Reached</div>
            <div class="msg-bubble assistant-bubble" style="border-color: rgba(251,191,36,0.35); background: rgba(251,191,36,0.06);">
                <strong>🚦 Free-tier quota exhausted</strong><br>
                This project runs on a free-tier Gemini API key, so the request limit has been reached for now.<br><br>
                ${retryNote}
            </div>
        </div>
    `;
  chatMessages.appendChild(div);
  scrollToBottom();
}

// ══════════════════════════════════════════════════════════════════════════════
//  NEW CHAT (simple reset — no save)
// ══════════════════════════════════════════════════════════════════════════════

function startNewChat() {
  currentReport = null;
  downloadBtn.style.display = "none";
  topbarLabel.textContent = "New Research";
  topbarStatus.textContent = "";

  // Clear all messages and re-show welcome
  chatMessages.innerHTML = "";
  chatMessages.appendChild(createWelcomeScreen());

  topicInput.value = "";
  topicInput.focus();
}

function createWelcomeScreen() {
  const div = document.createElement("div");
  div.className = "welcome-screen";
  div.id = "welcomeScreen";
  div.innerHTML = `
        <div class="welcome-glow"></div>
        <div class="welcome-eyebrow">Multi-Agent AI System</div>
        <h1 class="welcome-title">Logic<span class="accent">Mind</span></h1>
        <p class="welcome-sub">
            Four specialized AI agents collaborate — searching, scraping, writing,
            and critiquing — to deliver a polished research report on any topic.
        </p>
        <div class="agent-cards">
            <div class="agent-card">
                <div class="agent-icon">🔍</div>
                <div class="agent-name">Search Agent</div>
                <div class="agent-desc">Finds reliable sources across the web</div>
            </div>
            <div class="agent-card">
                <div class="agent-icon">📄</div>
                <div class="agent-name">Reader Agent</div>
                <div class="agent-desc">Scrapes and extracts key content</div>
            </div>
            <div class="agent-card">
                <div class="agent-icon">✍️</div>
                <div class="agent-name">Writer Agent</div>
                <div class="agent-desc">Drafts a structured research report</div>
            </div>
            <div class="agent-card">
                <div class="agent-icon">🧐</div>
                <div class="agent-name">Critic Agent</div>
                <div class="agent-desc">Reviews, scores and gives feedback</div>
            </div>
        </div>
    `;
  return div;
}

// ══════════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

function setRunning(running) {
  isRunning = running;
  sendBtn.style.display = running ? "none" : "flex";
  stopBtn.style.display = running ? "flex" : "none";
  sendBtn.disabled = running;
  topicInput.disabled = running;

  if (!running) {
    topicInput.focus();
  }
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function truncate(text, maxLen) {
  if (!text) return "";
  return text.length > maxLen ? text.substring(0, maxLen) + "…" : text;
}

function setupInputAutoResize() {
  topicInput.addEventListener("input", autoResizeTextarea);
}

function autoResizeTextarea() {
  topicInput.style.height = "auto";
  topicInput.style.height = Math.min(topicInput.scrollHeight, 150) + "px";
}

// Global function for collapsible toggles
window.toggleRaw = function (id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("open");
  btn.classList.toggle("open");
};
