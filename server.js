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

const BACKEND_URL = 'https://video-support-backend-production.up.railway.app';
const PORT = parseInt(process.env.PORT, 10) || 3001;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

app.get('/viewer/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Live View — Support</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#07111f;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;flex-direction:column;height:100vh;overflow:hidden}
header{padding:12px 20px;background:rgba(0,0,0,0.5);display:flex;align-items:center;gap:12px;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0}
.title{font-size:14px;font-weight:600}
.badge{background:#cc3340;font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px;display:none;align-items:center;gap:5px}
.dot{width:6px;height:6px;background:#fff;border-radius:50%;animation:blink 1.1s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
.timer{margin-left:auto;font-size:13px;color:rgba(255,255,255,0.5);font-variant-numeric:tabular-nums}
.end-btn{padding:7px 16px;background:#cc3340;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer}
.end-btn:hover{background:#b02b37}
.video-area{flex:1;display:flex;align-items:center;justify-content:center;position:relative}
#agentVideo{width:100%;height:100%;object-fit:contain;display:none}
.waiting{text-align:center;color:rgba(255,255,255,0.3);position:absolute;padding:20px}
.waiting svg{display:block;margin:0 auto 12px;opacity:0.2}
.waiting p{font-size:14px}
.waiting small{font-size:12px;opacity:0.6;display:block;margin-top:6px}
</style>
</head>
<body>
<header>
  <span class="title">Support — Live View</span>
  <div class="badge" id="badge"><div class="dot"></div>LIVE</div>
  <span class="timer" id="timer">00:00</span>
  <button class="end-btn" onclick="endSession()">End session</button>
</header>
<div class="video-area">
  <div class="waiting" id="waiting">
    <svg width="56" height="56" viewBox="0 0 24 24" fill="white"><path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/></svg>
    <p>Waiting for customer to connect...</p>
    <small>Send the link to your customer and ask them to tap "Share my camera"</small>
  </div>
  <video id="agentVideo" autoplay playsinline></video>
</div>
<script>
var B='${BACKEND_URL}', S='${sessionId}', pc=null, secs=0, tmr=null;

function tick(){ secs++; var m=String(Math.floor(secs/60)).padStart(2,'0'),s=String(secs%60).padStart(2,'0'); document.getElementById('timer').textContent=m+':'+s; }

function pollOffer(n){
  if(n>60){ document.querySelector('.waiting p').textContent='Customer did not connect. Close this tab and try again.'; return; }
  fetch(B+'/sessions/'+S+'/offer')
  .then(function(r){ return r.json(); })
  .then(function(d){ if(d.offer){ connectRTC(d.offer); } else { setTimeout(function(){ pollOffer(n+1); },2000); } })
  .catch(function(){ setTimeout(function(){ pollOffer(n+1); },2000); });
}

function connectRTC(offer){
  pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]});
  pc.ontrack=function(e){
    var v=document.getElementById('agentVideo');
    v.srcObject=e.streams[0]; v.style.display='block';
    document.getElementById('waiting').style.display='none';
    document.getElementById('badge').style.display='flex';
    tmr=setInterval(tick,1000);
  };
  var agentIce=[];
  pc.onicecandidate=function(e){ if(e.candidate) agentIce.push(e.candidate); };
  pc.setRemoteDescription(new RTCSessionDescription(offer))
  .then(function(){ return pc.createAnswer(); })
  .then(function(a){ return pc.setLocalDescription(a); })
  .then(function(){ return new Promise(function(r){ setTimeout(r,2500); }); })
  .then(function(){
    return fetch(B+'/sessions/'+S+'/answer',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({answer:pc.localDescription, candidates:agentIce})
    });
  })
  .then(function(){ return fetch(B+'/sessions/'+S+'/customer-ice'); })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if(d.candidates){ d.candidates.forEach(function(c){ pc.addIceCandidate(new RTCIceCandidate(c)).catch(function(){}); }); }
  });
}

function endSession(){
  if(pc){ pc.close(); pc=null; }
  clearInterval(tmr);
  fetch(B+'/sessions/'+S+'/end',{method:'POST'}).catch(function(){});
  window.close();
}

