---
name: Mapbox map "not showing" diagnosis
description: Why a valid Mapbox setup can still render blank/"unavailable" in the browser, and how the loader must surface the real reason.
---

# Mapbox map fails to display — diagnosis order

The SA satellite map (`#saMap`, `renderMap()` in index.html) depends on: `MAPBOX_TOKEN` secret → `/api/config` → `window._mbxToken`; the Mapbox GL JS CDN script (`window.mapboxgl`); the helmet CSP in server.js; a sized container; and browser WebGL.

**Why server-side checks can all pass while the map still fails for the user:**
- `curl` against Mapbox APIs sends no `Referer`/`Origin`, so it cannot detect a **URL-restricted** token — a restricted token returns 200 to curl but 403 in the browser. Test by adding `-H "Referer: https://<domain>/"`.
- The token, `/api/config`, CSP, and container can all be correct; the real failure is browser-only: blocked/slow CDN, WebGL disabled, or tile-fetch 401/403.

**Rule:** the fallback UI must report the *actual* cause, never a single generic "add MAPBOX_TOKEN" message.
**Why:** a misleading "token not set" message when the token IS set sends everyone down the wrong path (this exact bug was reported as "map box is not set").
**How to apply:** keep distinct fallbacks for missing-engine vs missing-token vs WebGL-off; poll for `window.mapboxgl` and inject a `cdn.jsdelivr.net` fallback script if the primary `api.mapbox.com` CDN is blocked (jsDelivr is already whitelisted in scriptSrc/styleSrc); detect 401/403 via `e.error.status` in `map.on('error')`, tear the map down, and offer Retry (Retry must reset both `_mbxWait` and `_mbxFallbackTried`).

Note: production at yieldcore.replit.app may show "This app isn't live yet" — that means the deployment isn't promoted, unrelated to the map code. Secrets are global, so MAPBOX_TOKEN is present in prod too.
