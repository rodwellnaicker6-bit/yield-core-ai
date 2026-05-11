# YieldCore AI — Smart Farming Dashboard (South Africa)

## Overview
A full-featured desktop + mobile precision agriculture dashboard for South African farming operations. Built with Node.js/Express backend + vanilla HTML/CSS/JS frontend.

## Login
- Email: rodwell@yieldcore.ai
- Password: yield2025

## Tech Stack
- **Backend:** Node.js + Express (server.js) on port 5000
- **Frontend:** Single-page HTML (index.html) — dark green theme, Sora font
- **Weather:** Open-Meteo API (live, refreshes every 10 min)
- **WhatsApp:** Twilio WhatsApp API (/api/whatsapp/alert)
- **AI:** OpenAI GPT-4o-mini via /api/ai backend proxy

## Secrets Required
- `TWILIO_ACCOUNT_SID` — Twilio account SID
- `TWILIO_AUTH_TOKEN` — Twilio auth token
- `TWILIO_WHATSAPP_FROM` — WhatsApp from number (e.g. whatsapp:+14155238886)
- `TWILIO_WHATSAPP_TO` — WhatsApp to number
- `OPENAI_API_KEY` — OpenAI API key for AI Advisor

## Pages / Routes
- `/` — Main dashboard (login required)
- `/landing` or `/welcome` — Public marketing landing page
- `/pay` — Pricing & payment page
- `/register` — Farmer onboarding registration

## Modules / Sections Built
1. **Dashboard Overview** — stats cards, farm health scores, SA map, SAFEX market prices, alerts
2. **Solar Monitoring** — 7 farms, live kWh, efficiency, savings
3. **Irrigation Control** — 5 farms, live soil moisture, flow rates
4. **NDVI** — 10 fields, crop vitality index, satellite data
5. **Temp & Humidity Sensors** — 5 provinces, live readings
6. **Pest Identification** — 8 detections, AI confidence, WhatsApp alerts
7. **Full Alerts Panel** — filterable, WhatsApp send-all
8. **Nutrient Monitoring (NPK)** — 6 farms, N/P/K/Ca bars with optimal ranges
9. **Yield Projection & Profit Calculator** — 6 farms, revenue/cost/profit/margin
10. **AI Crop Advisor** — GPT-4o chat, quick prompts, system context for SA farming
11. **Community Grain Vending Machine** — 4 locations, stock levels, WhatsApp restock alerts
12. **Carbon Credit Tracker** — 8 farms, VCS + Gold Standard + SA Carbon Tax, certificate generator
13. **Investor Pitch Module** — Series A pitch, 5-year revenue chart, investment ask
14. **AI Insights Engine** — Live recommendation cards per farm section (critical/warning/opportunity/info)
15. **Modules Grid** — 15 quick-access module cards

## Masterplan Features Implemented
- **Mobile-First** — Full responsive layout ≤480px: sidebar hidden, 5-item bottom nav bar, slide-in drawer with all navigation, compact topbar, all grids collapse to 1-2 columns, bottom padding for nav bar
- **Visual Design** — 26px stat values, 33px intro headline, reduced glow intensity, cleaner spacing
- **AI Recommendation Engine** — `renderInsights()` scans irrigation/pest/NPK/solar/carbon data and surfaces 6 ranked actionable cards (critical → warning → opportunity → info), refreshes every 60s
- **Farmer Onboarding Flow** — 4-step wizard modal (Welcome → Farm Details → WhatsApp → Done), saves to localStorage, shows on first login
- **Reporting System** — `sendFarmReport()` compiles all farm metrics (health, solar, irrigation, NPK, pests, carbon) into a formatted WhatsApp message sent via `/api/whatsapp/alert`
- **Public Landing Page** — `/landing` — standalone marketing page with hero, social proof, 9 features grid, 3-tier pricing, CTA, mobile responsive
- **Trust & Transparency** — Trust strip above stats showing LIVE vs MODEL DATA sources with colour-coded dots

## Architecture
- `server.js` — Express server, static file serving, /api/whatsapp/alert, /api/ai, /api/status, /landing, /welcome routes
- `index.html` — Complete SPA (~3500+ lines), all CSS + JS inline
- `landing.html` — Public marketing page at /landing
- Live data refreshes every 5s (solar, irrigation, sensors)
- Weather refreshes every 10 min
- AI Insights refresh every 60s

## Design
- Background: #060f07 (near-black green)
- Accent: #22c55e (green)
- Fixed 220px sidebar on desktop, hidden on mobile (≤480px)
- Sticky 64px topbar (52px on mobile)
- Mobile: Fixed bottom nav bar + slide-in right drawer
- Responsive breakpoints: 1300px, 1000px, 750px, 480px

## User Preferences
- South African context throughout (ZAR, SAFEX, SA provinces, SA carbon tax)
- WhatsApp-first communication (Twilio sandbox)
- Dark green theme (#060f07 background, #22c55e accent)
- Sora font for headings, Inter for body
