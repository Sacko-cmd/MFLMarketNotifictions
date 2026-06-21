/**
 * popup.js
 * Server URL is baked in — no setup screen needed.
 */

// ─── SERVER URL ──────────────────────────────────────────────────────────────

const SERVER_URL = "https://mflmarketnotifictions.onrender.com";

// ─── INSTALL ID ──────────────────────────────────────────────────────────────
// Generated once on first run, stored locally forever.
// Passed with every API call so monitors are private to this installation.

let INSTALL_ID = "";

function getOrCreateInstallId() {
  return new Promise(resolve => {
    chrome.storage.local.get(["installId"], data => {
      if (data.installId) {
        INSTALL_ID = data.installId;
        resolve(data.installId);
      } else {
        const newId = "mfl_" + crypto.randomUUID().replace(/-/g, "");
        chrome.storage.local.set({ installId: newId });
        INSTALL_ID = newId;
        resolve(newId);
      }
    });
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
// Every request sends X-Install-ID so the server returns only that user's monitors.

async function apiGet(path) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    headers: { "X-Install-ID": INSTALL_ID },
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Install-ID": INSTALL_ID },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

async function apiPatch(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Install-ID": INSTALL_ID },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "DELETE",
    headers: { "X-Install-ID": INSTALL_ID },
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
}

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
          <span class="badge badge-discord">discord</span>
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
    chrome.storage.local.get(["lastDiscordWebhook"], data => {
      if (data.lastDiscordWebhook) {
        document.getElementById("input-webhook").value = data.lastDiscordWebhook;
      }
    });
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
        toast("navigate to mfl marketplace (players, clubs, or packs) first", true);
      }
    });
  }
});

document.getElementById("input-url").addEventListener("input", e => {
  const val = e.target.value.trim();
  if (val.startsWith("https://app.playmfl.com/marketplace")) doTranslate(val);
});

document.getElementById("btn-save-monitor").addEventListener("click", async () => {
  const pageUrl         = document.getElementById("input-url").value.trim();
  const label           = document.getElementById("input-label").value.trim() || "monitor";
  const intervalMinutes = parseInt(document.getElementById("input-interval").value);
  const discordWebhook  = document.getElementById("input-webhook").value.trim();

  if (!pendingApiUrl) { toast("click detect first", true); return; }
  if (!discordWebhook) {
    toast("enter a discord webhook url", true); return;
  }
  if (!discordWebhook.startsWith("https://discord.com/api/webhooks/")) {
    toast("invalid discord webhook url", true); return;
  }

  const monitor = {
    id: uid(), label, pageUrl, apiUrl: pendingApiUrl,
    notifMode: "discord", intervalMinutes, discordWebhook,
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

getOrCreateInstallId().then(() => {
  loadMonitors();
  setInterval(loadMonitors, 30000);
});
