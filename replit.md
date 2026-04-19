# YieldCore AI — Smart Farming Dashboard (South Africa)

## Overview
A full-featured desktop precision agriculture dashboard for South African farming operations. Built with Node.js/Express backend + vanilla HTML/CSS/JS frontend.

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
11. **Community Grain Vending Machine** — 4 locations (Botshabelo, Khayelitsha, Soweto, Motherwell), stock levels, WhatsApp restock alerts
12. **Carbon Credit Tracker** — 8 farms, VCS + Gold Standard + SA Carbon Tax, live VCM price (USD/ZAR), verified/pending tonnes, certificate generator, WhatsApp report
13. **Investor Pitch Module** — Series A pitch with 5-year revenue chart, revenue mix, use of funds, ESG impact, roadmap, investment ask, WhatsApp share, print/PDF, and investor email copy
13. **Modules Grid** — 9 quick-access module cards

## Architecture
- `server.js` — Express server, static file serving, /api/whatsapp/alert, /api/ai, /api/status
- `index.html` — Complete SPA (~1500 lines), all CSS + JS inline
- Live data refreshes every 5s (solar, irrigation, sensors)
- Weather refreshes every 10 min

## Design
- Background: #060f07 (near-black green)
- Accent: #22c55e (green)
- Fixed 220px sidebar, sticky 64px topbar
- Responsive down to ~750px