pollOffer(0);
</script>
</body>
</html>`);
});

app.get('/cam/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const ticketId = req.query.ticket || '';
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no"/>
<title>Share your camera - Support</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;color:#2f3941;display:flex;flex-direction:column;align-items:center;min-height:100vh}
header{width:100%;background:#fff;border-bottom:1px solid #d8dcde;padding:14px 20px;display:flex;align-items:center}
.logo{font-size:16px;font-weight:700;color:#1f73b7}
.logo span{color:#2f3941;font-weight:400}
.ref{margin-left:auto;font-size:12px;color:#68737d;background:#f3f4f6;padding:4px 10px;border-radius:99px;border:1px solid #d8dcde}
main{width:100%;max-width:480px;padding:20px 16px 40px;display:flex;flex-direction:column;gap:16px}
.card{background:#fff;border-radius:12px;border:1px solid #d8dcde;overflow:hidden}
.card-body{padding:16px}
.video-wrap{width:100%;aspect-ratio:4/3;background:#07111f;position:relative;overflow:hidden}
video{width:100%;height:100%;object-fit:cover;display:none}
.ph{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:rgba(255,255,255,0.3);font-size:13px;padding:20px;text-align:center}
.live{position:absolute;top:10px;left:10px;background:#cc3340;color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px;display:none;align-items:center;gap:5px}
.dot{width:6px;height:6px;background:#fff;border-radius:50%;animation:blink 1.1s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
.bar{border-radius:8px;padding:12px 14px;font-size:13px;margin-bottom:10px;line-height:1.5;display:none}
.bar.info{background:#e5f0fb;color:#1f73b7;display:block}
.bar.ok{background:#edf8f4;color:#186146;display:block}
.bar.err{background:#fde8e8;color:#cc3340;display:block}
.btn{display:block;width:100%;padding:14px;border-radius:8px;font-size:15px;font-weight:600;text-align:center;cursor:pointer;border:none;margin-top:8px}
.btn:disabled{opacity:0.5;cursor:not-allowed}
.go{background:#1f73b7;color:#fff}.go:hover:not(:disabled){background:#1a62a0}
.stop{background:#fde8e8;color:#cc3340;border:1px solid #f5c4c4;display:none}
.safari-box{background:#fff3e0;border-radius:12px;border:2px solid #f0a500;padding:20px;display:none;text-align:center}
.safari-box h2{font-size:18px;font-weight:700;color:#2f3941;margin-bottom:8px}
.safari-box p{font-size:14px;color:#68737d;line-height:1.6;margin-bottom:16px}
.safari-btn{display:block;width:100%;padding:14px;border-radius:8px;font-size:15px;font-weight:700;text-align:center;cursor:pointer;border:none;background:#1f73b7;color:#fff;text-decoration:none}
.steps{display:flex;flex-direction:column;gap:10px}
.step{display:flex;align-items:flex-start;gap:12px}
.num{width:26px;height:26px;border-radius:50%;background:#1f73b7;color:#fff;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.st{font-size:14px;line-height:1.5}
.st span{color:#68737d;font-size:12px;display:block}
footer{padding:16px;font-size:12px;color:#68737d;text-align:center}
</style>
</head>
<body>
<header>
  <div class="logo">Support <span>Video</span></div>
  <div class="ref">Ticket #${ticketId || 'Support'}</div>
</header>
<main>
  <div class="safari-box" id="safari-box">
    <h2>Open in Safari</h2>
    <p>Camera sharing only works in <strong>Safari</strong> on iPhone.<br/>Tap below to reopen this page in Safari.</p>
    <a id="safari-link" class="safari-btn" href="#">Open in Safari</a>
  </div>
  <div class="card" id="cam-card">
    <div class="video-wrap">
      <video id="vid" autoplay muted playsinline></video>
      <div class="live" id="live"><div class="dot"></div>LIVE</div>
      <div class="ph" id="ph">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="white" opacity="0.3"><path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/></svg>
        <p>Camera preview</p>
      </div>
    </div>
    <div class="card-body">
      <div id="bar" class="bar info">Your agent is ready. Tap below to share your camera.</div>
      <button class="btn go" id="btnStart" onclick="startCam()">Share my camera</button>
      <button class="btn stop" id="btnStop" onclick="stopCam()">Stop sharing</button>
    </div>
  </div>
  <div class="card" id="steps-card">
    <div class="card-body">
      <div class="steps">
        <div class="step"><div class="num">1</div><div class="st">Tap <strong>Share my camera</strong><span>Allow camera access when asked</span></div></div>
        <div class="step"><div class="num">2</div><div class="st">Point the back camera at the issue<span>Your agent sees it instantly</span></div></div>
        <div class="step"><div class="num">3</div><div class="st">Tap <strong>Stop sharing</strong> when done<span>Session closes automatically</span></div></div>
      </div>
    </div>
  </div>
</main>
<footer>No app needed &bull; No recording &bull; Session ends when you leave</footer>
<script>
var B='${BACKEND_URL}', S='${sessionId}', stream=null, pc=null;
var ua=navigator.userAgent;
var isIOS=/iPhone|iPod|iPad/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
var isSafari=/Safari/.test(ua)&&!/CriOS/.test(ua)&&!/FxiOS/.test(ua)&&!/OPiOS/.test(ua)&&!/GSA/.test(ua);
if(isIOS&&!isSafari){
  document.getElementById('safari-box').style.display='block';
  document.getElementById('cam-card').style.display='none';
  document.getElementById('steps-card').style.display='none';
  document.getElementById('safari-link').href='safari://'+window.location.href.replace(/^https?:\\/\\//,'');
}

function startCam(){
  var btn=document.getElementById('btnStart');
  btn.disabled=true; btn.textContent='Starting...';
  if(stream){ stream.getTracks().forEach(function(t){ t.stop(); }); stream=null; }
  if(pc){ pc.close(); pc=null; }
  navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false})
  .catch(function(){ return navigator.mediaDevices.getUserMedia({video:true,audio:false}); })
  .then(function(s){
    stream=s;
    var v=document.getElementById('vid');
    v.srcObject=s; v.style.display='block';
    document.getElementById('ph').style.display='none';
    document.getElementById('live').style.display='flex';
    return doWebRTC();
  })
  .then(function(){
    setBar('Camera is live — your agent can see it now.','ok');
    document.getElementById('btnStart').style.display='none';
    document.getElementById('btnStop').style.display='block';
  })
  .catch(function(e){
    if(stream){ stream.getTracks().forEach(function(t){ t.stop(); }); stream=null; }
    if(pc){ pc.close(); pc=null; }
    btn.disabled=false; btn.textContent='Share my camera';
    var msg=e.name==='NotAllowedError'
      ?'Camera access denied. Please allow camera in your browser settings and try again.'
      :'Could not start camera. Tap the button again to retry.';
    setBar(msg,'err');
  });
}

function doWebRTC(){
  pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]});
  stream.getTracks().forEach(function(t){ pc.addTrack(t,stream); });
  var ice=[];
  return pc.createOffer()
  .then(function(o){ return pc.setLocalDescription(o); })
  .then(function(){
    return new Promise(function(res){
      pc.onicecandidate=function(e){ if(e.candidate){ ice.push(e.candidate); }else{ res(); } };
      setTimeout(res,4000);
    });
  })
  .then(function(){
    return fetch(B+'/sessions/'+S+'/offer',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({offer:pc.localDescription,candidates:ice})
    });
  })
  .then(function(){ return waitAnswer(0); });
}

function waitAnswer(n){
  if(n>40) return Promise.resolve();
  return new Promise(function(r){ setTimeout(r,1500); })
  .then(function(){ return fetch(B+'/sessions/'+S+'/answer'); })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if(d.answer){ return pc.setRemoteDescription(new RTCSessionDescription(d.answer)); }
    return waitAnswer(n+1);
  });
}

function stopCam(){
  if(stream){ stream.getTracks().forEach(function(t){ t.stop(); }); stream=null; }
  if(pc){ pc.close(); pc=null; }
  var v=document.getElementById('vid');
  v.style.display='none'; v.srcObject=null;
  document.getElementById('ph').style.display='flex';
  document.getElementById('live').style.display='none';
  document.getElementById('btnStop').style.display='none';
  document.getElementById('btnStart').style.display='block';
  document.getElementById('btnStart').disabled=false;
  document.getElementById('btnStart').textContent='Share my camera';
  setBar('Camera stopped. Tap to share again.','info');
  fetch(B+'/sessions/'+S+'/end',{method:'POST'}).catch(function(){});
}

function setBar(m,t){ var e=document.getElementById('bar'); e.textContent=m; e.className='bar '+t; }

window.addEventListener('beforeunload',function(){
  if(stream) stream.getTracks().forEach(function(t){ t.stop(); });
  fetch(B+'/sessions/'+S+'/end',{method:'POST',keepalive:true}).catch(function(){});
});
</script>
</body>
</html>`);
});

