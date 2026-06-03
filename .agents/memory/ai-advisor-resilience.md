---
name: AI Advisor resilience (no-leak fallback)
description: Why the AI Advisor and WhatsApp bot must never surface provider errors, and how the simulation fallback works.
---

# AI Advisor must never leak provider/secret details

**Rule:** `/api/ai` and the WhatsApp inbound AI webhook must NEVER return provider
error text, HTTP status codes, secret names, or "key invalid/not configured"
messages to clients. On a missing key OR any provider exception they fall back to
`simulatedReply(question)` and return HTTP 200. The frontend `sendAI()` also never
renders backend `error` fields — only `reply`, else a generic branded line.

**Why:** This is an investor-demo product; a leaked "Invalid OpenAI API key" or
stack trace breaks the illusion and exposes infrastructure. The provider key can be
present-but-invalid (401) so "key exists" checks are not enough — must catch runtime failures too.

**How to apply:** `simulatedReply()` (server.js) is a keyword router returning
practical SA-farming demo answers (irrigation/pest/NPK/SAFEX/carbon/weather/yield +
general capability overview). Keep it free of user-input interpolation. Presentation
Mode is `?presentation=true` — shows an "AI Advisor Ready" badge and seeds a welcome
message. Backend already always returns a useful reply regardless of the flag.
