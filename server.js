require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// ─── In-memory session store ───────────────────────────────────────────────
// For production, replace with Redis or a database
const sessions = new Map();

// ─── Twilio (optional) ─────────────────────────────────────────────────────
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  console.log('✓ Twilio SMS enabled');
} else {
  console.log('ℹ Twilio not configured — SMS disabled');
}

const CUSTOMER_PAGE_URL = process.env.CUSTOMER_PAGE_URL || 'http://localhost:3000/cam';
const PORT = process.env.PORT || 3001;

// ─── Serve customer page ────────────────────────────────────────────────────
const path = require('path');
app.use('/cam', express.static(path.join(__dirname, '../customer-page')));

// Inject backend URL into customer page dynamically
app.get('/cam/:sessionId', (req, res) => {
  const fs = require('fs');
  let html = fs.readFileSync(path.join(__dirname, '../customer-page/index.html'), 'utf8');
  // Inject the backend URL and session context
  html = html.replace(
    "window.BACKEND_URL || ''",
    `'${process.env.PUBLIC_BACKEND_URL || ''}'`
  );
  res.send(html);
});

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

// ─── Create session ─────────────────────────────────────────────────────────
// POST /sessions
// Body: { ticket_id, daily_api_key (optional, passed from ZAF) }
app.post('/sessions', (req, res) => {
  const { ticket_id } = req.body;

  if (!ticket_id) {
    return res.status(400).json({ error: 'ticket_id required' });
  }

  const session_id = `cam-${ticket_id}-${uuidv4().slice(0, 6)}`;

  sessions.set(session_id, {
    id: session_id,
    ticket_id,
    created_at: Date.now(),
    status: 'waiting',       // waiting → connected → ended
    offer: null,
    answer: null,
    customer_ice: [],
    agent_ice: [],
  });

  const customer_url = `${CUSTOMER_PAGE_URL}/${session_id}?ticket=${ticket_id}`;

  // Auto-cleanup after 30 minutes
  setTimeout(() => sessions.delete(session_id), 30 * 60 * 1000);

  res.json({ session_id, customer_url });
});

// ─── Customer posts WebRTC offer ────────────────────────────────────────────
// POST /sessions/:id/offer
app.post('/sessions/:id/offer', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  session.offer = req.body.offer;
  session.customer_ice = req.body.candidates || [];
  session.status = 'offer_received';

  res.json({ ok: true });
});

// ─── Agent polls for offer ──────────────────────────────────────────────────
// GET /sessions/:id/offer
app.get('/sessions/:id/offer', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.offer) {
    res.json({ offer: session.offer });
  } else {
    res.json({ offer: null });
  }
});

// ─── Agent posts WebRTC answer ──────────────────────────────────────────────
// POST /sessions/:id/answer
app.post('/sessions/:id/answer', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  session.answer = req.body.answer;
  session.status = 'connected';

  res.json({ ok: true });
});

// ─── Customer polls for answer ──────────────────────────────────────────────
// GET /sessions/:id/answer
app.get('/sessions/:id/answer', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({ answer: session.answer || null });
});

// ─── Agent posts ICE candidates ─────────────────────────────────────────────
// POST /sessions/:id/agent-ice
app.post('/sessions/:id/agent-ice', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  session.agent_ice.push(req.body.candidate);
  res.json({ ok: true });
});

// ─── Customer polls for agent ICE ───────────────────────────────────────────
// GET /sessions/:id/agent-ice
app.get('/sessions/:id/agent-ice', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.agent_ice.length > 0) {
    const candidates = [...session.agent_ice];
    res.json({ candidates });
  } else {
    res.json({ candidates: [] });
  }
});

// ─── Agent polls for customer ICE ───────────────────────────────────────────
// GET /sessions/:id/customer-ice
app.get('/sessions/:id/customer-ice', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.customer_ice.length > 0) {
    res.json({ candidates: session.customer_ice });
  } else {
    res.json({ candidates: [] });
  }
});

// ─── End session ─────────────────────────────────────────────────────────────
// POST /sessions/:id/end
app.post('/sessions/:id/end', (req, res) => {
  sessions.delete(req.params.id);
  res.json({ ok: true });
});

// ─── Send SMS via Twilio ─────────────────────────────────────────────────────
// POST /sms
// Body: { to, url, ticket_id }
app.post('/sms', async (req, res) => {
  const { to, url, ticket_id } = req.body;

  if (!to || !url) {
    return res.status(400).json({ error: 'to and url required' });
  }

  if (!twilioClient) {
    return res.status(503).json({ error: 'SMS not configured on server' });
  }

  try {
    const message = await twilioClient.messages.create({
      body: `Your support agent wants to see your issue directly. Open this link on your phone and share your camera (no app needed): ${url}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to,
    });

    console.log(`SMS sent to ${to} — SID: ${message.sid} — ticket #${ticket_id}`);
    res.json({ ok: true, sid: message.sid });

  } catch (err) {
    console.error('Twilio error:', err.message);
    res.status(500).json({ error: 'SMS failed: ' + err.message });
  }
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✓ Video Support Backend running on port ${PORT}`);
  console.log(`  Customer page: ${CUSTOMER_PAGE_URL}`);
  console.log(`  Sessions API:  http://localhost:${PORT}/sessions\n`);
});
