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
  console.log('Twilio SMS enabled');
} else {
  console.log('Twilio not configured');
}

const BACKEND_URL = process.env.PUBLIC_BACKEND_URL || '';
const CUSTOMER_PAGE_URL = process.env.CUSTOMER_PAGE_URL || (BACKEND_URL + '/cam');
const PORT = parseInt(process.env.PORT, 10) || 3001;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

app.get('/cam/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const ticketId = req.query.ticket || '';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no"/>
<title>Share your camera - Support</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--blue:#1f73b7;--blue-dark:#1a62a0;--green:#186146;--green-bg:#edf8f4;--red:#cc3340;--red-bg:#fde8e8;--gray:#68737d;--text:#2f3941;--border:#d8dcde;--bg:#f3f4f6}
html,body{height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);display:flex;flex-direction:column;align-items:center;min-height:100%}
header{width:100%;background:#fff;border-bottom:1px solid var(--border);padding:14px 20px;display:flex;align-items:center;gap:10px}
.logo{font-size:16px;font-weight:700;color:var(--blue)}
.logo span{color:var(--text);font-weight:400}
.ticket-ref{margin-left:auto;font-size:12px;color:var(--gray);background:var(--bg);padding:4px 10px;border-radius:99px;border:1px solid var(--border)}
main{width:100%;max-width:480px;padding:24px 16px 40px;flex:1;display:flex;flex-direction:column;gap:16px}
.card{background:#fff;border-radius:12px;border:1px solid var(--border);overflow:hidden}
.card-body{padding:18px}
h2{font-size:17px;font-weight:600;color:var(--text);margin-bottom:6px}
p{font-size:14px;color:var(--gray);line-height:1.55}
.video-wrap{width:100%;aspect-ratio:4/3;background:#07111f;position:relative;overflow:hidden}
.video-wrap video{width:100%;height:100%;object-fit:cover;display:none}
.placeholder{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:rgba(255,255,255,0.3)}
.placeholder svg{opacity:0.25}
.placeholder p{font-size:13px}
.live-pill{position:absolute;top:10px;left:10px;background:var(--red);color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px;letter-spacing:0.06em;display:none;align-items:center;gap:5px}
.live-dot{width:6px;height:6px;background:#fff;border-radius:50%;animation:blink 1.1s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.25}}
.status-bar{border-radius:8px;padding:10px 14px;font-size:13px;display:none}
.status-bar.info{background:#e5f0fb;color:var(--blue);display:block}
.status-bar.success{background:var(--green-bg);color:var(--green);display:block}
.status-bar.error{background:var(--red-bg);color:var(--red);display:block}
.btn{display:block;width:100%;padding:14px;border-radius:8px;font-size:15px;font-weight:600;text-align:center;cursor:pointer;border:none;transition:opacity 0.15s}
.btn:disabled{opacity:0.45;cursor:not-allowed}
.btn-primary{background:var(--blue);color:#fff}
.btn-primary:hover:not(:disabled){background:var(--blue-dark)}
.btn-stop{background:var(--red-bg);color:var(--red);border:1px solid #f5c4c4;display:none}
.privacy-note{font-size:12px;color:var(--gray);text-align:center;line-height:1.5;padding:0 8px}
.steps{display:flex;flex-direction:column;gap:10px}
.step{display:flex;align-items:flex-start;gap:12px}
.step-num{width:26px;height:26px;border-radius:50%;background:var(--blue);color:#fff;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.step-text{font-size:14px;color:var(--text);line-height:1.5}
.step-text span{color:var(--gray);font-size:12px;display:block}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.4);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
footer{padding:20px;font-size:12px;color:var(--gray);text-align:center}
</style>
</head>
<body>
<header>
  <div class="logo">Support <span>Video</span></div>
  <div class="ticket-ref" id="ticket-ref">Ticket #${ticketId || 'Support'}</div>
</header>
<main>
  <div class="card">
    <div class="video-wrap" id="video-wrap">
      <video id="customer-video" autoplay muted playsinline></video>
      <div class="live-pill" id="live-pill"><div class="live-dot"></div> LIVE</div>
      <div class="placeholder" id="placeholder">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/></svg>
        <p>Camera preview</p>
      </div>
    </div>
    <div class="card-body">
      <div id="status-bar" class="status-bar info">Your support agent is ready. Tap the button below to share your camera.</div>
      <div style="height:10px"></div>
      <button class="btn btn-primary" id="btn-start" onclick="startCamera()">Share my camera</button>
      <button class="btn btn-stop" id="btn-stop" onclick="stopCamera()">Stop sharing</button>
    </div>
  </div>
  <div class="card">
    <div class="card-body">
      <h2 style="margin-bottom:14px">How it works</h2>
      <div class="steps">
        <div class="step"><div class="step-num">1</div><div class="step-text">Tap <strong>Share my camera</strong><span>Allow camera access when your browser asks</span></div></div>
        <div class="step"><div class="step-num">2</div><div class="step-text">Point the back camera at the issue<span>Your agent sees the live feed instantly</span></div></div>
        <div class="step"><div class="step-num">3</div><div class="step-text">Tap <strong>Stop sharing</strong> when done<span>The session closes automatically</span></div></div>
      </div>
    </div>
  </div>
  <p class="privacy-note">Your agent can see your camera feed in real time.<br/>No recording is made. The session ends when you close this page.</p>
</main>
<footer>Powered by your support team</footer>
<script>
var BACKEND = '${BACKEND_URL}';
var SESSION_ID = '${sessionId}';
var stream = null;
var peerConnection = null;

function startCamera() {
  var btn = document.getElementById('btn-start');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Starting camera...';
  navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false})
  .then(function(s) {
    stream = s;
    var video = document.getElementById('customer-video');
    video.srcObject = stream;
    video.style.display = 'block';
    document.getElementById('placeholder').style.display = 'none';
    document.getElementById('live-pill').style.display = 'flex';
    return connectWebRTC();
  })
  .then(function() {
    setStatus('Your camera is live. Your agent can see it now.', 'success');
    document.getElementById('btn-start').style.display = 'none';
    document.getElementById('btn-stop').style.display = 'block';
  })
  .catch(function(e) {
    btn.disabled = false;
    btn.innerHTML = 'Share my camera';
    if (e.name === 'NotAllowedError') {
      setStatus('Camera access was denied. Please allow camera access and try again.', 'error');
    } else {
      setStatus('Could not access camera: ' + e.message, 'error');
    }
  });
}

function connectWebRTC() {
  peerConnection = new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]});
  stream.getTracks().forEach(function(track) { peerConnection.addTrack(track, stream); });
  return peerConnection.createOffer()
  .then(function(offer) {
    return peerConnection.setLocalDescription(offer);
  })
  .then(function() {
    return new Promise(function(resolve) {
      var candidates = [];
      peerConnection.onicecandidate = function(e) {
        if (e.candidate) { candidates.push(e.candidate); } else { resolve(candidates); }
      };
      setTimeout(function() { resolve(candidates); }, 3000);
    });
  })
  .then(function(candidates) {
    return fetch(BACKEND + '/sessions/' + SESSION_ID + '/offer', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({offer: peerConnection.localDescription, candidates: candidates})
    });
  })
  .then(function() { return pollForAnswer(0); });
}

function pollForAnswer(attempts) {
  if (attempts > 30) return Promise.reject(new Error('Agent did not connect in time'));
  return new Promise(function(r) { setTimeout(r, 1500); })
  .then(function() { return fetch(BACKEND + '/sessions/' + SESSION_ID + '/answer'); })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.answer) {
      return peerConnection.setRemoteDescription(new RTCSessionDescription(d.answer));
    }
    return pollForAnswer(attempts + 1);
  });
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach(function(t) { t.stop(); }); stream = null; }
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  document.getElementById('customer-video').style.display = 'none';
  document.getElementById('customer-video').srcObject = null;
  document.getElementById('placeholder').style.display = 'flex';
  document.getElementById('live-pill').style.display = 'none';
  document.getElementById('btn-stop').style.display = 'none';
  document.getElementById('btn-start').style.display = 'block';
  document.getElementById('btn-start').disabled = false;
  document.getElementById('btn-start').textContent = 'Share my camera';
  setStatus('Camera stopped. Tap the button to share again.', 'info');
  fetch(BACKEND + '/sessions/' + SESSION_ID + '/end', {method:'POST'}).catch(function(){});
}

