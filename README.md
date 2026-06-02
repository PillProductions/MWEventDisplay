# MWEventDisplay

A tiny web-based **event screen** for conferences and meetings. Configure a logo,
event name, Wi-Fi credentials, a program and reminder lines, pick background
images, press **Play**, and the page becomes a fullscreen slideshow that cycles
through each cue with fade/zoom effects.

The whole point is the **share link**: configure once, copy the URL, and have
every (AirTame-powered) TV open the same link at the same time. Each screen
streams the contents natively and autoplays — no sign-in, no clicks.

## How the share link works (two modes)

| You did… | Link looks like | Server needed? |
|----------|-----------------|----------------|
| **No custom images** (defaults or already-uploaded assets) | `…/#cfg=<base64>` | **No** — the whole config is encoded in the URL, fully offline. |
| **Uploaded your own logo/backgrounds** | `…/#id=<shortId>` | Yes — images are stored in Azure Blob; the URL stays short. |

This keeps the original zero-dependency behaviour for the common case, and only
touches the backend when you actually upload images (which would otherwise blow
past browser URL-length limits).

## Run locally (front end only)

Open `index.html` in a modern browser. Everything works offline. Put your own
defaults in `defaults/` (`logo.png`, `bg-01.jpg`, `bg-02.jpg`, `Reckless-Regular.ttf`).
Custom **uploads** require the API (below) to be running.

## Project layout

```
index.html, player.js, style.css   # static site
defaults/                          # bundled logo / backgrounds / font
staticwebapp.config.json           # routing + security headers (CSP, nosniff…)
api/                               # Azure Functions backend
  src/functions/save.js            #   POST /api/save        → store config, return id
  src/functions/config.js          #   GET  /api/config/{id} → fetch config JSON
  src/functions/asset.js           #   GET  /api/asset/{id}/{name} → serve image
  src/lib/{images,config,storage}.js
.github/workflows/                 # CI/CD to Azure Static Web Apps
```

## Deploy to Azure

Hosting is **Azure Static Web Apps** (free tier: static site + managed Functions
+ HTTPS + custom domain).

1. **Create the resource**
   - Azure Portal → *Static Web Apps* → *Create*.
   - Link this GitHub repo, branch `main`.
   - Build details: **App location** `/`, **Api location** `api`, **Output location** *(empty)*.
   - This commits a deployment token secret (`AZURE_STATIC_WEB_APPS_API_TOKEN`)
     and reuses the workflow in `.github/workflows/`.

2. **Add a Storage account**
   - Create a general-purpose v2 Storage account.
   - In the Static Web App → *Configuration* → application settings, add:
     - `BLOB_CONNECTION_STRING` = the storage account connection string.
     - `EVENTS_CONTAINER` = `events` (optional; this is the default).
   - The private `events` container is created automatically on first upload.

3. **(Recommended) Auto-expire old events**
   - On the Storage account → *Lifecycle management*, add a rule to delete
     blobs in the `events` container after e.g. 30 days. Event screens are
     ephemeral, so this caps storage growth and data retention.

4. **Custom domain** (optional): add `screens.yourco.dk` in the Static Web App.

### Local backend development

```bash
cd api
cp local.settings.json.example local.settings.json   # uses Azurite by default
npm install
npm start                                             # func start
```

Run the [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite)
storage emulator alongside it, or point `BLOB_CONNECTION_STRING` at a real account.

## Security model (anonymous uploads, done safely)

Uploads are anonymous by design (TVs must open a link with no sign-in), so the
backend treats every upload as hostile and is hardened accordingly:

- **Server-side re-encode** — every image is decoded and re-encoded to a clean
  WebP via `sharp`. This destroys any embedded script, polyglot payload, or
  appended data, and strips all metadata/EXIF. This is the primary defense.
- **SVG is rejected** (it can carry script); only PNG/JPEG/WebP are accepted.
- **Magic-byte check** — the declared type must match the real file bytes.
- **Limits** — per-image size cap, max background count, total payload cap, and
  output dimensions capped at 4K. Guards against decompression bombs.
- **Private storage** — the `events` container has no public access. Images are
  served only through `/api/asset/{id}/{name}` with an explicit `image/*`
  content type and `X-Content-Type-Options: nosniff`, so a stored blob can never
  be interpreted as HTML/JS.
- **Unguessable IDs** — ~64 bits of crypto-random entropy; events aren't enumerable.
- **Strict CSP** — `staticwebapp.config.json` sets `script-src 'self'`,
  `object-src 'none'`, `frame-ancestors`, nosniff, etc.
- **Config whitelisting** — only known fields are stored; no arbitrary data.
- **Client-side escaping** — all user text is HTML-escaped before rendering, so
  even a hand-crafted `#cfg=` link cannot run script on a screen.

### Preventing upload abuse (anonymous-spam protection)

The TVs only ever **read** (`GET /api/config`, `/api/asset`), so playback stays
fully anonymous. Only staff **upload** (`POST /api/save`) when configuring an
event — which means the upload endpoint can be locked down without affecting how
screens open links. Defenses, strongest first:

1. **Upload key (recommended).** Set an `UPLOAD_KEY` application setting on the
   Static Web App. When present, every `POST /api/save` must send a matching
   `x-upload-key` header; reads are unaffected. The operator's browser prompts
   for the key once and stores it in `localStorage`, so anonymous third parties
   can't upload at all. Leaving `UPLOAD_KEY` unset keeps the endpoint open
   (handy for local dev). Rotate the key by changing the app setting.

2. **Blob lifecycle retention.** Auto-delete old events so storage can't grow
   unbounded. A ready-made policy is in `infra/lifecycle-policy.json` (deletes
   `events/` blobs 30 days after last modification). Apply it with:

   ```bash
   az storage account management-policy create \
     --account-name <yourStorageAccount> \
     --resource-group <yourResourceGroup> \
     --policy @infra/lifecycle-policy.json
   ```

   (or Portal → Storage account → *Lifecycle management* → add rule).

3. **Per-request caps (built in).** Max background count, per-image size cap,
   total payload cap, and 4K output dimensions limit how much any single request
   can store.

4. **Rate limiting / WAF.** For internet-facing deployments, front the app with
   **Azure Front Door + WAF** and add a rate-limit rule on `/api/save` to stop
   volumetric flooding even from a holder of the key. The app-level guards
   prevent *malicious content*; the WAF prevents *volumetric abuse*.

> Quick recommendation: turn on the **upload key** + **lifecycle retention** for
> any shared/internet-facing deployment. That alone removes the anonymous-spam
> risk and caps storage. Add Front Door/WAF if the app is broadly reachable.
