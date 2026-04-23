require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const sessions = new Map();

let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  console.log('Twilio SMS enabled');
} else {
  console.log('Twilio not configured');
}

const CUSTOMER_PAGE_URL = process.env.CUSTOMER_PAGE_URL || 'http://localhost:3001/cam';
const PORT = parseInt(process.env.PORT, 10) || 3001;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

app.post('/sessions', (req, res) => {
  const ticket_id = req.body.ticket_id;
  if (!ticket_id) {
    return res.status(400).json({ error: 'ticket_id required' });
  }
  const session_id = 'cam-' + ticket_id + '-' + uuidv4().slice(0, 6);
  sessions.set(session_id, {
    id: session_id,
    ticket_id: ticket_id,
    created_at: Date.now(),
    status: 'waiting',
    offer: null,
    answer: null,
    customer_ice: [],
    agent_ice: []
  });
  const customer_url = CUSTOMER_PAGE_URL + '/' + session_id + '?ticket=' + ticket_id;
  setTimeout(function() { sessions.delete(session_id); }, 30 * 60 * 1000);
  res.json({ session_id: session_id, customer_url: customer_url });
});

app.post('/sessions/:id/offer', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.offer = req.body.offer;
  session.customer_ice = req.body.candidates || [];
  session.status = 'offer_received';
  res.json({ ok: true });
});

app.get('/sessions/:id/offer', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ offer: session.offer || null });
});

app.post('/sessions/:id/answer', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.answer = req.body.answer;
  session.status = 'connected';
  res.json({ ok: true });
});

app.get('/sessions/:id/answer', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ answer: session.answer || null });
});

app.post('/sessions/:id/agent-ice', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.agent_ice.push(req.body.candidate);
  res.json({ ok: true });
});

app.get('/sessions/:id/agent-ice', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ candidates: session.agent_ice });
});

app.get('/sessions/:id/customer-ice', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ candidates: session.customer_ice });
});

app.post('/sessions/:id/end', (req, res) => {
  sessions.delete(req.params.id);
  res.json({ ok: true });
});

app.post('/sms', async (req, res) => {
  const to = req.body.to;
  const url = req.body.url;
  const ticket_id = req.body.ticket_id;
  if (!to || !url) {
    return res.status(400).json({ error: 'to and url required' });
  }
  if (!twilioClient) {
    return res.status(503).json({ error: 'SMS not configured' });
  }
  try {
    const message = await twilioClient.messages.create({
      body: 'Votre agent support souhaite voir le probleme en direct. Ouvrez ce lien sur votre telephone et partagez votre camera (aucune appli a installer) : ' + url,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to
    });
    console.log('SMS sent to ' + to + ' ticket ' + ticket_id);
    res.json({ ok: true, sid: message.sid });
  } catch (err) {
    console.error('Twilio error: ' + err.message);
    res.status(500).json({ error: 'SMS failed: ' + err.message });
  }
});

app.use('/cam', express.static(path.join(__dirname, 'customer-page')));

app.get('/cam/:sessionId', (req, res) => {
  const filePath = path.join(__dirname, 'customer-page', 'index.html');
  let html = fs.readFileSync(filePath, 'utf8');
  html = html.replace("window.BACKEND_URL || ''", "'" + (process.env.PUBLIC_BACKEND_URL || '') + "'");
  res.send(html);
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('Server running on port ' + PORT);
});