// ── SESSIONS ──────────────────────────────────────────────────────────────────
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
  const viewer_url = BACKEND_URL + '/viewer/' + session_id;
  setTimeout(function() { sessions.delete(session_id); }, 30 * 60 * 1000);
  res.json({ session_id: session_id, customer_url: customer_url, viewer_url: viewer_url });
});

// Auto-recreate session if expired — fixes Railway restart issue
function getOrCreateSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      id: id, ticket_id: 'unknown',
      created_at: Date.now(), status: 'waiting',
      offer: null, answer: null,
      customer_ice: [], agent_ice: []
    });
  }
  return sessions.get(id);
}

app.post('/sessions/:id/offer', (req, res) => {
  const session = getOrCreateSession(req.params.id);
  session.offer = req.body.offer;
  session.customer_ice = req.body.candidates || [];
  session.status = 'offer_received';
  res.json({ ok: true });
});

app.get('/sessions/:id/offer', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.json({ offer: null });
  res.json({ offer: session.offer || null });
});

app.post('/sessions/:id/answer', (req, res) => {
  const session = getOrCreateSession(req.params.id);
  session.answer = req.body.answer;
  session.status = 'connected';
  res.json({ ok: true });
});

app.get('/sessions/:id/answer', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.json({ answer: null });
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
  if (!session) return res.json({ candidates: [] });
  res.json({ candidates: session.agent_ice });
});

app.get('/sessions/:id/customer-ice', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.json({ candidates: [] });
  res.json({ candidates: session.customer_ice });
});

app.post('/sessions/:id/end', (req, res) => {
  sessions.delete(req.params.id);
  res.json({ ok: true });
});

// ── SMS ───────────────────────────────────────────────────────────────────────
app.post('/sms', async (req, res) => {
  const to = req.body.to, url = req.body.url, ticket_id = req.body.ticket_id;
  if (!to || !url) return res.status(400).json({ error: 'to and url required' });
  if (!twilioClient) return res.status(503).json({ error: 'SMS not configured' });
  try {
    const message = await twilioClient.messages.create({
      body: 'Your support agent wants to see the issue. Open this link on your phone and share your camera (no app needed): ' + url,
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
