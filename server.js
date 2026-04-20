const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const twilio = require('twilio');
const OpenAI = require('openai');
const path = require('path');

const app = express();
app.set('trust proxy', 1);

// ── 🔒 SECURITY HEADERS ──
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'","'unsafe-inline'","https://api.mapbox.com","https://cdn.jsdelivr.net"],
      styleSrc:  ["'self'","'unsafe-inline'","https://fonts.googleapis.com","https://api.mapbox.com"],
      fontSrc:   ["'self'","https://fonts.gstatic.com","data:"],
      imgSrc:    ["'self'","data:","blob:","https:"],
      connectSrc:["'self'","https://api.mapbox.com","https://events.mapbox.com","https://api.open-meteo.com"],
      workerSrc: ["'self'","blob:"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// block AI/scraper bots & bad actors at the edge
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noai, noimageai, noindex, nofollow');
  res.setHeader('Permissions-Policy', 'interest-cohort=()');
  const ua = (req.headers['user-agent']||'').toLowerCase();
  if (/(gptbot|chatgpt-user|claudebot|claude-web|anthropic-ai|google-extended|cohere-ai|ccbot|bytespider|perplexitybot|ai2bot|amazonbot|diffbot|omgilibot|imagesiftbot|peer39_crawler|youbot|magpie-crawler)/.test(ua)) {
    return res.status(403).send('Disallowed for AI training/scraping. See /robots.txt');
  }
  next();
});

// ── 🌐 CORS — same-origin only (allow Twilio webhook + dev) ──
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server, curl, mobile WAs
    const allowed = [
      process.env.LIVE_URL,
      'https://yield-core-ai.replit.app',
      /\.replit\.dev$/,
      /\.repl\.co$/,
      /\.replit\.app$/
    ].filter(Boolean);
    const ok = allowed.some(a => a instanceof RegExp ? a.test(origin) : a === origin);
    cb(ok ? null : new Error('CORS blocked'), ok);
  },
  credentials: false
}));

app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(express.static(path.join(__dirname), { maxAge: '1h', etag: true }));

// robots.txt — block AI training & scrapers
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
`User-agent: GPTBot
Disallow: /
User-agent: ChatGPT-User
Disallow: /
User-agent: ClaudeBot
Disallow: /
User-agent: anthropic-ai
Disallow: /
User-agent: Claude-Web
Disallow: /
User-agent: Google-Extended
Disallow: /
User-agent: CCBot
Disallow: /
User-agent: PerplexityBot
Disallow: /
User-agent: cohere-ai
Disallow: /
User-agent: Bytespider
Disallow: /
User-agent: Amazonbot
Disallow: /
User-agent: *
Disallow: /api/
`);
});

// ── 🚦 RATE LIMITS ──
const apiLimiter   = rateLimit({ windowMs: 60_000, max: 60,  standardHeaders:true, legacyHeaders:false, message:{error:'Too many requests'} });
const writeLimiter = rateLimit({ windowMs: 60_000, max: 12,  standardHeaders:true, legacyHeaders:false, message:{error:'Too many requests'} });
const aiLimiter    = rateLimit({ windowMs: 60_000, max: 8,   standardHeaders:true, legacyHeaders:false, message:{error:'AI rate limit'} });
app.use('/api/', apiLimiter);

