// Pixie Control Room — vanilla ES module app. No framework, no build step.
// Loaded as type="module" from index.html, served by Bun.serve.

/* ----------------------------------------------------------- api -- */

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    if (res.status === 401) { window.location.href = "/login"; return; }
    if (res.status === 403) { console.warn("admin only:", path); return { error: "admin only" }; }
  }
  return res.json();
}

/* --------------------------------------------------------- socket -- */

let pulseTimer = null;

function connectSSE() {
  const es = new EventSource("/api/stream");
  const dot = document.getElementById("socket-dot");

  es.addEventListener("connected", () => {
    dot?.classList.remove("disconnected");
  });

  es.addEventListener("pulse", (e) => {
    try { updateHud(JSON.parse(e.data)); } catch (_) {}
  });

  es.addEventListener("log", (e) => {
    try { appendFeed(JSON.parse(e.data)); } catch (_) {}
  });

  es.addEventListener("metric", () => {
    // heartbeat — can trigger refresh if needed
  });

  es.onerror = () => {
    dot?.classList.add("disconnected");
  };

  // Fallback polling for pulse if SSE dies.
  clearInterval(pulseTimer);
  pulseTimer = setInterval(async () => {
    try {
      const pulse = await api("/api/pulse");
      if (pulse && !pulse.error) updateHud(pulse);
    } catch (_) {}
  }, 30000);
}

/* ----------------------------------------------------------- hud -- */

function updateHud(pulse) {
  setEl("hud-coverage", `${pulse.coverage}%`);
  setEl("hud-answered", pulse.answered);
  setEl("hud-silent", pulse.silent);
  setEl("hud-cold", pulse.knownCold);
  setEl("hud-instant", pulse.instantPercent > 0 ? `(${pulse.instantPercent}% instant)` : "");
  setEl("hud-corpus", pulse.corpusRefreshedRelative);

  const q = document.getElementById("hud-queue");
  if (q) {
    q.textContent = pulse.queue;
    q.classList.toggle("glow", pulse.queue > 0);
  }

  const delta = document.getElementById("hud-coverage-delta");
  if (delta && pulse.coverageDelta !== undefined) {
    const d = pulse.coverageDelta;
    if (d > 0) { delta.textContent = `+${d}`; delta.className = "hud-delta up"; }
    else if (d < 0) { delta.textContent = `${d}`; delta.className = "hud-delta down"; }
    else { delta.textContent = ""; delta.className = "hud-delta"; }
  }
}

/* ----------------------------------------------------------- feed -- */

const MAX_FEED = 100;

function appendFeed(e) {
  if (e.kind === "debug") return;
  const list = document.getElementById("feed-list");
  if (!list) return;

  const row = document.createElement("div");
  row.className = "feed-row";
  row.innerHTML = `<span class="feed-scope">[${e.kind}/${e.scope}]</span> <span class="feed-msg">${esc(e.message || "")}</span>`;
  list.prepend(row);

  while (list.children.length > MAX_FEED) list.lastChild.remove();
}

/* --------------------------------------------------------- ask -- */

const askInput = document.getElementById("ask-input");
const askBtn = document.getElementById("ask-btn");
const askResult = document.getElementById("ask-result");
const askTrace = document.getElementById("ask-trace");

let asking = false;

askBtn?.addEventListener("click", doAsk);
askInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !asking) doAsk();
});

async function doAsk() {
  const q = askInput?.value.trim();
  if (!q || asking) return;
  asking = true;
  askBtn.disabled = true;
  askResult.innerHTML = '<div class="ask-placeholder">thinking...</div>';
  askTrace.innerHTML = "";

  try {
    const data = await api("/api/ask", {
      method: "POST",
      body: JSON.stringify({ question: q }),
    });

    if (data.error) {
      askResult.innerHTML = `<div class="ask-placeholder">Error: ${esc(data.error)}</div>`;
    } else {
      renderAskResult(data);
    }
  } catch (e) {
    askResult.innerHTML = `<div class="ask-placeholder">Request failed: ${esc(e.message)}</div>`;
  }

  asking = false;
  askBtn.disabled = false;
  askInput?.focus();
}

