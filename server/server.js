/**
 * MFL Monitor — Cloud Server
 * Exposes a REST API so the Chrome extension can manage monitors.
 * Handles all polling and Discord webhook notifications 24/7.
 *
 * Deploy as a Web Service on Render.com (free tier).
 */

const express  = require("express");
const fs       = require("fs");
const path     = require("path");
const fetch    = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app      = express();
const PORT     = process.env.PORT || 3000;
const DATA     = path.join(__dirname, "monitors.json");
const BASE_API = "https://z519wdyajg.execute-api.us-east-1.amazonaws.com/prod/listings";

app.use(express.json());

// Allow the Chrome extension to call this server
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Install-ID");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Extract install ID from every request — scopes all data to that installation
function getInstallId(req) {
  return (req.headers["x-install-id"] || "").trim();
}

// ─── PERSISTENCE ─────────────────────────────────────────────────────────────

function load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return []; }
}

function save(monitors) {
  fs.writeFileSync(DATA, JSON.stringify(monitors, null, 2));
}

if (!fs.existsSync(DATA)) save([]);

// ─── REST API ────────────────────────────────────────────────────────────────

// GET /monitors — list monitors for this installation only
app.get("/monitors", (req, res) => {
  const installId = getInstallId(req);
  if (!installId) return res.status(400).json({ error: "X-Install-ID header required" });
  res.json(load().filter(m => m.installId === installId));
});

// POST /monitors — add a monitor (called by extension on save)
app.post("/monitors", (req, res) => {
  const installId = getInstallId(req);
  if (!installId) return res.status(400).json({ error: "X-Install-ID header required" });

  const { id, label, pageUrl, apiUrl, discordWebhook, notifMode, intervalMinutes } = req.body;
  if (!id || !apiUrl) return res.status(400).json({ error: "id and apiUrl required" });

  const monitors = load();
  if (monitors.find(m => m.id === id)) return res.status(409).json({ error: "already exists" });

  const monitor = {
    id, installId, label, pageUrl, apiUrl,
    discordWebhook: discordWebhook || null,
    notifMode:      notifMode || "discord",
    intervalMinutes: intervalMinutes || 1,
    enabled:   true,
    seenIds:   [],
    lastCheck: null,
    lastError: null,
  };

  monitors.push(monitor);
  save(monitors);
  scheduleOne(monitor);
  console.log(`[API] Added monitor: "${label}" (install: ${installId.slice(0,12)}...)`);
  res.status(201).json(monitor);
});

// PATCH /monitors/:id — update (pause/resume/interval)
app.patch("/monitors/:id", (req, res) => {
  const installId = getInstallId(req);
  const monitors  = load();
  const idx = monitors.findIndex(m => m.id === req.params.id && m.installId === installId);
  if (idx === -1) return res.status(404).json({ error: "not found" });

  const allowed = ["enabled", "intervalMinutes", "label", "discordWebhook", "notifMode"];
  allowed.forEach(k => { if (req.body[k] !== undefined) monitors[idx][k] = req.body[k]; });
  if (req.body.enabled) monitors[idx].lastError = null;

  save(monitors);
  rescheduleOne(monitors[idx]);
  console.log(`[API] Updated monitor: "${monitors[idx].label}"`);
  res.json(monitors[idx]);
});

// DELETE /monitors/:id — remove a monitor
app.delete("/monitors/:id", (req, res) => {
  const installId = getInstallId(req);
  const monitors  = load();
  const monitor   = monitors.find(m => m.id === req.params.id && m.installId === installId);
  if (!monitor) return res.status(404).json({ error: "not found" });

  save(monitors.filter(m => m.id !== req.params.id));
  clearTimer(req.params.id);
  console.log(`[API] Deleted monitor: "${monitor.label}"`);
  res.sendStatus(204);
});

// POST /monitors/:id/poll — trigger immediate check
app.post("/monitors/:id/poll", (req, res) => {
  const installId = getInstallId(req);
  const monitor = load().find(m => m.id === req.params.id && m.installId === installId);
  if (!monitor) return res.status(404).json({ error: "not found" });
  pollMonitor(monitor);
  res.json({ ok: true });
});

// Health check — Render pings this to keep the service alive
app.get("/", (req, res) => res.json({ status: "ok", monitors: load().length }));

// ─── URL TRANSLATION (same logic as extension's background.js) ───────────────