// ── 🔑 ADMIN GUARD: requires ADMIN_TOKEN header for internal-only endpoints ──
function requireAdmin(req, res, next) {
  const tok = req.get('X-Admin-Token') || req.query.t;
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return res.status(503).json({ error: 'Admin endpoint disabled (no ADMIN_TOKEN set)' });
  if (!tok || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── 🛡️ TWILIO SIGNATURE VALIDATION ──
function validateTwilio(req, res, next) {
  const sig = req.get('X-Twilio-Signature');
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sig || !token) return res.status(403).type('text/xml').send('<Response/>');
  // Build the URL Twilio used to sign: prefer LIVE_URL host
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host  = req.get('x-forwarded-host')  || req.get('host');
  const url = `${proto}://${host}${req.originalUrl}`;
  const ok = twilio.validateRequest(token, sig, url, req.body || {});
  if (!ok) {
    console.warn('🚫 Invalid Twilio signature from', req.ip);
    return res.status(403).type('text/xml').send('<Response/>');
  }
  next();
}

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ── 🌾 FARMER DATABASE (JSON store, atomic writes) ──
const fs = require('fs');
const DB_PATH = path.join(__dirname, 'data', 'farmers.json');
function dbRead(){ try { return JSON.parse(fs.readFileSync(DB_PATH,'utf8')); } catch { return []; } }
function dbWrite(rows){
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, DB_PATH);
}
function pingOwner(text){
  try {
    const fromRaw = process.env.TWILIO_WHATSAPP_FROM || '+14155238886';
    const from = fromRaw.startsWith('whatsapp:') ? fromRaw : `whatsapp:${fromRaw}`;
    return twilioClient.messages.create({ from, to: 'whatsapp:+27825172688', body: text });
  } catch(e){ console.error('owner ping failed:', e.message); }
}

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ── WHATSAPP ALERT (rate-limited; recipient is HARD-LOCKED to owner) ──
app.post('/api/whatsapp/alert', writeLimiter, async (req, res) => {
  const { message } = req.body || {};
  // 🔒 recipient is server-controlled — request body cannot redirect messages
  const recipient = 'whatsapp:+27825172688';
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });
  if (message.length > 1500) return res.status(413).json({ error: 'message too long' });
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
app.post('/api/whatsapp/inbound', validateTwilio, async (req, res) => {
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
app.post('/api/whatsapp/activate', writeLimiter, requireAdmin, async (req, res) => {
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
app.post('/api/whatsapp/briefing', writeLimiter, requireAdmin, async (req, res) => {
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
app.post('/api/ai', aiLimiter, async (req, res) => {
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
<div class="banner"><img src="/public/yieldcore-hero.jpg" alt="YieldCore AI"/></div>
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

// ── 🌾 REGISTER NEW FARMER (public, rate-limited) ──
app.post('/api/register', writeLimiter, async (req, res) => {
  const b = req.body || {};
  const clean = s => (s||'').toString().trim().slice(0,120);
  const cleanWA = s => {
    let t = (s||'').toString().replace(/[^\d+]/g,'');
    if (t && !t.startsWith('+')) {
      if (t.startsWith('0')) t = '+27' + t.slice(1);
      else if (t.startsWith('27')) t = '+' + t;
      else t = '+' + t;
    }
    return t.slice(0,16);
  };
  const row = {
    id: 'F-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,5).toUpperCase(),
    name: clean(b.name),
    farm: clean(b.farm),
    whatsapp: cleanWA(b.whatsapp),
    email: clean(b.email),
    crop: clean(b.crop),
    hectares: Math.max(0, parseInt(b.hectares)||0),
    lat: b.lat ? Number(b.lat) : null,
    lng: b.lng ? Number(b.lng) : null,
    locLabel: clean(b.locLabel),
    note: clean(b.note),
    referrer: clean(b.referrer),
    ip: (req.ip||'').slice(0,45),
    ua: (req.get('user-agent')||'').slice(0,160),
    createdAt: new Date().toISOString()
  };
  if (!row.name || !row.whatsapp) return res.status(400).json({ ok:false, error:'Name and WhatsApp number are required.' });
  if (!/^\+\d{8,15}$/.test(row.whatsapp)) return res.status(400).json({ ok:false, error:'Please enter a valid WhatsApp number with country code.' });

  const rows = dbRead();
  // dedupe by whatsapp — update existing
  const existing = rows.findIndex(r => r.whatsapp === row.whatsapp);
  if (existing >= 0) { rows[existing] = { ...rows[existing], ...row, id: rows[existing].id, createdAt: rows[existing].createdAt, updatedAt: new Date().toISOString() }; }
  else rows.push(row);
  dbWrite(rows);

  // ping owner via WhatsApp
  const locTxt = row.lat && row.lng ? `📍 ${row.lat.toFixed(4)}, ${row.lng.toFixed(4)}${row.locLabel?' · '+row.locLabel:''}\n🗺️ https://maps.google.com/?q=${row.lat},${row.lng}` : (row.locLabel || 'Location not shared');
  pingOwner(
`🌱 *NEW FARMER SIGN-UP* — YieldCore AI

👤 ${row.name}
🚜 ${row.farm || '—'}
📞 ${row.whatsapp}
✉️ ${row.email || '—'}
🌾 ${row.crop || '—'} · ${row.hectares} ha
${locTxt}
${row.referrer ? '\n🔗 Via: '+row.referrer : ''}
${row.note ? '\n📝 '+row.note : ''}

ID: ${row.id}
View all: ${LIVE_URL}/farmers`
  );

  // welcome the farmer back if Twilio sandbox is reachable (best effort)
  try {
    const fromRaw = process.env.TWILIO_WHATSAPP_FROM || '+14155238886';
    const from = fromRaw.startsWith('whatsapp:') ? fromRaw : `whatsapp:${fromRaw}`;
    await twilioClient.messages.create({ from, to: 'whatsapp:'+row.whatsapp, body:
`🌿 Welcome to *YieldCore AI*, ${row.name.split(' ')[0]}!

You're registered ✅
Farm: ${row.farm||'—'} · ${row.hectares} ha

To activate live alerts on this number, message the bot:
1) Save *${SANDBOX_NUMBER}* as "YieldCore AI"
2) Send: *join ${SANDBOX_CODE}*
3) Reply *MENU* — or share your 📍 location pin

🌐 Your dashboard: ${LIVE_URL}` });
  } catch(e){ /* user may not have joined sandbox yet — ignored */ }

  res.json({ ok:true, id: row.id, message: 'Welcome to YieldCore AI! Check your WhatsApp.' });
});

// ── 👀 OWNER-ONLY: list all registered farmers ──
app.get('/api/farmers', requireAdmin, (req, res) => {
  res.json({ ok:true, count: dbRead().length, farmers: dbRead() });
});

// ── 📝 PUBLIC REGISTRATION PAGE ──
app.get('/register', (req, res) => {
  const ref = (req.query.ref||'').toString().slice(0,40).replace(/[^a-zA-Z0-9_-]/g,'');
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Register — YieldCore AI</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Sora',-apple-system,sans-serif}
body{min-height:100vh;background:#020804 url('/public/yieldcore-hero.jpg') center/cover fixed no-repeat;color:#e8f5e9;display:flex;align-items:flex-start;justify-content:center;padding:24px 16px}
body::before{content:'';position:fixed;inset:0;background:linear-gradient(180deg,rgba(2,8,4,.55) 0%,rgba(2,8,4,.85) 100%);z-index:0}
.wrap{position:relative;z-index:1;max-width:520px;width:100%}
.card{background:rgba(8,18,12,.88);border:1px solid rgba(74,222,128,.45);border-radius:22px;padding:0 0 26px;backdrop-filter:blur(22px);box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden}
.banner{position:relative;height:140px;overflow:hidden;border-bottom:1px solid rgba(74,222,128,.3)}
.banner img{width:100%;height:100%;object-fit:cover}
.banner::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 30%,rgba(8,18,12,.95) 100%)}
.banner .title{position:absolute;left:0;right:0;bottom:14px;text-align:center;font-size:26px;font-weight:900;background:linear-gradient(135deg,#facc15,#4ade80,#22c55e);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-.02em}
.banner .sub{position:absolute;left:0;right:0;bottom:0;text-align:center;font-size:10px;letter-spacing:3px;color:#d4e8d8;text-transform:uppercase;font-weight:800;padding-bottom:4px}
.body{padding:18px 22px 0}
.intro{text-align:center;font-size:13.5px;line-height:1.5;color:#d4e8d8;margin-bottom:18px;background:linear-gradient(135deg,rgba(34,197,94,.12),rgba(250,204,21,.08));border:1px solid rgba(74,222,128,.25);border-radius:12px;padding:12px}
.intro b{color:#4ade80}
form{display:flex;flex-direction:column;gap:10px}
label{font-size:10px;letter-spacing:2px;color:#facc15;font-weight:800;text-transform:uppercase;margin-bottom:-4px}
input,select,textarea{background:rgba(0,0,0,.55);border:1px solid rgba(74,222,128,.3);border-radius:10px;padding:11px 12px;color:#e8f5e9;font-size:14px;font-family:inherit;outline:none;transition:border-color .2s,box-shadow .2s}
input:focus,select:focus,textarea:focus{border-color:#4ade80;box-shadow:0 0 0 3px rgba(74,222,128,.15)}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.geo{display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.45);border:1px dashed rgba(74,222,128,.4);border-radius:10px;padding:10px 12px;font-size:12px;color:#d4e8d8}
.geo .dot{width:8px;height:8px;border-radius:50%;background:#facc15;box-shadow:0 0 10px #facc15}
.geo.ok .dot{background:#4ade80;box-shadow:0 0 10px #4ade80}
.geo button{margin-left:auto;background:linear-gradient(135deg,#4ade80,#22c55e);color:#000;border:none;padding:7px 12px;border-radius:8px;font-weight:800;font-size:11px;cursor:pointer;letter-spacing:.5px}
.cta{margin-top:6px;padding:14px;background:linear-gradient(135deg,#22c55e,#4ade80);color:#000;font-weight:900;font-size:15px;border:none;border-radius:12px;cursor:pointer;letter-spacing:.5px;box-shadow:0 8px 24px rgba(74,222,128,.35);transition:transform .15s}
.cta:hover{transform:translateY(-1px)}
.cta:disabled{opacity:.6;cursor:wait}
.foot{text-align:center;font-size:10px;color:#7a9e82;margin-top:14px;letter-spacing:1px;text-transform:uppercase}
.msg{margin-top:10px;padding:12px;border-radius:10px;font-size:13px;display:none}
.msg.err{display:block;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);color:#fca5a5}
.msg.ok{display:block;background:rgba(74,222,128,.15);border:1px solid rgba(74,222,128,.4);color:#86efac}
.success{text-align:center;padding:24px}
.success .check{font-size:60px;margin-bottom:10px;filter:drop-shadow(0 0 20px #4ade80)}
.success h2{color:#4ade80;font-size:20px;margin-bottom:8px}
.success p{color:#d4e8d8;font-size:13.5px;line-height:1.5;margin-bottom:18px}
.success a{display:block;padding:13px;background:linear-gradient(135deg,#22c55e,#4ade80);color:#000;font-weight:900;border-radius:12px;text-decoration:none;margin-bottom:8px}
.success a.alt{background:rgba(8,18,12,.6);color:#d4e8d8;border:1px solid rgba(74,222,128,.3)}
</style></head><body><div class="wrap"><div class="card">
<div class="banner"><img src="/public/yieldcore-hero.jpg" alt=""><div class="title">YieldCore AI</div><div class="sub">Register Your Farm</div></div>
<div class="body" id="formBody">
<div class="intro">Add your details and we'll <b>load your farm into the network</b>. Get <b>live weather, irrigation plans, frost/storm alerts</b> & <b>crop tips</b> on WhatsApp — tied to your exact GPS location. <br><br><b>+18% yield · −32% water</b></div>
<form id="regForm">
  <label>Your Full Name *</label>
  <input name="name" required maxlength="80" placeholder="e.g. Thandi Mokoena" autocomplete="name"/>
  <label>Farm Name</label>
  <input name="farm" maxlength="80" placeholder="e.g. Sunrise Maize Farm"/>
  <div class="row">
    <div><label>WhatsApp Number *</label><input name="whatsapp" required maxlength="16" placeholder="082 517 2688" inputmode="tel" autocomplete="tel"/></div>
    <div><label>Email</label><input name="email" type="email" maxlength="120" placeholder="you@farm.co.za" autocomplete="email"/></div>
  </div>
  <div class="row">
    <div><label>Main Crop</label>
      <select name="crop"><option value="">— pick one —</option><option>Maize</option><option>Wheat</option><option>Soybeans</option><option>Sunflower</option><option>Sugarcane</option><option>Citrus</option><option>Grapes / Wine</option><option>Apples</option><option>Avocados</option><option>Macadamia</option><option>Vegetables</option><option>Cattle / Livestock</option><option>Poultry</option><option>Mixed</option><option>Other</option></select>
    </div>
    <div><label>Hectares</label><input name="hectares" type="number" min="0" max="100000" placeholder="120"/></div>
  </div>
  <label>Farm Location (GPS)</label>
  <div class="geo" id="geo"><span class="dot"></span><span id="geoLbl">Tap "Use my location" to pin your farm</span><button type="button" id="geoBtn">📍 Use my location</button></div>
  <input type="hidden" name="lat" id="lat"><input type="hidden" name="lng" id="lng"><input type="hidden" name="locLabel" id="locLabel">
  <label>Note (optional)</label>
  <textarea name="note" maxlength="400" rows="2" placeholder="Anything we should know? Soil, irrigation, problems…"></textarea>
  <input type="hidden" name="referrer" value="${ref}">
  <button type="submit" class="cta" id="submitBtn">🌿 Register My Farm</button>
  <div class="msg" id="msg"></div>
</form>
<div class="foot">🔒 Private · Secure · Your data stays with us</div>
</div>
</div></div>
<script>
const geoBtn=document.getElementById('geoBtn'),geoLbl=document.getElementById('geoLbl'),geoBox=document.getElementById('geo');
geoBtn.onclick=()=>{
  if(!navigator.geolocation){geoLbl.textContent='Geolocation not supported on this device';return;}
  geoLbl.textContent='Locating…';
  navigator.geolocation.getCurrentPosition(p=>{
    document.getElementById('lat').value=p.coords.latitude;
    document.getElementById('lng').value=p.coords.longitude;
    document.getElementById('locLabel').value='Auto-pinned';
    geoLbl.innerHTML='✅ Pinned: <b>'+p.coords.latitude.toFixed(4)+', '+p.coords.longitude.toFixed(4)+'</b>';
    geoBox.classList.add('ok');geoBtn.textContent='✓ Pinned';
  },e=>{geoLbl.textContent='Location denied — you can still register without it';},{enableHighAccuracy:true,timeout:10000});
};
const form=document.getElementById('regForm'),msg=document.getElementById('msg'),btn=document.getElementById('submitBtn');
form.addEventListener('submit',async e=>{
  e.preventDefault();
  btn.disabled=true;btn.textContent='Registering…';msg.className='msg';msg.textContent='';
  const data=Object.fromEntries(new FormData(form));
  try{
    const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const j=await r.json();
    if(!j.ok){msg.className='msg err';msg.textContent=j.error||'Registration failed';btn.disabled=false;btn.textContent='🌿 Register My Farm';return;}
    document.getElementById('formBody').innerHTML='<div class="success"><div class="check">✅</div><h2>You\\'re in, '+(data.name.split(' ')[0])+'!</h2><p>Your farm is now in the YieldCore AI network. We just sent a welcome message to your WhatsApp with the next step to activate live alerts.</p><a href="https://wa.me/${SANDBOX_NUMBER.replace('+','')}?text=${encodeURIComponent('join '+SANDBOX_CODE)}">💬 Open WhatsApp & Activate Alerts</a><a href="${LIVE_URL}" class="alt">🌐 See the Dashboard</a><div class="foot" style="margin-top:14px">Farm ID: '+j.id+'</div></div>';
  }catch(err){msg.className='msg err';msg.textContent='Network error — please try again';btn.disabled=false;btn.textContent='🌿 Register My Farm';}
});
</script>
</body></html>`);
});

// ── 👨‍🌾 OWNER VIEW: live farmer dashboard (gated by ?t=ADMIN_TOKEN) ──
app.get('/farmers', requireAdmin, (req, res) => {
  const rows = dbRead().sort((a,b)=> (b.createdAt||'').localeCompare(a.createdAt||''));
  const t = (req.query.t||'').toString();
  const escape = s => (s||'').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cards = rows.map(r => `
    <div class="frow">
      <div class="fmain">
        <div class="fname">${escape(r.name)} ${r.farm?'· <span class="ffarm">'+escape(r.farm)+'</span>':''}</div>
        <div class="fmeta">
          <span>🌾 ${escape(r.crop)||'—'}</span>
          <span>📐 ${r.hectares||0} ha</span>
          <span>📞 <a href="https://wa.me/${(r.whatsapp||'').replace('+','')}">${escape(r.whatsapp)}</a></span>
          ${r.email?'<span>✉️ '+escape(r.email)+'</span>':''}
          ${r.lat&&r.lng?'<span>📍 <a target="_blank" href="https://maps.google.com/?q='+r.lat+','+r.lng+'">'+r.lat.toFixed(3)+', '+r.lng.toFixed(3)+'</a></span>':'<span class="muted">no GPS</span>'}
          ${r.referrer?'<span>🔗 '+escape(r.referrer)+'</span>':''}
        </div>
        ${r.note?'<div class="fnote">📝 '+escape(r.note)+'</div>':''}
      </div>
      <div class="fside">
        <div class="fdate">${new Date(r.createdAt).toLocaleString('en-ZA')}</div>
        <div class="fid">${escape(r.id)}</div>
      </div>
    </div>`).join('');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Farmer Network — YieldCore AI</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
body{background:#0a1410;color:#e8f5e9;min-height:100vh;padding:20px}
.head{display:flex;align-items:center;gap:14px;margin-bottom:24px;padding-bottom:18px;border-bottom:1px solid rgba(74,222,128,.2)}
.head .h1{font-size:26px;font-weight:900;background:linear-gradient(135deg,#facc15,#4ade80,#22c55e);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.head .pill{margin-left:auto;background:rgba(74,222,128,.15);border:1px solid rgba(74,222,128,.4);color:#4ade80;padding:6px 14px;border-radius:99px;font-weight:800;font-size:13px}
.frow{display:flex;gap:14px;background:rgba(8,18,12,.7);border:1px solid rgba(74,222,128,.18);border-radius:14px;padding:14px 16px;margin-bottom:10px}
.fmain{flex:1;min-width:0}
.fname{font-size:16px;font-weight:800;color:#e8f5e9;margin-bottom:6px}
.ffarm{color:#facc15;font-weight:700}
.fmeta{display:flex;flex-wrap:wrap;gap:14px;font-size:12.5px;color:#d4e8d8}
.fmeta a{color:#4ade80;text-decoration:none}
.fmeta .muted{color:#7a9e82}
.fnote{margin-top:8px;padding:8px 10px;background:rgba(0,0,0,.3);border-left:2px solid #facc15;border-radius:6px;font-size:12.5px;color:#d4e8d8}
.fside{text-align:right;font-size:11px;color:#7a9e82;flex-shrink:0}
.fid{font-family:monospace;color:#4ade80;margin-top:4px;font-size:10px}
.empty{text-align:center;padding:60px 20px;color:#7a9e82}
.empty h2{color:#d4e8d8;margin-bottom:10px}
.share{margin-top:30px;padding:18px;background:rgba(8,18,12,.7);border:1px solid rgba(74,222,128,.25);border-radius:14px}
.share h3{color:#facc15;margin-bottom:10px;font-size:14px;letter-spacing:1px}
.share input{width:100%;padding:10px 12px;background:#000;border:1px solid rgba(74,222,128,.3);border-radius:8px;color:#4ade80;font-family:monospace;font-size:13px}
</style></head><body>
<div class="head"><div class="h1">🌾 Farmer Network</div><div class="pill">${rows.length} registered</div></div>
${rows.length ? cards : '<div class="empty"><h2>No farmers yet</h2><p>Share your registration link below — every signup will appear here in real-time.</p></div>'}
<div class="share"><h3>📤 YOUR SHAREABLE REGISTRATION LINK</h3>
<input readonly value="${LIVE_URL}/register?ref=rodwell" onclick="this.select()"/></div>
</body></html>`);
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`YieldCore AI server running on port ${PORT}`);
  console.log(`📝 Registration: ${LIVE_URL}/register`);
  console.log(`👨‍🌾 Owner view:   ${LIVE_URL}/farmers?t=YOUR_ADMIN_TOKEN`);
});
