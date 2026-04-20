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
    return `🌿 *Welcome to YieldCore AI!*\n\nI'm your live farm intelligence bot. Try:\n\n📍 *Share a location* → I'll send weather, irrigation plan, alerts & crop tips for that spot\n\nOr reply with:\n• *WEATHER* — current conditions\n• *IRRIGATION* — today's watering plan\n• *ALERTS* — active farm warnings\n• *PRICE* — pricing tiers\n• *DRONE* — drone services\n• *DEMO* — book a free demo\n\n🚀 Powered by satellites, drones, IoT sensors & AI.`;
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
    return `🎯 *Book a free YieldCore demo*\n\n📞 Call/WhatsApp: 082 517 2688\n📧 hello@yieldcore.ai\n🌐 yieldcore.replit.app\n\nWe'll set up a 30-min onboarding for your farm. No card required.`;
  return `🤖 I didn't catch that. Reply *MENU* for options, or simply send a 📍 location pin to get live farm intelligence.`;
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

💬 *Or text me:* MENU · PRICE · DRONE · DEMO

Try it now → tap 📎 → Location → Send Current Location 📍` });
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
    mapboxToken: process.env.MAPBOX_TOKEN || null
  });
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`YieldCore AI server running on port ${PORT}`);
});