function marketplaceTypeFromPath(pathname) {
  const p = (pathname || "").toLowerCase();
  if (p.includes("/packs")) return "PACK";
  if (p.includes("/clubs")) return "CLUB";
  return "PLAYER";
}

function pageUrlToApiUrl(pageUrl) {
  try {
    const url = new URL(pageUrl);
    const p   = url.pathname.toLowerCase();
    const apiParams = new URLSearchParams({
      limit: "25", type: marketplaceTypeFromPath(p),
      sorts: "listing.createdDateTime", sortsOrders: "DESC",
      status: "AVAILABLE", view: "full"
    });
    const rangeMap = {
      "metadata.age":       ["ageMin","ageMax"],
      "metadata.overall":   ["overallMin","overallMax"],
      "listing.price":      ["priceMin","priceMax"],
      "metadata.pace":      ["paceMin","paceMax"],
      "metadata.shooting":  ["shootingMin","shootingMax"],
      "metadata.passing":   ["passingMin","passingMax"],
      "metadata.dribbling": ["dribblingMin","dribblingMax"],
      "metadata.defense":   ["defenseMin","defenseMax"],
      "metadata.physical":  ["physicalMin","physicalMax"],
      "metadata.height":    ["heightMin","heightMax"],
    };
    for (const [key, val] of url.searchParams.entries()) {
      if (key === "sort") continue;
      if (rangeMap[key]) {
        const [mn, mx] = rangeMap[key];
        const [a, b]   = val.split(":");
        if (a?.trim()) apiParams.set(mn, a.trim());
        if (b?.trim()) apiParams.set(mx, b.trim());
        continue;
      }
      if (["positions.name","positions","position"].includes(key)) { apiParams.set("positions", val); continue; }
      if (key === "activeContract") { if (val.toLowerCase().includes("free")) apiParams.set("isFreeAgent","true"); continue; }
      if (!["page","tab","view","type"].includes(key)) apiParams.set(key, val);
    }
    return `${BASE_API}?${apiParams.toString()}`;
  } catch { return null; }
}

// ─── FIELD HELPERS ───────────────────────────────────────────────────────────

function getListingId(item) {
  return item.listingResourceId || item.id || item.listingId || item._id || null;
}

function getListingType(item, monitor) {
  if (item?.club) return "CLUB";
  if (item?.pack) return "PACK";
  if (item?.player) return "PLAYER";
  const pageUrl = (monitor?.pageUrl || "").toLowerCase();
  const apiUrl  = (monitor?.apiUrl || "").toLowerCase();
  if (pageUrl.includes("/packs") || apiUrl.includes("type=pack")) return "PACK";
  if (pageUrl.includes("/clubs") || apiUrl.includes("type=club")) return "CLUB";
  return "PLAYER";
}

function formatLocation(city, country) {
  const parts = [city, country].map(v => (v || "").trim()).filter(Boolean);
  return parts.join(", ") || "Unknown location";
}

function formatOwner(item) {
  return item.sellerName
    || item.club?.ownedBy?.name
    || item.player?.ownedBy?.name
    || item.pack?.ownedBy?.name
    || "";
}

function formatStats(meta) {
  const parts = [];
  if (meta.overall !== null) parts.push(`OVR ${meta.overall}`);
  if (meta.posStr) parts.push(meta.posStr);
  if (meta.age !== null) parts.push(`Age ${meta.age}`);
  const attrs = [
    meta.pace      != null ? `PAC ${meta.pace}`      : null,
    meta.shooting  != null ? `SHO ${meta.shooting}`  : null,
    meta.passing   != null ? `PAS ${meta.passing}`   : null,
    meta.dribbling != null ? `DRI ${meta.dribbling}` : null,
    meta.defense   != null ? `DEF ${meta.defense}`   : null,
    meta.physical  != null ? `PHY ${meta.physical}`  : null,
  ].filter(Boolean);
  if (attrs.length) parts.push(attrs.join(" · "));
  return parts.join(" · ");
}

