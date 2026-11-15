// Exe chat server. Run: npm install && npm start
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const DIR = process.env.DATA_DIR || __dirname;
const FILE = path.join(DIR, 'data.json');
const COLORS = ['#f47fff', '#5865f2', '#43b581', '#faa61a', '#f04747', '#00b0f4', '#ff7a59', '#9b84ee', '#3ddc97', '#ffd166'];

let db = { users: {}, servers: [], messages: {} };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
if (!db.servers.length) {
  db.servers.push({ id: 's1', name: 'Exe HQ', channels: [
    { id: 'c1', name: 'general' }, { id: 'c2', name: 'memes' }, { id: 'c3', name: 'gaming' } ] });
}
let saveTimer;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => fs.writeFile(FILE, JSON.stringify(db), () => {}), 500); }
const uid = () => crypto.randomBytes(6).toString('hex');

function hash(pass, salt) { return crypto.scryptSync(pass, salt, 32).toString('hex'); }

const httpServer = http.createServer((req, res) => { res.writeHead(200); res.end('Exe server is running'); });
const wss = new WebSocketServer({ server: httpServer, maxPayload: 16 * 1024 });
const clients = new Set();

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const broadcast = o => { for (const c of clients) if (c.user) send(c, o); };
function presence() {
  const on = new Set([...clients].filter(c => c.user).map(c => c.user));
  broadcast({ t: 'presence', users: Object.entries(db.users).map(([k, u]) => ({ user: u.name, color: u.color, online: on.has(k) })) });
}
const findChannel = id => { for (const s of db.servers) for (const c of s.channels) if (c.id === id) return c; return null; };
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

wss.on('connection', ws => {
  clients.add(ws);
  ws.user = null; ws.stamps = [];
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'ping') return send(ws, { t: 'pong' });

    if (m.t === 'auth') {
      const name = clean(m.user, 20), key = name.toLowerCase(), pass = String(m.pass || '');
      if (!/^[A-Za-z0-9_]{2,20}$/.test(name)) return send(ws, { t: 'autherr', msg: 'Username: 2-20 letters, numbers or _' });
      if (pass.length < 4 || pass.length > 100) return send(ws, { t: 'autherr', msg: 'Password must be at least 4 characters' });
      let u = db.users[key];
      if (m.mode === 'register') {
        if (u) return send(ws, { t: 'autherr', msg: 'That username is taken' });
        const salt = crypto.randomBytes(16).toString('hex');
        u = db.users[key] = { name, salt, hash: hash(pass, salt), color: COLORS[Object.keys(db.users).length % COLORS.length] };
        save();
      } else {
        if (!u) return send(ws, { t: 'autherr', msg: 'No account with that username' });
        const a = Buffer.from(hash(pass, u.salt)), b = Buffer.from(u.hash);
        if (!crypto.timingSafeEqual(a, b)) return send(ws, { t: 'autherr', msg: 'Wrong password' });
      }
      for (const c of clients) if (c !== ws && c.user === key) c.close(); // one session per account
      ws.user = key;
      send(ws, { t: 'authok', user: u.name, color: u.color, servers: db.servers });
      return presence();
    }

    if (!ws.user) return;
    const u = db.users[ws.user];

    if (m.t === 'history') {
      if (!findChannel(m.ch)) return;
      return send(ws, { t: 'history', ch: m.ch, msgs: (db.messages[m.ch] || []).slice(-100) });
    }
    if (m.t === 'msg') {
      const text = clean(m.text, 2000);
      if (!text || !findChannel(m.ch)) return;
      const now = Date.now();
      ws.stamps = ws.stamps.filter(s => now - s < 5000);
      if (ws.stamps.length >= 8) return send(ws, { t: 'notice', msg: 'Slow down!' });
      ws.stamps.push(now);
      const msg = { id: uid(), user: u.name, color: u.color, text, ts: now };
      (db.messages[m.ch] = db.messages[m.ch] || []).push(msg);
      if (db.messages[m.ch].length > 500) db.messages[m.ch].shift();
      save();
      return broadcast({ t: 'msg', ch: m.ch, msg });
    }
    if (m.t === 'del') {
      const list = db.messages[m.ch] || [];
      const i = list.findIndex(x => x.id === m.id && x.user === u.name);
      if (i < 0) return;
      list.splice(i, 1); save();
      return broadcast({ t: 'del', ch: m.ch, id: m.id });
    }
    if (m.t === 'newserver') {
      const name = clean(m.name, 30); if (!name) return;
      db.servers.push({ id: 's' + uid(), name, channels: [{ id: 'c' + uid(), name: 'general' }] });
      save(); return broadcast({ t: 'servers', servers: db.servers });
    }
    if (m.t === 'newchannel') {
      const s = db.servers.find(x => x.id === m.server);
      const name = clean(m.name, 24).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
      if (!s || !name || s.channels.length >= 30) return;
      s.channels.push({ id: 'c' + uid(), name });
      save(); return broadcast({ t: 'servers', servers: db.servers });
    }
  });
  ws.on('close', () => { clients.delete(ws); presence(); });
  ws.on('error', () => {});
});

httpServer.listen(PORT, () => console.log('Exe server listening on port ' + PORT));
