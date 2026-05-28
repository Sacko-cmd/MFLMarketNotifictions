/**
 * popup.js
 * All monitor data lives on the cloud server.
 * The extension reads from and writes to the server via fetch().
 * chrome.storage is only used to remember the server URL and last webhook.
 */

// ─── SERVER URL ──────────────────────────────────────────────────────────────
// Set once from storage; the user configures this on first open.

let SERVER_URL = "";

function getServerUrl() {
  return new Promise(resolve => {
    chrome.storage.local.get(["serverUrl"], data => resolve(data.serverUrl || ""));
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10); }

function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.toggle("err", isError);
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function esc(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ─── SERVER API CALLS ────────────────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(`${SERVER_URL}${path}`);
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

async function apiPatch(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(`${SERVER_URL}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
}

// ─── SERVER URL SETUP SCREEN ─────────────────────────────────────────────────

function showSetupScreen() {
  const list = document.getElementById("monitor-list");
  list.innerHTML = `
    <div style="padding:14px 12px;">
      <div class="panel-title" style="margin-bottom:10px;">// server_setup.init</div>
      <div class="field">
        <label class="field-label">your render server url</label>
        <input type="text" id="setup-url" placeholder="https://your-app.onrender.com"
          style="width:100%;background:var(--black);border:1px solid var(--border2);color:var(--text1);
                 font-family:'Share Tech Mono',monospace;font-size:11px;border-radius:2px;padding:6px 8px;outline:none;">
        <div class="hint" style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text3);margin-top:5px;line-height:1.6;">
          // deploy the server folder to render.com<br>
          // paste your web service url here once<br>
          // see README for step-by-step guide
        </div>
      </div>
      <button id="setup-save" style="margin-top:10px;width:100%;font-family:'Share Tech Mono',monospace;font-size:10px;
        background:var(--yellow-bg);border:1px solid var(--yellow-dim);color:var(--knicks-orange);border-radius:2px;
        padding:7px;cursor:pointer;letter-spacing:0.1em;text-transform:uppercase;">
        save &amp; connect
      </button>
    </div>`;

  document.getElementById("setup-save").addEventListener("click", async () => {
    const val = document.getElementById("setup-url").value.trim().replace(/\/$/, "");
    if (!val.startsWith("https://")) { toast("enter a valid https:// url", true); return; }
    try {
      const res = await fetch(`${val}/`);
      if (!res.ok) throw new Error();
      chrome.storage.local.set({ serverUrl: val });
      SERVER_URL = val;
      toast("connected!");
      loadMonitors();
    } catch {
      toast("could not reach server — check url", true);
    }
  });
}

// ─── NOTIFICATION MODE ───────────────────────────────────────────────────────

document.querySelectorAll('input[name="notif-mode"]').forEach(radio => {
  radio.addEventListener("change", () => {
    const mode = document.querySelector('input[name="notif-mode"]:checked').value;
    document.getElementById("discord-section").classList.toggle("hidden", mode === "desktop");
    if (mode === "discord" || mode === "both") {
      const webhookInput = document.getElementById("input-webhook");
      if (!webhookInput.value) {
        chrome.storage.local.get(["lastDiscordWebhook"], data => {
          if (data.lastDiscordWebhook) webhookInput.value = data.lastDiscordWebhook;
        });
      }
    }
  });
});

// ─── RENDER ──────────────────────────────────────────────────────────────────

function renderMonitors(monitors) {
  const list  = document.getElementById("monitor-list");
  const empty = document.getElementById("empty-state");
  list.querySelectorAll(".monitor-card").forEach(c => c.remove());
  if (!monitors || monitors.length === 0) { empty.style.display = "block"; return; }
  empty.style.display = "none";
  monitors.forEach(m => list.appendChild(buildCard(m)));
}

function buildCard(m) {
  const card = document.createElement("div");
  card.className = `monitor-card ${m.enabled ? "active-card" : "paused-card"}`;
  card.dataset.id = m.id;

  const dotClass   = !m.enabled ? "off" : m.lastError ? "error" : "";
  const mode       = m.notifMode || "discord";
  const modeBadge  = { desktop:`<span class="badge badge-desktop">desktop</span>`, discord:`<span class="badge badge-discord">discord</span>`, both:`<span class="badge badge-both">both</span>` }[mode] || "";
  const errorBadge = m.lastError ? `<span class="badge badge-error" title="${esc(m.lastError)}">err</span>` : "";
  const pauseLabel = m.enabled ? "[ pause ]" : "[ resume ]";
  const pauseClass = m.enabled ? "btn-pause running" : "btn-pause paused";

  // Show cloud indicator instead of last-check time
  const statusText = `<span class="meta-text">☁ cloud active</span>`;

  card.innerHTML = `
    <div class="card-main">
      <div class="card-dot-wrap"><div class="card-dot ${dotClass}"></div></div>
      <div class="card-info">
        <div class="card-name" title="${esc(m.pageUrl || "")}">${esc(m.label)}</div>
        <div class="card-meta">
          ${statusText}
          ${errorBadge}
          ${modeBadge}
        </div>
      </div>
      <div class="card-actions">
        <button class="${pauseClass}">${pauseLabel}</button>
        <button class="btn-delete">[ x ]</button>
      </div>
    </div>
    <div class="card-footer">
      <span class="footer-label">interval</span>
      <select class="interval-select">
        ${[1,2,5,10,30].map(v =>
          `<option value="${v}"${v === m.intervalMinutes ? " selected" : ""}>${v}min</option>`
        ).join("")}
      </select>
    </div>`;

  // Pause / Resume
  card.querySelector(".btn-pause").addEventListener("click", async () => {
    try {
      await apiPatch(`/monitors/${m.id}`, { enabled: !m.enabled });
      toast(m.enabled ? "monitor paused" : "monitor resumed");
      loadMonitors();
    } catch { toast("server error", true); }
  });

  // Delete
  card.querySelector(".btn-delete").addEventListener("click", async () => {
    if (!confirm(`delete monitor "${m.label}"?`)) return;
    try {
      await apiDelete(`/monitors/${m.id}`);
      toast("monitor deleted");
      loadMonitors();
    } catch { toast("server error", true); }
  });

  // Interval change
  card.querySelector(".interval-select").addEventListener("change", async e => {
    try {
      await apiPatch(`/monitors/${m.id}`, { intervalMinutes: parseInt(e.target.value) });
      toast("interval updated");
    } catch { toast("server error", true); }
  });

  return card;
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

async function loadMonitors() {
  if (!SERVER_URL) { showSetupScreen(); return; }
  try {
    const monitors = await apiGet("/monitors");
    renderMonitors(monitors);
  } catch {
    toast("can't reach server", true);
    renderMonitors([]);
  }
}

// ─── ADD PANEL ───────────────────────────────────────────────────────────────

let pendingApiUrl = null;

document.getElementById("btn-add-open").addEventListener("click", () => {
  const panel     = document.getElementById("add-panel");
  const isOpening = !panel.classList.contains("open");
  panel.classList.toggle("open");
  if (isOpening) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      if (tab?.url?.includes("app.playmfl.com/marketplace")) {
        document.getElementById("input-url").value = tab.url;
        doTranslate(tab.url);
      } else {
        document.getElementById("input-url").focus();
      }
    });
  }
});

document.getElementById("btn-cancel").addEventListener("click", closeAddPanel);

function closeAddPanel() {
  document.getElementById("add-panel").classList.remove("open");
  document.getElementById("input-url").value     = "";
  document.getElementById("input-label").value   = "";
  document.getElementById("input-webhook").value = "";
  document.getElementById("api-preview").classList.remove("show");
  document.getElementById("btn-save-monitor").disabled = true;
  document.getElementById("mode-desktop").checked = true;
  document.getElementById("discord-section").classList.add("hidden");
  pendingApiUrl = null;
}

function doTranslate(url) {
  if (!url) return;
  chrome.runtime.sendMessage({ action: "translateUrl", pageUrl: url }, resp => {
    if (!resp?.apiUrl) return;
    pendingApiUrl = resp.apiUrl;
    const preview = document.getElementById("api-preview");
    preview.textContent = "→ " + resp.apiUrl;
    preview.classList.add("show");
    const labelInput = document.getElementById("input-label");
    if (!labelInput.value) labelInput.value = resp.label;
    document.getElementById("btn-save-monitor").disabled = false;
  });
}

document.getElementById("btn-translate").addEventListener("click", () => {
  const val = document.getElementById("input-url").value.trim();
  if (val) {
    doTranslate(val);
    toast("url detected");
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      if (tab?.url?.includes("app.playmfl.com/marketplace")) {
        document.getElementById("input-url").value = tab.url;
        doTranslate(tab.url);
        toast("grabbed from current tab");
      } else {
        toast("navigate to mfl marketplace first", true);
      }
    });
  }
});

document.getElementById("input-url").addEventListener("input", e => {
  const val = e.target.value.trim();
  if (val.startsWith("https://app.playmfl.com/marketplace")) doTranslate(val);
});

document.getElementById("btn-save-monitor").addEventListener("click", async () => {
  if (!SERVER_URL) { toast("configure server url first", true); return; }

  const pageUrl        = document.getElementById("input-url").value.trim();
  const label          = document.getElementById("input-label").value.trim() || "monitor";
  const intervalMinutes= parseInt(document.getElementById("input-interval").value);
  const notifMode      = document.querySelector('input[name="notif-mode"]:checked').value;
  const discordWebhook = document.getElementById("input-webhook").value.trim();

  if (!pendingApiUrl) { toast("click detect first", true); return; }
  if ((notifMode === "discord" || notifMode === "both") && !discordWebhook) {
    toast("enter a discord webhook url", true); return;
  }
  if (discordWebhook && !discordWebhook.startsWith("https://discord.com/api/webhooks/")) {
    toast("invalid discord webhook url", true); return;
  }

  const monitor = {
    id: uid(), label, pageUrl, apiUrl: pendingApiUrl,
    notifMode, intervalMinutes,
    discordWebhook: notifMode !== "desktop" ? discordWebhook : null,
  };

  try {
    await apiPost("/monitors", monitor);
    if (discordWebhook) chrome.storage.local.set({ lastDiscordWebhook: discordWebhook });
    toast("monitor saved — cloud is watching!");
    closeAddPanel();
    loadMonitors();
  } catch(e) {
    toast("failed to save: " + e.message, true);
  }
});

// ─── BOOT ────────────────────────────────────────────────────────────────────

getServerUrl().then(url => {
  SERVER_URL = url;
  loadMonitors();
});

// Refresh list every 30s while popup is open
setInterval(loadMonitors, 30000);