function renderAskResult(data) {
  const answer = data.answer || "(no answer)";
  const source = data.source || "(conversational — not in docs)";
  const latency = data.latencyMs ? `${(data.latencyMs / 1000).toFixed(1)}s` : "?";
  const ttft = data.firstTokenMs ? `${(data.firstTokenMs / 1000).toFixed(1)}s` : "n/a";

  askResult.innerHTML = `<div>${esc(answer)}</div>`;

  let trace = "";

  // Meta.
  trace += `<div class="trace-section"><h4>Meta</h4>`;
  trace += `<div class="trace-meta">`;
  trace += `<span>Source: <b>${esc(source)}</b></span>`;
  trace += `<span>Latency: <b>${latency}</b></span>`;
  trace += `<span>TTFT: <b>${ttft}</b></span>`;
  trace += `<span>Corpus: <b>${data.corpusSize}</b> chars / <b>${data.chunkCount}</b> chunks</span>`;
  if (data.citationOk === true) trace += `<span class="meta-ok">Citation OK</span>`;
  else if (data.citationOk === false) trace += `<span class="meta-warn">Citation MISMATCH — cited "${esc(source)}" not in retrieved chunks</span>`;
  trace += `</div></div>`;

  // Cache.
  trace += `<div class="trace-section"><h4>Cache</h4>`;
  trace += `<div class="trace-meta">`;
  trace += `<span>Would hit: <b>${data.cacheWouldHit ? "yes" : "no"}</b></span>`;
  if (data.cacheKey) trace += `<span>Key: <code>${esc(data.cacheKey.slice(0, 12))}...</code></span>`;
  if (data.cacheEntry) {
    trace += `<span>Stored answer: "${esc(data.cacheEntry.answer.slice(0, 60))}..."</span>`;
    trace += `<span>Asked ${data.cacheEntry.askCount}x (${data.cacheEntry.ageMs ? `${Math.round(data.cacheEntry.ageMs / 3600000)}h old` : ""})</span>`;
  }
  trace += `</div></div>`;

  // Intent gate.
  if (data.gateVerdict) {
    trace += `<div class="trace-section"><h4>Intent Gate</h4>`;
    trace += `<div class="trace-meta"><span>Verdict: <b>${esc(data.gateVerdict)}</b></span></div>`;
    trace += `</div>`;
  }

  // Query terms.
  if (data.queryTerms?.length) {
    trace += `<div class="trace-section"><h4>Query Terms</h4>`;
    trace += `<div class="trace-meta"><span>${data.queryTerms.map(esc).join(", ")}</span></div></div>`;
  }

  // Retrieved chunks.
  if (data.retrievalTrace?.length) {
    trace += `<div class="trace-section"><h4>Retrieved Chunks (${data.retrievalTrace.length})</h4>`;
    for (const c of data.retrievalTrace) {
      trace += `<div class="trace-chunk">`;
      trace += `<div class="chunk-source">${esc(c.source)}</div>`;
      if (c.heading) trace += `<div class="chunk-heading">${esc(c.heading)}</div>`;
      trace += `<div>${esc(c.snippet)}...</div>`;
      trace += `</div>`;
    }
    trace += `</div>`;
  }

  // Wrong button.
  trace += `<div class="trace-section">`;
  trace += `<button class="btn btn-ghost btn-small" onclick="document.getElementById('ask-input').value='${escJs(data.question)}';document.getElementById('ask-input').focus()">Ask again</button>`;
  trace += `</div>`;

  askTrace.innerHTML = trace;
}

/* -------------------------------------------------------- queue -- */

let queueIndex = 0;
let queueData = [];
let queueUndo = null;

