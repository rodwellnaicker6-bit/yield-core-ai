const express = require('express');
const cors = require('cors');
const twilio = require('twilio');
const OpenAI = require('openai');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ── WHATSAPP ALERT ──
app.post('/api/whatsapp/alert', async (req, res) => {
  const { message, to } = req.body;
  const recipient = to || process.env.TWILIO_WHATSAPP_TO;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const msg = await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: recipient,
      body: message
    });
    res.json({ success: true, sid: msg.sid });
  } catch (err) {
    console.error('WhatsApp error:', err.message);
    res.status(500).json({ error: err.message });
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
    from: process.env.TWILIO_WHATSAPP_FROM || null
  });
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`YieldCore AI server running on port ${PORT}`);
});
