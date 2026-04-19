const express = require('express');
const cors = require('cors');
const twilio = require('twilio');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

app.post('/api/whatsapp/alert', async (req, res) => {
  const { message, to } = req.body;
  const recipient = to || process.env.TWILIO_WHATSAPP_TO;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const msg = await client.messages.create({
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

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    twilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    from: process.env.TWILIO_WHATSAPP_FROM || null
  });
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`YieldCore AI server running on port ${PORT}`);
});