async function loadQueue() {
  const data = await api("/api/queue");
  if (!data || data.error) return;
  queueData = data;
  queueIndex = Math.min(queueIndex, queueData.length - 1);
  if (queueIndex < 0) queueIndex = 0;
  renderQueue();
}

function renderQueue() {
  const list = document.getElementById("queue-list");
  const countEl = document.getElementById("queue-count");
  if (!list) return;

  if (countEl) countEl.textContent = queueData.length > 0 ? `(${queueData.length})` : "";

  if (queueData.length === 0) {
    list.innerHTML = '<div style="color:rgba(244,241,232,0.3);font-style:italic">nothing queued :yay:</div>';
    return;
  }

  let html = "";
  for (let i = 0; i < Math.min(queueData.length, 20); i++) {
    const row = queueData[i];
    const cls = i === queueIndex ? "queue-row focused" : "queue-row";
    html += `<div class="${cls}" data-idx="${i}">`;
    html += `<div class="q-question">${esc(row.question)}</div>`;
    html += `<div class="q-answer">${esc(row.answer.slice(0, 200))}${row.answer.length > 200 ? "..." : ""}</div>`;
    html += `<div class="q-meta">by ${row.authorId || "?"} · ${row.createdRelative || ""}</div>`;
    html += `</div>`;
  }

  if (queueData.length > 20) {
    html += `<div style="color:rgba(244,241,232,0.3);font-style:italic;padding:8px">+${queueData.length - 20} more</div>`;
  }

  list.innerHTML = html;
}

async function queueAction(action, id) {
  if (action === "approve") await api(`/api/queue/${id}/approve`, { method: "POST" });
  else if (action === "drop") await api(`/api/queue/${id}/drop`, { method: "POST" });
  await loadQueue();
}

function handleQueueKey(e) {
  if (queueData.length === 0) return;

  if (e.key === "j" || e.key === "ArrowDown") {
    e.preventDefault();
    queueIndex = Math.min(queueIndex + 1, queueData.length - 1);
    renderQueue();
  } else if (e.key === "k" || e.key === "ArrowUp") {
    e.preventDefault();
    queueIndex = Math.max(queueIndex - 1, 0);
    renderQueue();
  } else if (e.key === "a") {
    e.preventDefault();
    const row = queueData[queueIndex];
    if (row) {
      queueUndo = row;
      queueAction("approve", row.id);
    }
  } else if (e.key === "d") {
    e.preventDefault();
    const row = queueData[queueIndex];
    if (row) {
      queueUndo = row;
      queueAction("drop", row.id);
    }
  } else if (e.key === "e") {
    e.preventDefault();
    const row = queueData[queueIndex];
    if (row) openEditModal(row);
  } else if (e.key === "u") {
    e.preventDefault();
    if (queueUndo) {
      api("/api/teach", {
        method: "POST",
        body: JSON.stringify({ question: queueUndo.question, answer: queueUndo.answer }),
      }).then(() => loadQueue());
      queueUndo = null;
    }
  }
}

/* ---------------------------------------------------- edit modal -- */

function openEditModal(row) {
  const modal = document.getElementById("edit-modal");
  const qInput = document.getElementById("edit-question");
  const aInput = document.getElementById("edit-answer");
  if (!modal || !qInput || !aInput) return;

  qInput.value = row.question;
  aInput.value = row.answer;
  modal.classList.add("open");
  modal.dataset.id = row.id;
}

document.getElementById("edit-cancel")?.addEventListener("click", () => {
  document.getElementById("edit-modal")?.classList.remove("open");
});

document.getElementById("edit-save")?.addEventListener("click", async () => {
  const modal = document.getElementById("edit-modal");
  const q = document.getElementById("edit-question")?.value.trim();
  const a = document.getElementById("edit-answer")?.value.trim();
  const id = modal?.dataset.id;
  if (!q || !a || !id) return;

  await api(`/api/queue/${id}/drop`, { method: "POST" });
  await api("/api/teach", { method: "POST", body: JSON.stringify({ question: q, answer: a }) });
  modal?.classList.remove("open");
  await loadQueue();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.getElementById("edit-modal")?.classList.remove("open");
  }
});