function setStatus(msg, type) {
  var el = document.getElementById('status-bar');
  el.textContent = msg;
  el.className = 'status-bar ' + type;
}

window.addEventListener('beforeunload', function() {
  if (stream) stream.getTracks().forEach(function(t) { t.stop(); });
  fetch(BACKEND + '/sessions/' + SESSION_ID + '/end', {method:'POST', keepalive:true}).catch(function(){});
});
</script>
</body>
</html>`;
  res.send(html);
});

app.post('/sessions', (req, res) => {
  const ticket_id = req.body.ticket_id;
  if (!ticket_id) return res.status(400).json({ error: 'ticket_id required' });
  const session_id = 'cam-' + ticket_id + '-' + uuidv4().slice(0, 6);
  sessions.set(session_id, {
    id: session_id, ticket_id: ticket_id,
    created_at: Date.now(), status: 'waiting',
    offer: null, answer: null,
    customer_ice: [], agent_ice: []
  });
  const customer_url = BACKEND_URL + '/cam/' + session_id + '?ticket=' + ticket_id;
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
  if (!to || !url) return res.status(400).json({ error: 'to and url required' });
  if (!twilioClient) return res.status(503).json({ error: 'SMS not configured' });
  try {
    const message = await twilioClient.messages.create({
      body: 'Votre agent support souhaite voir le probleme en direct. Ouvrez ce lien sur votre telephone et partagez votre camera (aucune appli a installer) : ' + url,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to
    });
    res.json({ ok: true, sid: message.sid });
  } catch (err) {
    res.status(500).json({ error: 'SMS failed: ' + err.message });
  }
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('Server running on port ' + PORT);
});