function extractMeta(item, monitor) {
  const listingType = getListingType(item, monitor);
  const price = item.price ?? item.listing?.price ?? null;
  const owner = formatOwner(item);

  if (listingType === "CLUB") {
    const club = item.club || {};
    const clubName = (club.name || "").trim() || `Club #${club.id || "?"}`;
    const location = formatLocation(club.city, club.country);
    return {
      listingType,
      name: clubName,
      clubName,
      location,
      price,
      owner,
      overall: null,
      posStr: "",
      age: null,
      pace: null,
      shooting: null,
      passing: null,
      dribbling: null,
      defense: null,
      physical: null,
      stats: "",
    };
  }

  if (listingType === "PACK") {
    const pack = item.pack || {};
    const template = pack.packTemplate || {};
    const packName = (template.name || template.type || "Pack").trim();
    return {
      listingType,
      name: packName,
      packName,
      packType: template.type || "",
      price,
      owner,
      overall: null,
      posStr: "",
      age: null,
      pace: null,
      shooting: null,
      passing: null,
      dribbling: null,
      defense: null,
      physical: null,
      stats: "",
    };
  }

  const meta = item.player?.metadata || {};
  const firstName = meta.firstName || item.player?.firstName || "";
  const lastName  = meta.lastName  || item.player?.lastName  || "";
  const name = (firstName && lastName) ? `${firstName} ${lastName}`
             : (lastName || firstName || "Unknown player");
  const extracted = {
    listingType: "PLAYER",
    name,
    price,
    owner,
    overall: meta.overall ?? item.player?.overall ?? null,
    posStr: (meta.positions || item.player?.positions || []).slice(0, 2).join("/"),
    age: meta.age ?? null,
    pace: meta.pace ?? null,
    shooting: meta.shooting ?? null,
    passing: meta.passing ?? null,
    dribbling: meta.dribbling ?? null,
    defense: meta.defense ?? null,
    physical: meta.physical ?? null,
  };
  extracted.stats = formatStats(extracted);
  return extracted;
}

function getItemUrl(item, monitor) {
  const listingType = getListingType(item, monitor);

  if (listingType === "CLUB") {
    const club = item.club || {};
    if (club.id) return `https://app.playmfl.com/clubs/${club.id}`;
    return "https://app.playmfl.com/marketplace/clubs";
  }

  if (listingType === "PACK") {
    const listingId = getListingId(item);
    if (listingId) {
      return `https://app.playmfl.com/marketplace/packs?listingResourceId=${listingId}`;
    }
    const chainId = item.pack?.chainId;
    if (chainId) return `https://app.playmfl.com/marketplace/packs?chainId=${chainId}`;
    return "https://app.playmfl.com/marketplace/packs";
  }

  const player = item.player || {};
  const meta   = player.metadata || {};
  const slug   = player.slug || meta.slug || player.playerSlug || meta.playerSlug;
  const id     = player.id || player.playerId || meta.id || meta.playerId || item.playerId;
  if (slug) return `https://app.playmfl.com/players/${slug}`;
  if (id)   return `https://app.playmfl.com/players/${id}`;
  return "https://app.playmfl.com/marketplace/players";
}

function formatPrice(price) {
  return price !== null && price !== undefined ? `$${price}` : "Price N/A";
}

function buildAlertText(item, monitor) {
  const meta = extractMeta(item, monitor);
  const filter = monitor.label;

  if (meta.listingType === "CLUB") {
    return `${filter} · ${meta.clubName} · ${meta.location} · ${formatPrice(meta.price)}`;
  }
  if (meta.listingType === "PACK") {
    return `${filter} · ${meta.packName} · ${formatPrice(meta.price)}`;
  }
  return `${filter} · ${meta.name} · ${meta.stats || "Player"} · ${formatPrice(meta.price)}`;
}

// ─── DISCORD ─────────────────────────────────────────────────────────────────