/* -------------------------------------------------------- gaps -- */

let gapsTab = "docs";
let gapsData = null;

async function loadGaps() {
  gapsData = await api("/api/gaps");
  if (!gapsData || gapsData.error) return;
  renderGaps();
}

function renderGaps() {
  const content = document.getElementById("gaps-content");
  if (!content || !gapsData) return;

  const rows = gapsData.columns[gapsTab] || [];

  if (rows.length === 0) {
    content.innerHTML = '<div style="color:rgba(244,241,232,0.3);font-style:italic">nothing here</div>';
    return;
  }

  let html = "";

  if (gapsTab === "unjudged") {
    for (const row of rows) {
      html += `<div class="gap-unjudged-row">`;
      html += `<div>${esc(row.question)}</div>`;
      html += `<button class="gap-rejudge" data-id="${row.id}">re-judge</button>`;
      html += `</div>`;
    }
  } else {
    for (const row of rows) {
      html += `<div class="gap-row">`;
      html += `<span class="gap-question">${esc(row.question)}</span>`;
      html += `<span class="gap-count">${row.count}x</span>`;
      html += `<span class="gap-actions">`;
      if (gapsTab !== "docs") html += `<button class="gap-move-btn" data-id="${row.question}" data-kind="docs">→docs</button>`;
      if (gapsTab !== "transient") html += `<button class="gap-move-btn" data-id="${row.question}" data-kind="transient">→transient</button>`;
      if (gapsTab !== "noise") html += `<button class="gap-move-btn" data-id="${row.question}" data-kind="noise">→noise</button>`;
      html += `</span></div>`;
    }
  }

  content.innerHTML = html;

  // Event delegation for gap actions.
  content.querySelectorAll(".gap-move-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const question = btn.dataset.id;
      const kind = btn.dataset.kind;
      // Find the gap row(s) with this question and move each.
      // For grouped gaps, we need to move all matching rows.
      // The API uses individual gap IDs, but grouped gaps are by question text.
      // Reload unjudged separately, grouped by setGapKind on individual rows.
      await api(`/api/gaps`, { method: "PATCH", body: JSON.stringify({ id: question, kind }) });
      loadGaps();
    });
  });

  content.querySelectorAll(".gap-rejudge").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      await api(`/api/gaps/${id}/rejudge`, { method: "POST" });
      loadGaps();
    });
  });
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    gapsTab = tab.dataset.tab;
    renderGaps();
  });
});

/* ----------------------------------------------------- silence -- */

async function loadSilence() {
  const data = await api("/api/silence");
  if (!data || data.error) return;
  const el = document.getElementById("silence-breakdown");
  if (!el) return;

  if (!data.breakdown?.length) {
    el.innerHTML = '<div style="color:rgba(244,241,232,0.3);font-style:italic">no silence data yet</div>';
    return;
  }

  let html = "";
  for (const d of data.breakdown) {
    html += `<div class="silence-reason">`;
    html += `<div class="reason-label">${esc(d.reason)}</div>`;
    html += `<div class="reason-count">${d.count}</div>`;
    html += `</div>`;
  }
  el.innerHTML = html;
}

/* -------------------------------------------------- knowledge -- */

async function loadKnowledge() {
  const data = await api("/api/knowledge");
  if (!data || data.error) return;
  const el = document.getElementById("knowledge-info");
  if (!el) return;

  let html = "";
  html += `<div class="k-row"><span class="k-label">Corpus</span><span>${data.corpusLength} chars</span></div>`;
  html += `<div class="k-row"><span class="k-label">Chunks</span><span>${data.chunkCount}</span></div>`;
  html += `<div class="k-row"><span class="k-label">Last built</span><span>${data.lastBuiltRelative}</span></div>`;
  html += `<div class="k-row"><span class="k-label">Sources</span><span>${data.sources.length}</span></div>`;

  for (const s of data.sources) {
    html += `<div class="k-row"><span class="k-label">${esc(s.name)}</span><span>${esc(s.type)}</span></div>`;
  }

  el.innerHTML = html;
}

