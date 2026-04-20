const express = require('express');
const cors = require('cors');
const twilio = require('twilio');
const OpenAI = require('openai');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname)));

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ── WHATSAPP ALERT ──
app.post('/api/whatsapp/alert', async (req, res) => {
  const { message, to } = req.body;
  // Hardcoded recipient (Rodwell's WhatsApp) — overrides any misconfigured secret
  const recipient = to || 'whatsapp:+27825172688';
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const fromRaw = process.env.TWILIO_WHATSAPP_FROM || '+14155238886';
    const from = fromRaw.startsWith('whatsapp:') ? fromRaw : `whatsapp:${fromRaw}`;
    const toFinal = recipient.startsWith('whatsapp:') ? recipient : `whatsapp:${recipient}`;
    const msg = await twilioClient.messages.create({ from, to: toFinal, body: message });
    res.json({ success: true, sid: msg.sid });
  } catch (err) {
    console.error('WhatsApp error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SHARE CONFIG ──
const LIVE_URL = process.env.LIVE_URL || 'https://yieldcore.replit.app';
const SANDBOX_CODE = process.env.SANDBOX_JOIN_CODE || 'your-join-code';
const SANDBOX_NUMBER = '+14155238886';
const FOOTER = `\n\n━━━━━━━━━━━━━━\n🌐 Open your live command center:\n${LIVE_URL}\n\n👥 Invite a farmer friend → reply *SHARE*`;

// ── WEATHER (Open-Meteo, no key needed) ──
async function getWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=Africa/Johannesburg&forecast_days=4`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('weather fetch failed');
  return r.json();
}
function wxIcon(code){
  if(code===0)return '☀️';if(code<=3)return '⛅';if(code<=48)return '🌫️';
  if(code<=67)return '🌧️';if(code<=77)return '🌨️';if(code<=82)return '🌦️';
  if(code<=99)return '⛈️';return '🌤️';
}
function wxDesc(code){
  const m={0:'clear sky',1:'mostly clear',2:'partly cloudy',3:'overcast',45:'fog',48:'icy fog',
    51:'light drizzle',53:'drizzle',55:'heavy drizzle',61:'light rain',63:'rain',65:'heavy rain',
    71:'snow',73:'snow',75:'heavy snow',80:'rain showers',81:'rain showers',82:'violent showers',
    95:'thunderstorm',96:'thunderstorm + hail',99:'severe storm + hail'};
  return m[code]||'mixed conditions';
}

// Build YieldCore insights from a location
async function buildLocationBriefing(lat, lng, label) {
  const wx = await getWeather(lat, lng);
  const c = wx.current, d = wx.daily;
  const t = Math.round(c.temperature_2m), h = Math.round(c.relative_humidity_2m);
  const ws = Math.round(c.wind_speed_10m), pr = c.precipitation;
  const tomorrowMax = Math.round(d.temperature_2m_max[1]), tomorrowMin = Math.round(d.temperature_2m_min[1]);
  const rain48 = (d.precipitation_sum[0]||0)+(d.precipitation_sum[1]||0);
  const icon = wxIcon(c.weather_code), desc = wxDesc(c.weather_code);

  // YieldCore intelligence
  let irrigation, alert, soilTip, cropAdvice, savings;
  if (rain48 >= 8) {
    irrigation = `🛑 *PAUSE irrigation* — ${rain48.toFixed(1)}mm rain forecast in next 48h.\n   💧 Saves ~${Math.round(rain48*420)}L per hectare`;
    savings = `R ${Math.round(rain48*420*0.018).toLocaleString()}/ha saved on water + electricity`;
  } else if (rain48 >= 2) {
    irrigation = `⏳ *REDUCE irrigation by 50%* — ${rain48.toFixed(1)}mm rain expected.\n   💧 Apply only at dawn`;
    savings = `R ${Math.round(rain48*220*0.018).toLocaleString()}/ha saved`;
  } else if (t >= 30) {
    irrigation = `🚨 *HEAT-STRESS PROTOCOL* — irrigate at 04h00 + 19h00 only (avoid evaporation loss)\n   💧 +15% volume, drip preferred`;
    savings = `Prevents ~12% yield loss vs midday irrigation`;
  } else {
    irrigation = `✅ *NORMAL irrigation schedule* — 04h30 cycle, ${Math.max(20,40-t)}min per zone\n   💧 Soil moisture healthy`;
    savings = `Optimal water-use efficiency`;
  }

  if (c.weather_code >= 95) alert = `⛈️ *STORM ALERT* — ${desc}. Secure equipment, delay spraying 24h.`;
  else if (ws >= 35) alert = `💨 *HIGH WIND ALERT* — ${ws} km/h. Postpone foliar spray + drone flights.`;
  else if (tomorrowMin <= 4) alert = `❄️ *FROST RISK* — ${tomorrowMin}°C tomorrow night. Activate frost protection on sensitive crops.`;
  else if (tomorrowMax >= 35) alert = `🔥 *HEAT WAVE* — ${tomorrowMax}°C tomorrow. Move livestock to shade, increase water.`;
  else alert = `✅ No critical alerts — operations green-lit.`;

  if (h < 30) soilTip = `🌱 *Soil:* Low humidity (${h}%) → mulch beds, check drip emitters`;
  else if (h > 80) soilTip = `🌱 *Soil:* High humidity (${h}%) → fungal-disease watch on leaves`;
  else soilTip = `🌱 *Soil:* Conditions optimal for root development`;

  const month = new Date().getMonth();
  if (month>=8||month<=1) cropAdvice = `🌾 *Crop tip (Spring/Summer):* Top-dress N now, scout for stalk borer + aphids`;
  else if (month>=2&&month<=4) cropAdvice = `🌾 *Crop tip (Autumn):* Plan winter cover crops, harvest summer grains, soil-test`;
  else cropAdvice = `🌾 *Crop tip (Winter):* Prune fruit trees, plant wheat/barley, repair irrigation`;

  return (
`🌿 *YieldCore AI · Live Farm Intelligence*
📍 ${label||'Your location'}  (${(+lat).toFixed(3)}, ${(+lng).toFixed(3)})

${icon} *NOW:* ${t}°C · ${desc} · ${h}% humidity · 💨 ${ws}km/h
🌡️ *Tomorrow:* ${tomorrowMin}°–${tomorrowMax}°C  ·  🌧️ 48h rain: ${rain48.toFixed(1)}mm

━━━━━━━━━━━━━━
💧 *IRRIGATION*
${irrigation}

⚠️ *ALERTS*
${alert}

${soilTip}

${cropAdvice}

━━━━━━━━━━━━━━
💰 *Today's saving:* ${savings}
📈 Switching to YieldCore typically delivers *+18% yield · −32% water · +R3,200/ha profit*

Reply *MENU* for options, *PRICE* for plans, or share another 📍 location.`
  );
}

// Inbound bot router
function botRouter(text) {
  const t = (text||'').trim().toLowerCase();
  if (!t) return null;
  if (/^(hi|hello|hey|start|menu|help|hola|sawubona|molo)\b/.test(t))
    return `🌿 *Welcome to YieldCore AI!*\n\nI'm your live farm intelligence bot. Try:\n\n📍 *Share a location* → I'll send weather, irrigation plan, alerts & crop tips for that spot\n\nOr reply with:\n• *WEATHER* — current conditions\n• *IRRIGATION* — today's watering plan\n• *ALERTS* — active farm warnings\n• *PRICE* — pricing tiers\n• *DRONE* — drone services\n• *ABOUT* — what YieldCore does\n• *DEMO* — book a free demo\n• *PAY* — pricing & payment page\n• *SHARE* — invite a farmer friend\n\n🚀 Powered by satellites, drones, IoT sensors & AI.`;
  if (/(pay|checkout|order|subscribe|sign up|signup|activate)/.test(t))
    return `💳 *Pay & Activate YieldCore*\n\nOpen our secure payment page to:\n• Pick your tier (R95–R200/ha)\n• Auto-calc your monthly + annual price\n• Pay via WhatsApp / EFT / Card\n• Get 10% off when paying annually\n\n👉 ${LIVE_URL}/pay\n\nOr reply with your *farm hectares* (e.g. "120 ha") and I'll send a custom quote here.`;
  const haMatch = t.match(/(\d{1,5})\s*(ha|hectare|hectares|hect)/);
  if (haMatch) {
    const ha = Math.max(1, parseInt(haMatch[1]));
    const tier = autoTier(ha);
    const monthly = ha * tier.pricePerHa;
    const annual = monthly * 12;
    const annualNet = annual - Math.round(annual*0.10);
    return `💰 *Quote for ${ha} ha*\n\nTier: *${tier.name}* (${tier.range})\nRate: R${tier.pricePerHa}/ha\n\n💵 Monthly: *R ${monthly.toLocaleString('en-ZA')}*\n📅 Annual NET (10% off): *R ${annualNet.toLocaleString('en-ZA')}*\n${tier.perks?'\n'+tier.perks+'\n':''}\n👉 Activate now: ${LIVE_URL}/pay\nOr reply *PAY* for payment options.`;
  }
  if (/(price|pricing|cost|tier|plan)/.test(t))
    return `💰 *YieldCore Pricing (per hectare)*\n\n• Starter (1–49 ha): R200/ha\n• Growth (50–199 ha): R165/ha\n• Pro (200–499 ha): R130/ha\n• Enterprise (500+ ha): R110/ha 🎁 *FREE on-site install*\n• Co-op (1000+ ha): R95/ha\n\nReply *DEMO* for free trial.`;
  if (/(drone|spray)/.test(t))
    return `🚁 *Drone Services*\n\n• Multispectral mapping: R85/ha\n• Precision spraying: R145/ha\n• Plant counting: R65/ha\n• Crop scouting: R95/ha\n\n💡 Free with Enterprise (500+ ha) plan.\nReply *DEMO* to book.`;
  if (/(weather|temperature|rain|wind)/.test(t))
    return `🌦️ Send me your 📍 *location pin* (WhatsApp → 📎 → Location → Send) and I'll give you live weather + farm guidance for that exact spot.`;
  if (/(irrigat|water)/.test(t))
    return `💧 Share your 📍 location and I'll calculate the optimal irrigation schedule based on real-time weather + 48h rain forecast for your farm.`;
  if (/(alert|warning|risk)/.test(t))
    return `⚠️ Share your 📍 location and I'll scan for: storm, frost, heat-wave, wind, hail, drought & disease risk on your farm.`;
  if (/(demo|trial|book)/.test(t))
    return `🎯 *Book a free YieldCore demo*\n\n📞 Call/WhatsApp: 082 517 2688\n📧 hello@yieldcore.ai\n\nWe'll set up a 30-min onboarding for your farm. No card required.`;
  if (/(share|invite|friend|refer)/.test(t))
    return `🤝 *Invite a farmer friend to YieldCore*\n\nForward them this message:\n\n━━━━━━━━━━━━━━\n🌿 *Try YieldCore AI — free farm intelligence on WhatsApp*\n\nStep 1: Save this number 📲 ${SANDBOX_NUMBER}\nStep 2: Send 'join ${SANDBOX_CODE}' to that number\nStep 3: Send your 📍 location and get live weather, irrigation plan, alerts & crop tips\n\n🌐 Full dashboard: ${LIVE_URL}\n━━━━━━━━━━━━━━\n\n✅ Each person gets their own command center. No card required.`;
  if (/(about|who|what is|company)/.test(t))
    return `🌿 *About YieldCore AI*\n\nWe combine satellites, drones, IoT sensors, AI & solar to give South African farmers a full digital command center.\n\n📊 +18% yield · −32% water · −40% chemicals · +R3,200/ha profit\n🛰️ Real-time satellite + drone imagery\n💧 Precision irrigation & solar pumps\n🤖 AI advisor + WhatsApp alerts\n🥬 Bio-input catalog + vending machines\n\nFrom 2 ha to 10,000 ha — we scale with you.\n\n🌐 ${LIVE_URL}`;
  return `🤖 I didn't catch that. Reply *MENU* for options, send 📍 a location pin for live farm intelligence, or *SHARE* to invite a friend.`;
}

// Twilio inbound webhook
app.post('/api/whatsapp/inbound', async (req, res) => {
  try {
    const body = req.body || {};
    const from = body.From, msgBody = body.Body, lat = body.Latitude, lng = body.Longitude;
    const label = body.Label || body.Address || '';
    console.log('📩 WhatsApp in:', from, msgBody?msgBody.slice(0,60):'', lat?`📍${lat},${lng}`:'');

    let reply;
    if (lat && lng) {
      reply = await buildLocationBriefing(lat, lng, label);
    } else {
      reply = botRouter(msgBody);
    }
    if (!reply) reply = `Send 📍 a location or *MENU* for help.`;
    if (!reply.includes(LIVE_URL)) reply += FOOTER;

    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</Message></Response>`);
  } catch (e) {
    console.error('Inbound error:', e.message);
    res.set('Content-Type','text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>⚠️ YieldCore had a hiccup. Try sending your 📍 location again.</Message></Response>`);
  }
});

// Activate-bot button → push welcome to user's WhatsApp
app.post('/api/whatsapp/activate', async (req, res) => {
  try {
    const fromRaw = process.env.TWILIO_WHATSAPP_FROM || '+14155238886';
    const from = fromRaw.startsWith('whatsapp:') ? fromRaw : `whatsapp:${fromRaw}`;
    const to = (req.body.to||'whatsapp:+27825172688');
    const toFinal = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    const msg = await twilioClient.messages.create({ from, to: toFinal, body:
`🌿 *YieldCore AI Bot is LIVE!*

I'm your 24/7 farm intelligence assistant. Right now I can:

📍 *Send me a location pin* — I'll reply with:
   • Live weather + 48h rain forecast
   • Custom irrigation schedule
   • Storm / frost / heat / wind alerts
   • Soil & crop advice for the season
   • Live R-savings calculator

💬 *Or text me:* MENU · PRICE · DRONE · ABOUT · SHARE · DEMO

Try it now → tap 📎 → Location → Send Current Location 📍` + FOOTER });
    res.json({ success:true, sid: msg.sid });
  } catch (e) {
    console.error('Activate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Daily briefing for a specific farm by lat/lng
app.post('/api/whatsapp/briefing', async (req, res) => {
  try {
    const { lat, lng, name } = req.body;
    if (!lat || !lng) return res.status(400).json({ error: 'lat & lng required' });
    const text = await buildLocationBriefing(lat, lng, name||'Your farm');
    const fromRaw = process.env.TWILIO_WHATSAPP_FROM || '+14155238886';
    const from = fromRaw.startsWith('whatsapp:') ? fromRaw : `whatsapp:${fromRaw}`;
    const msg = await twilioClient.messages.create({ from, to:'whatsapp:+27825172688', body: text });
    res.json({ success:true, sid: msg.sid });
  } catch (e) {
    console.error('Briefing error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── AI ADVISOR ──
app.post('/api/ai', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });
  if (!openai) return res.status(503).json({ error: 'OpenAI key not configured. Please add OPENAI_API_KEY in Replit Secrets.' });
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are YieldCore AI, an expert agricultural advisor for South African farms. You specialise in:
- Crop management (maize, wheat, citrus, grapes, avocado, sugarcane, macadamia, sunflower)
- NPK nutrient management and soil health
- Irrigation scheduling and water management
- Pest and disease identification and treatment
- Weather impact analysis for SA farming regions
- SAFEX market prices and yield optimisation
- Sustainable and precision agriculture
- Community food security and grain management

Respond concisely, practically, and in a friendly tone. Use South African context (provinces, rand pricing, local crop names). When recommending treatments, mention both conventional and organic options. Keep responses under 200 words unless a detailed analysis is requested.`
        },
        ...messages
      ],
      max_tokens: 400,
      temperature: 0.7
    });
    res.json({ reply: completion.choices[0].message.content });
  } catch (err) {
    console.error('OpenAI error:', err.message);
    const status = err.status || 500;
    let friendly = err.message;
    if (status === 429) friendly = 'Your OpenAI account has no credits. Please add billing at platform.openai.com/settings/billing → Add payment method, then top up with $5–$10.';
    if (status === 401) friendly = 'Invalid OpenAI API key. Please check your OPENAI_API_KEY secret.';
    res.status(status === 429 ? 402 : 500).json({ error: friendly, code: status });
  }
});

// ── STATUS ──
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    twilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    openai: !!process.env.OPENAI_API_KEY,
    mapbox: !!process.env.MAPBOX_TOKEN,
    from: process.env.TWILIO_WHATSAPP_FROM || null
  });
});

// ── PUBLIC CONFIG (mapbox token is a public pk.* key) ──
app.get('/api/config', (req, res) => {
  res.json({
    mapboxToken: process.env.MAPBOX_TOKEN || null,
    liveUrl: LIVE_URL,
    sandboxCode: SANDBOX_CODE,
    sandboxNumber: SANDBOX_NUMBER
  });
});

// ── PRICING TIERS ──
const TIERS = {
  starter:    { name:'Starter',    range:'1–49 ha',     pricePerHa:200, min:1,    max:49,   color:'#4ade80' },
  growth:     { name:'Growth',     range:'50–199 ha',   pricePerHa:165, min:50,   max:199,  color:'#22c55e' },
  pro:        { name:'Pro',        range:'200–499 ha',  pricePerHa:130, min:200,  max:499,  color:'#facc15' },
  enterprise: { name:'Enterprise', range:'500–999 ha',  pricePerHa:110, min:500,  max:999,  color:'#fb923c', perks:'🎁 FREE on-site install' },
  coop:       { name:'Co-op',      range:'1000+ ha',    pricePerHa:95,  min:1000, max:99999,color:'#f472b6', perks:'🤝 Dedicated success manager' }
};

function autoTier(ha){ for(const k in TIERS){ const t=TIERS[k]; if(ha>=t.min && ha<=t.max) return {key:k, ...t}; } return {key:'starter',...TIERS.starter}; }

// ── PAYMENT QUOTE API ──
app.post('/api/quote', (req, res) => {
  const ha = Math.max(1, parseInt(req.body.hectares)||1);
  const farm = (req.body.farmName||'').toString().slice(0,80);
  const name = (req.body.name||'').toString().slice(0,80);
  const email = (req.body.email||'').toString().slice(0,120);
  const tier = autoTier(ha);
  const monthly = ha * tier.pricePerHa;
  const annual = monthly * 12;
  const annualDiscount = Math.round(annual * 0.10);
  const annualNet = annual - annualDiscount;
  const ref = 'YC-' + Date.now().toString(36).toUpperCase();
  const lines = [
    `🌿 *YieldCore AI — Order Request*`,
    ``,
    `Ref: *${ref}*`,
    name?`Name: ${name}`:null,
    farm?`Farm: ${farm}`:null,
    email?`Email: ${email}`:null,
    `Hectares: *${ha} ha*`,
    `Tier: *${tier.name}* (${tier.range})`,
    `Rate: R${tier.pricePerHa}/ha`,
    ``,
    `💵 Monthly: *R ${monthly.toLocaleString('en-ZA')}*`,
    `📅 Annual: R ${annual.toLocaleString('en-ZA')}`,
    `🎁 Annual saving (10%): −R ${annualDiscount.toLocaleString('en-ZA')}`,
    `✅ Annual NET: *R ${annualNet.toLocaleString('en-ZA')}*`,
    tier.perks ? `\n${tier.perks}` : null,
    ``,
    `Please confirm and I'll send the EFT details / card link to activate.`
  ].filter(Boolean);
  const waText = lines.join('\n');
  const waLink = `https://wa.me/27825172688?text=${encodeURIComponent(waText)}`;
  res.json({ ok:true, ref, ha, tier, monthly, annual, annualDiscount, annualNet, waLink, waText });
});

// ── PAYMENT PAGE ──
app.get('/pay', (req, res) => {
  res.sendFile(path.join(__dirname, 'pay.html'));
});

// ── PUBLIC INVITE LANDING (clean shareable page) ──
app.get('/invite', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Join YieldCore AI on WhatsApp</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
body{min-height:100vh;background:linear-gradient(135deg,#0a1410 0%,#1a2e1d 50%,#2d4a2f 100%);color:#e8f5e9;display:flex;align-items:center;justify-content:center;padding:20px}
.card{max-width:480px;background:rgba(8,18,12,.85);border:1px solid rgba(74,222,128,.4);border-radius:24px;padding:0 0 30px;backdrop-filter:blur(20px);box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden}
.banner{position:relative;width:100%;height:170px;overflow:hidden;border-bottom:1px solid rgba(74,222,128,.3)}
.banner img{width:100%;height:100%;object-fit:cover;display:block}
.banner::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 50%,rgba(8,18,12,.85) 100%)}
.body{padding:20px 28px 0}
.logo{font-size:48px;text-align:center;margin-bottom:8px;filter:drop-shadow(0 4px 12px rgba(74,222,128,.4))}
.brand{font-size:32px;font-weight:900;text-align:center;background:linear-gradient(135deg,#facc15,#4ade80,#22c55e);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-.02em;margin-bottom:6px}
.tag{text-align:center;font-size:12px;letter-spacing:3px;color:#d4e8d8;text-transform:uppercase;margin-bottom:24px;font-weight:700}
.pitch{text-align:center;font-size:15px;line-height:1.5;color:#d4e8d8;margin-bottom:24px;background:linear-gradient(135deg,rgba(34,197,94,.12),rgba(250,204,21,.08));border:1px solid rgba(74,222,128,.25);border-radius:14px;padding:14px}
.pitch b{color:#4ade80}
h2{font-size:14px;letter-spacing:2px;color:#facc15;margin:18px 0 10px;font-weight:800}
.step{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px;padding:12px;background:rgba(8,18,12,.55);border:1px solid rgba(74,222,128,.18);border-radius:12px}
.step-num{flex-shrink:0;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#4ade80,#22c55e);color:#000;font-weight:900;display:flex;align-items:center;justify-content:center;font-size:14px}
.step-text{font-size:13.5px;line-height:1.4;color:#e8f5e9}
.step-text b{color:#facc15}
.code{display:inline-block;background:#000;color:#4ade80;padding:2px 8px;border-radius:6px;font-family:'SF Mono',Menlo,monospace;font-size:13px;font-weight:700;border:1px solid rgba(74,222,128,.3)}
.cta{display:block;width:100%;padding:14px;background:linear-gradient(135deg,#22c55e,#4ade80);color:#000;font-weight:900;font-size:15px;text-align:center;border-radius:14px;margin-top:18px;text-decoration:none;letter-spacing:.5px;box-shadow:0 8px 24px rgba(74,222,128,.3)}
.cta-2{display:block;width:100%;padding:12px;background:rgba(8,18,12,.6);color:#d4e8d8;font-weight:700;font-size:13px;text-align:center;border-radius:12px;margin-top:10px;text-decoration:none;border:1px solid rgba(74,222,128,.25)}
.foot{text-align:center;font-size:11px;color:#7a9e82;margin-top:18px;letter-spacing:.5px}
</style></head><body><div class="card">
<div class="banner"><img src="/public/yieldcore-hero.png" alt="YieldCore AI"/></div>
<div class="body">
<div class="logo">🌿</div>
<div class="brand">YieldCore AI</div>
<div class="tag">Smart Farming · WhatsApp</div>
<div class="pitch">Get <b>live weather</b>, <b>irrigation plans</b>, <b>storm/frost alerts</b> & <b>crop tips</b> for your farm — straight on WhatsApp. <br><br><b>+18% yield · −32% water · +R3,200/ha profit</b></div>

<h2>📲 GET STARTED IN 30 SECONDS</h2>
<div class="step"><div class="step-num">1</div><div class="step-text">Save WhatsApp number <span class="code">${SANDBOX_NUMBER}</span> as <b>"YieldCore AI"</b> in your contacts</div></div>
<div class="step"><div class="step-num">2</div><div class="step-text">Open WhatsApp → message that contact → send <span class="code">join ${SANDBOX_CODE}</span></div></div>
<div class="step"><div class="step-num">3</div><div class="step-text">Reply <b>MENU</b> or share your 📍 <b>location pin</b> — bot replies with full live farm intelligence</div></div>

<a class="cta" href="https://wa.me/${SANDBOX_NUMBER.replace('+','')}?text=${encodeURIComponent('join '+SANDBOX_CODE)}">💬 Open WhatsApp & Join</a>
<a class="cta-2" href="${LIVE_URL}">🌐 See the Full Dashboard</a>
<div class="foot">Powered by satellites · drones · IoT · AI · solar 🛰️🚁☀️</div>
</div></div></body></html>`);
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`YieldCore AI server running on port ${PORT}`);
});
