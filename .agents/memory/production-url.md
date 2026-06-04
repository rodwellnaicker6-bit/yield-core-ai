---
name: Production URL vs hardcoded share URL
description: The app's real published URL differs from the URL hardcoded in share/registration links; how to find the true one.
---

# Real production URL ≠ the hardcoded one

The code's `LIVE_URL` (server.js) is the base for every share, registration, footer, and dashboard link the app emits (WhatsApp messages, /register, /farmers, /pay, hero image). It previously defaulted to `https://yieldcore.replit.app`, which is **not this project's deployment** and serves Replit's "This app isn't live yet" 404 — so anyone given that link could not open the app.

**Rule:** never trust a hardcoded `*.replit.app` URL in the source as the live address. Get the real one from `getDeploymentInfo().primaryUrl`.
**Why:** a business partner couldn't open the app because they were handed the dead `yieldcore.replit.app` link while the live build was at a different generated subdomain.
**How to apply:** `LIVE_URL` is now set as a shared env var (source of truth) AND the code fallback points to the real deployment URL. If the deployment is renamed or moved to a custom domain, update the `LIVE_URL` env var and republish so all outbound links follow. The dev container's `REPLIT_DOMAINS` is the `.replit.dev` dev domain, not production — don't use it for share links.