document.getElementById("refresh-corpus")?.addEventListener("click", async () => {
  await api("/api/knowledge/refresh", { method: "POST" });
  loadKnowledge();
});

/* ----------------------------------------------------- cache -- */

async function loadCache() {
  const data = await api("/api/cache");
  if (!data || data.error) return;
  const el = document.getElementById("cache-list");
  if (!el) return;

  let html = `<div style="margin-bottom:8px;color:rgba(244,241,232,0.5);font-size:0.7rem">${data.known} known answers</div>`;

  for (const row of (data.top || []).slice(0, 10)) {
    html += `<div class="cache-row">`;
    html += `<span class="cache-q" title="${esc(row.question)}">${esc(row.question)}</span>`;
    html += `<span class="cache-count">${row.askCount}x</span>`;
    html += `</div>`;
  }

  el.innerHTML = html;
}

/* --------------------------------------------------- report -- */

async function loadReport() {
  const data = await api("/api/report?week=0");
  if (!data || data.error) return;
  const el = document.getElementById("report-content");
  if (!el) return;
  el.textContent = data.text || "no report data";
}

document.getElementById("post-report")?.addEventListener("click", async () => {
  const data = await api("/api/report/post", { method: "POST" });
  if (data?.ok) {
    document.getElementById("post-report").textContent = "Posted!";
    setTimeout(() => {
      const btn = document.getElementById("post-report");
      if (btn) btn.textContent = "Post now";
    }, 3000);
  }
});

/* ----------------------------------------------------- programs -- */

async function loadPrograms() {
  const data = await api("/api/programs");
  if (!data || data.error) return;
  const grid = document.getElementById("programs-grid");
  if (!grid) return;

  if (data.length === 0) {
    grid.innerHTML = `<div style="color:rgba(244,241,232,0.5);font-size:0.85rem">No programs registered. Click "+ Add Program" to register one.</div>`;
    return;
  }

  let html = "";
  for (const prog of data) {
    const postureClass = prog.posture === "active" ? "active" : "passive";
    const helpChan = prog.helpChannel || "none";
    const chans = (prog.channels || []).join(", ") || "none";
    const helperGrp = prog.helperGroup || "none";

    html += `
      <div class="program-card">
        <div class="program-card-header">
          <span class="program-name">${esc(prog.name)}</span>
          <span class="posture-badge ${postureClass}">${esc(prog.posture || "active")}</span>
        </div>
        <div class="program-details">
          <div><strong>ID:</strong> <code>${esc(prog.id)}</code></div>
          <div><strong>Help Channel:</strong> <code>${esc(helpChan)}</code></div>
          <div><strong>Channels:</strong> <code>${esc(chans)}</code></div>
          <div><strong>Helper Group:</strong> <code>${esc(helperGrp)}</code></div>
        </div>
        <div class="program-card-actions">
          <button class="btn btn-small" onclick="window.togglePosture('${escJs(prog.id)}', '${escJs(prog.posture)}')">
            Set ${prog.posture === "active" ? "Passive" : "Active"}
          </button>
          <button class="btn btn-small btn-ghost" onclick="window.deleteProgram('${escJs(prog.id)}')">Delete</button>
        </div>
      </div>
    `;
  }

  grid.innerHTML = html;
}

window.togglePosture = async (id, currentPosture) => {
  const newPosture = currentPosture === "active" ? "passive" : "active";
  await api(`/api/programs/${id}/posture`, {
    method: "PATCH",
    body: JSON.stringify({ posture: newPosture }),
  });
  loadPrograms();
};

window.deleteProgram = async (id) => {
  if (!confirm(`Delete program '${id}'?`)) return;
  await api(`/api/programs/${id}`, { method: "DELETE" });
  loadPrograms();
};

