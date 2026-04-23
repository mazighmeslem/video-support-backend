require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const sessions = new Map();

let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  console.log('✓ Twilio SMS enabled');
} else {
  console.log('ℹ Twilio not configured — SMS disabled');
}

const CUSTOMER_PAGE_URL = process.env.CUSTOMER_PAGE_URL || 'http://localhost:3000/cam';
const PORT = parseInt(process.env.PORT, 10) || 3001;

const path = require('path');
app.use('/cam', express.static(path.join(__dirname, '../customer-page')));

app.get('/cam/:sessionId', (req, res) => {
  const fs = require('fs');
  let html = fs.readFileSync(path.join(__dirname, '../customer-page/index.html'), 'utf8');
  html = html.replace(
    "window.BACKEND_URL || ''",
    `'${process.env.PUBLIC_BACKEND_URL || ''}'`
  );
  res.send(html);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

app.post('/sessions', (req, res) => {
  const { ticket_id } = req.body;
  if (!ticket_id) return res.status(400).json({ error: 'ticket_id required' });

  const session_id = `cam-${ticket_id}-${uuidv4().slice(0, 6)}`;
  sessions.set(session_id, {
    id: session_id, ticket_id,
    created_at: Date.now(),
    status: 'waiting',
    offer: null, answer: null,
    customer_ice: [], agent_ice: [],
  });

  const customer_url = `${CUSTOMER_PAGE_URL}/${session_id}?ticket=${ticket_id}`;
  setTimeout(() => sessions.delete(session_id), 30 * 60 * 1000);
  res.json({ session_id, customer_url });
});

app.post('/sessions/:id/offer', (req, res) => {
  const session = sessions.get(req.pa
