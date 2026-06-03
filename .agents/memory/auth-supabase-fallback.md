---
name: Auth Supabase dead-URL fallback
description: Why login has a local HMAC-token fallback alongside Supabase Auth
---

# Login resilience: Supabase + local fallback

The configured `SUPABASE_URL` project host can stop resolving (DNS `ENOTFOUND`)
when the Supabase project is deleted/paused — this breaks ALL login (dev + prod),
not just real accounts.

**Rule:** the demo account must log in even when Supabase is unreachable.
Login tries Supabase first for real accounts, but the demo credentials always
succeed via a self-contained HMAC-signed token (`yclocal.` prefix), verified
locally in `requireAuth` before falling through to Supabase. The local token is
strictly scoped to the demo identity (fixed `sub` + allowlisted email) and is
only enabled when a strong signing secret (SUPABASE_SERVICE_ROLE_KEY or
SESSION_SECRET, ≥24 chars) exists — never a hardcoded literal.

**Why:** this app is a live investor/demo dashboard; a dead external auth
dependency must never lock the owner out, but the fallback must not become an
auth-bypass for arbitrary users.

**How to apply:** if login regresses, first check workflow logs for
`getaddrinfo ENOTFOUND ...supabase.co`. If present, Supabase is gone — the local
fallback should still let the demo account in. To restore real multi-user auth,
provide a valid Supabase project URL + anon + service-role keys.