document.getElementById("btn-add-program")?.addEventListener("click", () => {
  document.getElementById("program-modal").classList.add("open");
});

document.getElementById("prog-cancel")?.addEventListener("click", () => {
  document.getElementById("program-modal").classList.remove("open");
});

document.getElementById("prog-save")?.addEventListener("click", async () => {
  const id = document.getElementById("prog-id").value.trim();
  const name = document.getElementById("prog-name").value.trim();
  const posture = document.getElementById("prog-posture").value;
  const helpChannel = resolveChannelId(document.getElementById("prog-help-channel").value);
  const channelsRaw = document.getElementById("prog-channels").value.trim();
  const helperGroup = document.getElementById("prog-helper-group").value.trim();

  if (!id || !name) {
    alert("Program ID and Name are required!");
    return;
  }

  const channels = channelsRaw ? channelsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

  await api("/api/programs", {
    method: "POST",
    body: JSON.stringify({ id, name, posture, helpChannel, channels, helperGroup }),
  });

  document.getElementById("program-modal").classList.remove("open");
  loadPrograms();
  loadChannels();
});

/* ----------------------------------------------------- channels matrix -- */

let allChannelsData = [];
let channelSearchQuery = "";

async function loadChannels() {
  const data = await api("/api/channels");
  if (!data || data.error) return;
  allChannelsData = data;
  renderChannels();
  populateProgramSelect();
}

function populateProgramSelect() {
  const sel = document.getElementById("chan-prog-select");
  if (!sel) return;
  const progs = Array.from(new Set(allChannelsData.map((c) => c.programId || "pixl")));
  if (!progs.includes("pixl")) progs.unshift("pixl");
  sel.innerHTML = progs
    .map((p) => `<option value="${esc(p)}">${esc(p)}</option>`)
    .join("");
}

function renderChannels() {
  const grid = document.getElementById("channels-grid");
  const countEl = document.getElementById("channels-count");
  if (!grid) return;

  const filtered = allChannelsData.filter((ch) => {
    if (!channelSearchQuery) return true;
    const q = channelSearchQuery.toLowerCase();
    return (
      (ch.channelId || "").toLowerCase().includes(q) ||
      (ch.programName || "").toLowerCase().includes(q) ||
      (ch.programId || "").toLowerCase().includes(q) ||
      (ch.posture || "").toLowerCase().includes(q) ||
      (ch.type || "").toLowerCase().includes(q)
    );
  });

  if (countEl) countEl.textContent = `(${filtered.length})`;

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="color:rgba(244,241,232,0.5);font-size:0.85rem">No channels matching "${esc(channelSearchQuery)}". Click "+ Add Channel" to configure one.</div>`;
    return;
  }

  let html = "";
  for (const ch of filtered) {
    const isTicketDest = ch.isTicketDestination || ch.isHelpChannel;
    const posture = ch.posture || "active";

    html += `
      <div class="channel-card">
        <div class="channel-card-top">
          <span class="channel-tag">#<code>${esc(ch.channelId)}</code></span>
          <span class="channel-prog-badge">[${esc(ch.programName || ch.programId)}]</span>
        </div>

        <div class="channel-badges-row">
          ${isTicketDest ? `<span class="badge-ticket-dest">🎫 Ticket Cards Destination</span>` : ""}
          ${ch.isHelpChannel ? `<span class="badge-help-room">🆘 Primary Help Channel</span>` : ""}
        </div>

        <div class="channel-control-section">
          <div class="control-label">💬 Reply in this channel:</div>
          <div class="toggle-button-group">
            <button class="toggle-option-btn ${posture === 'active' ? 'active-active' : ''}" 
                    title="Pixie answers relevant questions automatically"
                    onclick="window.setChannelPosture('${escJs(ch.channelId)}', '${escJs(ch.programId)}', 'active')">
              🟢 Active
            </button>
            <button class="toggle-option-btn ${posture === 'passive' ? 'active-passive' : ''}" 
                    title="Pixie only answers when @mentioned or pinged"
                    onclick="window.setChannelPosture('${escJs(ch.channelId)}', '${escJs(ch.programId)}', 'passive')">
              🟡 Mention Only
            </button>
            <button class="toggle-option-btn ${posture === 'muted' ? 'active-muted' : ''}" 
                    title="Pixie stays completely silent in this channel"
                    onclick="window.setChannelPosture('${escJs(ch.channelId)}', '${escJs(ch.programId)}', 'muted')">
              🔴 Muted
            </button>
          </div>
        </div>

        <div class="channel-card-footer">
          <div>
            <span><b>${ch.msgCount || 0}</b> msgs</span> · 
            <span><b>${ch.ticketCount || 0}</b> tickets</span>
          </div>
          <div class="channel-footer-actions">
            ${!isTicketDest ? `<button class="btn btn-small" title="Make this channel the escalation card target" onclick="window.setTicketDest('${escJs(ch.channelId)}', '${escJs(ch.programId)}')">Set Ticket Target</button>` : ''}
            <button class="btn btn-small btn-ghost" onclick="window.removeChannel('${escJs(ch.channelId)}', '${escJs(ch.programId)}')">Remove</button>
          </div>
        </div>
      </div>
    `;
  }

  grid.innerHTML = html;
}

window.setChannelPosture = async (channelId, programId, posture) => {
  await api("/api/channels/toggle", {
    method: "POST",
    body: JSON.stringify({ channelId, programId, field: "posture", value: posture }),
  });
  loadChannels();
  loadPrograms();
};

window.setTicketDest = async (channelId, programId) => {
  await api("/api/channels/toggle", {
    method: "POST",
    body: JSON.stringify({ channelId, programId, field: "ticketDestination", value: true }),
  });
  loadChannels();
  loadPrograms();
};

window.removeChannel = async (channelId, programId) => {
  if (!confirm(`Remove channel #${channelId} from ${programId}?`)) return;
  await api(`/api/channels/${programId}/${channelId}`, { method: "DELETE" });
  loadChannels();
  loadPrograms();
};