async function sendDiscord(monitor, items) {
  if (!monitor.discordWebhook) return;

  for (const item of items) {
    const meta    = extractMeta(item, monitor);
    const itemUrl = getItemUrl(item, monitor);
    const fields  = [{ name: "Filter", value: monitor.label, inline: false }];

    if (meta.listingType === "CLUB") {
      fields.push(
        { name: "Club", value: meta.clubName, inline: true },
        { name: "Location", value: meta.location, inline: true },
        { name: "Price", value: formatPrice(meta.price), inline: true },
      );
      if (meta.owner) fields.push({ name: "Owner", value: meta.owner, inline: true });
    } else if (meta.listingType === "PACK") {
      fields.push(
        { name: "Pack", value: meta.packName, inline: true },
        { name: "Price", value: formatPrice(meta.price), inline: true },
      );
      if (meta.packType) fields.push({ name: "Type", value: meta.packType, inline: true });
      if (meta.owner) fields.push({ name: "Owner", value: meta.owner, inline: true });
    } else {
      fields.push(
        { name: "Player", value: meta.name, inline: true },
        { name: "Price", value: formatPrice(meta.price), inline: true },
      );
      if (meta.stats) fields.push({ name: "Stats", value: meta.stats, inline: false });
      if (meta.owner) fields.push({ name: "Owner", value: meta.owner, inline: true });
    }

    fields.push({ name: "Open", value: `[View ${meta.listingType === "CLUB" ? "club" : meta.listingType === "PACK" ? "pack" : "player"}](${itemUrl})`, inline: false });

    const embed = {
      title:       meta.name,
      url:         itemUrl,
      description: buildAlertText(item, monitor),
      color:       meta.listingType === "CLUB" ? 0xF58426 : meta.listingType === "PACK" ? 0x9b59b6 : 0x2563eb,
      fields,
      footer:      { text: "MFL Monitor" },
      timestamp:   new Date().toISOString(),
    };

    try {
      const r = await (await fetch)(monitor.discordWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "MFL Monitor",
          content: buildAlertText(item, monitor),
          embeds: [embed],
        }),
      });
      if (!r.ok) console.error(`[Discord] HTTP ${r.status} for "${monitor.label}"`);
    } catch(e) {
      console.error(`[Discord] Error for "${monitor.label}":`, e.message);
    }
    if (items.length > 1) await new Promise(r => setTimeout(r, 500));
  }
}

// ─── POLLING ─────────────────────────────────────────────────────────────────

async function pollMonitor(monitor) {
  if (!monitor.apiUrl || !monitor.enabled) return;
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] Polling: ${monitor.label}`);

  try {
    const res  = await (await fetch)(monitor.apiUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json     = await res.json();
    const listings = Array.isArray(json) ? json : (json.listings || json.data || json.results || []);

    // Re-load from disk to get freshest seenIds (another poll may have run concurrently)
    const monitors = load();
    const idx = monitors.findIndex(m => m.id === monitor.id);
    if (idx === -1) return;

    const seenIds  = monitors[idx].seenIds || [];
    const newItems = listings.filter(item => {
      const id = getListingId(item);
      return id && !seenIds.includes(id);
    });

    monitors[idx].seenIds   = [...new Set([...seenIds, ...listings.map(getListingId).filter(Boolean)])].slice(-500);
    monitors[idx].lastCheck = new Date().toISOString();
    monitors[idx].lastError = null;
    if (newItems.length > 0) monitors[idx].newCount = (monitors[idx].newCount || 0) + newItems.length;
    save(monitors);

    if (newItems.length === 0) { console.log(`  → no new listings`); return; }
    console.log(`  → ${newItems.length} new — sending to Discord`);

    if (monitor.discordWebhook) {
      await sendDiscord(monitor, newItems);
    }
  } catch(err) {
    console.error(`  → error: ${err.message}`);
    const monitors = load();
    const idx = monitors.findIndex(m => m.id === monitor.id);
    if (idx !== -1) { monitors[idx].lastError = err.message; save(monitors); }
  }
}

// ─── SCHEDULER ───────────────────────────────────────────────────────────────

const timers = new Map();

function clearTimer(id) {
  if (timers.has(id)) { clearInterval(timers.get(id)); timers.delete(id); }
}

function scheduleOne(monitor) {
  clearTimer(monitor.id);
  if (!monitor.enabled) return;
  const ms = (monitor.intervalMinutes || 1) * 60 * 1000;
  pollMonitor(monitor); // run immediately
  timers.set(monitor.id, setInterval(() => {
    // Always read fresh copy from disk so pause/delete is respected
    const m = load().find(m => m.id === monitor.id);
    if (m && m.enabled) pollMonitor(m);
    else clearTimer(monitor.id);
  }, ms));
}

function rescheduleOne(monitor) {
  clearTimer(monitor.id);
  if (monitor.enabled) scheduleOne(monitor);
}

function scheduleAll() {
  const monitors = load();
  console.log(`[BOOT] Scheduling ${monitors.filter(m => m.enabled).length} active monitor(s)`);
  monitors.forEach((m, i) => {
    if (m.enabled) setTimeout(() => scheduleOne(m), i * 2000); // stagger startup polls
  });
}

// ─── START ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     MFL Monitor — Cloud Server           ║");
  console.log(`║     Listening on port ${PORT}               ║`);
  console.log("╚══════════════════════════════════════════╝");
  scheduleAll();
});
