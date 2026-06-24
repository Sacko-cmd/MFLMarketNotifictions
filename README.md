# MFL Monitor — **Deprecated**

> **This repo is no longer maintained.** The marketplace monitor has been merged into [mfl-location-tracker](https://github.com/Sacko-cmd/mfl-location-tracker).
>
> - **Server:** deploy `mfl-location-tracker` on Render (do not deploy this repo’s `server/` folder).
> - **Extension:** load the `extension/` folder from `mfl-location-tracker` instead.
> - **Render:** suspend the old `mflmarketnotifictions` web service after switching.

---

# MFL Monitor — Combined Setup Guide (legacy)

The Chrome extension is your UI. The cloud server does the 24/7 polling and Discord notifications.

---

## How it works

```
Chrome Extension  →  saves monitor to  →  Cloud Server (Render.com, free)
     (you)                                      ↓
                                        polls MFL every 1 min
                                                ↓
                                        Discord webhook → your phone
```

Your PC and Chrome can be completely off. The server runs forever.

---

## Step 1 — Deploy the server to Render.com

1. Go to [github.com](https://github.com) → **New repository** → name it `mfl-monitor-server` → Create
2. Click **uploading an existing file** and upload everything inside the `server/` folder (`server.js`, `package.json`)
3. Go to [render.com](https://render.com) → sign in with GitHub → **New +** → **Web Service**
4. Connect your `mfl-monitor-server` repo
5. Fill in:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** Free
6. Click **Create Web Service**
7. Wait ~2 minutes for it to deploy. Copy your service URL — it looks like:
   `https://mfl-monitor-server.onrender.com`

> **Important:** Use **Web Service**, not Background Worker.
> Web Services have a public URL the extension can POST to.

---

## Step 2 — Install the Chrome extension

1. Open Chrome → go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder from this zip
5. The MFL Monitor icon appears in your toolbar

---

## Step 3 — Connect the extension to your server

1. Click the extension icon
2. You'll see a one-time setup screen asking for your server URL
3. Paste your Render URL (e.g. `https://mfl-monitor-server.onrender.com`)
4. Click **Save & Connect**

This is saved permanently — you only do this once.

---

## Step 4 — Add your first monitor

Everything works exactly as before:

1. Browse MFL marketplace with your filters set
2. Click the extension icon → **+ NEW**
3. Click **detect** to grab the current tab's URL
4. Choose notification mode and paste your Discord webhook
5. Click **Save Monitor**

The monitor is instantly sent to the cloud server, which starts polling immediately.
You'll get Discord notifications even with Chrome closed and your PC off.

---

## Managing monitors

The extension popup works as normal — pause, resume, delete, change interval.
All changes sync to the server in real time.

---

## Render free tier notes

- Free Web Services spin down after 15 minutes of no HTTP traffic
- This means if nothing calls `/` for 15 min, the server sleeps and misses polls
- **Fix:** use [UptimeRobot](https://uptimerobot.com) (free) to ping your server URL every 5 minutes
  - Sign up → **Add New Monitor** → HTTP(s) → paste your Render URL → every 5 min
  - This keeps it awake 24/7 at no cost

---

## File structure

```
mfl-monitor/
├── extension/          ← load this folder as unpacked Chrome extension
│   ├── manifest.json
│   ├── background.js
│   ├── popup.html
│   ├── popup.js
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
└── server/             ← upload these two files to GitHub, deploy on Render
    ├── server.js
    └── package.json
```