document.getElementById("channel-search-input")?.addEventListener("input", (e) => {
  channelSearchQuery = (e.target.value || "").trim();
  renderChannels();
});

document.getElementById("btn-add-channel")?.addEventListener("click", () => {
  populateProgramSelect();
  document.getElementById("channel-modal").classList.add("open");
});

document.getElementById("chan-cancel")?.addEventListener("click", () => {
  document.getElementById("channel-modal").classList.remove("open");
});

document.getElementById("chan-save")?.addEventListener("click", async () => {
  const channelId = resolveChannelId(document.getElementById("chan-id").value);
  const programId = document.getElementById("chan-prog-select").value;
  const posture = document.getElementById("chan-posture").value;
  const isTicketDest = document.getElementById("chan-is-ticket-dest").checked;
  const isHelp = document.getElementById("chan-is-help").checked;

  if (!channelId) {
    alert("Channel ID is required!");
    return;
  }

  await api("/api/channels", {
    method: "POST",
    body: JSON.stringify({ channelId, programId, isHelp: isHelp || isTicketDest }),
  });

  if (posture !== "active") {
    await api("/api/channels/toggle", {
      method: "POST",
      body: JSON.stringify({ channelId, programId, field: "posture", value: posture }),
    });
  }

  document.getElementById("channel-modal").classList.remove("open");
  document.getElementById("chan-id").value = "";
  loadChannels();
  loadPrograms();
});

/* ------------------------------------------------------ tickets -- */

let activeTicketTab = "all";

/* ------------------------------------------------ slack channel picker -- */

let slackChannelOptions = [];

async function loadSlackChannels() {
  try {
    const data = await api("/api/slack/channels");
    if (!data || !data.ok) return;
    slackChannelOptions = data.channels;
    const datalist = document.getElementById("slack-channel-list");
    if (datalist) {
      datalist.innerHTML = data.channels
        .map((c) => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`)
        .join("");
    }
  } catch (_) {}
}

// Accept "#name", "name", or a raw C-id; return the canonical channel ID.
function resolveChannelId(raw) {
  const v = (raw || "").trim();
  if (/^C[0-9A-Z]+$/i.test(v)) return v.toUpperCase();
  const name = v.startsWith("#") ? v.slice(1).toLowerCase() : v.toLowerCase();
  const hit = slackChannelOptions.find((c) => c.name.toLowerCase() === name);
  return hit ? hit.id : v;
}

async function loadTickets() {
  const url = activeTicketTab === "all" ? "/api/tickets" : `/api/tickets?status=${activeTicketTab}`;
  const data = await api(url);
  if (!data || data.error) return;

  const countEl = document.getElementById("tickets-count");
  if (countEl) countEl.textContent = `(${data.length})`;

  const list = document.getElementById("tickets-list");
  if (!list) return;

  if (data.length === 0) {
    list.innerHTML = `<div style="color:rgba(244,241,232,0.5);font-size:0.85rem">No tickets in this status.</div>`;
    return;
  }

  let html = "";
  for (const t of data) {
    const statusClass = t.status || "open";
    const assigneeStr = t.assignee_id ? ` • Claimed by ${t.assignee_id}` : "";
    const createdStr = new Date(t.created_at).toLocaleString();

    let actionBtns = "";
    if (t.status === "open") {
      actionBtns = `
        <button class="btn btn-small" onclick="window.updateTicket(${t.id}, 'claimed')">Claim</button>
        <button class="btn btn-small" onclick="window.updateTicket(${t.id}, 'resolved')">Resolve</button>
        <button class="btn btn-small btn-ghost" onclick="window.updateTicket(${t.id}, 'closed')">Close</button>
      `;
    } else if (t.status === "claimed") {
      actionBtns = `
        <button class="btn btn-small btn-ghost" onclick="window.updateTicket(${t.id}, 'unclaim')">Unclaim</button>
        <button class="btn btn-small" onclick="window.updateTicket(${t.id}, 'resolved')">Resolve</button>
        <button class="btn btn-small btn-ghost" onclick="window.updateTicket(${t.id}, 'closed')">Close</button>
      `;
    } else {
      actionBtns = `
        <button class="btn btn-small" onclick="window.updateTicket(${t.id}, 'reopen')">Reopen</button>
      `;
    }

    html += `
      <div class="ticket-card">
        <div class="ticket-header">
          <span class="ticket-title">[${esc(t.program_id)}] Ticket #${t.id}</span>
          <span class="ticket-badge ${statusClass}">${esc(t.status)}</span>
        </div>
        <div class="ticket-question">${esc(t.question)}</div>
        <div class="ticket-meta">Requested by ${esc(t.requester_id)} in channel ${esc(t.channel)} • ${createdStr}${assigneeStr}</div>
        <div class="ticket-actions">${actionBtns}</div>
      </div>
    `;
  }

  list.innerHTML = html;
}

window.updateTicket = async (id, status) => {
  await api(`/api/tickets/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  loadTickets();
};

document.querySelectorAll("[data-ttab]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    document.querySelectorAll("[data-ttab]").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    activeTicketTab = e.target.dataset.ttab;
    loadTickets();
  });
});

/* ------------------------------------------------------- init -- */

function esc(s) {
  const div = document.createElement("div");
  div.textContent = s || "";
  return div.innerHTML;
}

function escJs(s) {
  return (s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

document.addEventListener("keydown", handleQueueKey);

document.addEventListener("click", (e) => {
  const row = e.target.closest(".queue-row");
  if (row) {
    queueIndex = Number(row.dataset.idx);
    renderQueue();
  }
});

function init() {
  connectSSE();
  loadChannels();
  loadPrograms();
  loadTickets();
  loadQueue();
  loadGaps();
  loadSilence();
  loadKnowledge();
  loadCache();
  loadReport();
  loadSlackChannels();
}

init();
