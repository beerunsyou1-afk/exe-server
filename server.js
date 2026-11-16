// Exe chat server. Run: npm install && npm start
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8080, ADMIN = (process.env.ADMIN_USER || 'zzz').toLowerCase();
const FILE = path.join(process.env.DATA_DIR || __dirname, 'data.json');
const UP = path.join(path.dirname(FILE), 'uploads'); fs.mkdirSync(UP, { recursive: true });
const IMG = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+\/=]+)$/;
const COLORS = ['#f47fff', '#5865f2', '#43b581', '#faa61a', '#f04747', '#00b0f4', '#ff7a59', '#9b84ee', '#3ddc97', '#ffd166'];
const NITRO_PRICE = 1000;
const BADGES = { // id: [name, icon, rarity, how]
  admin: ['Staff', '🛡️', 'Mythic', 'Given to admins'], bughunter: ['Bug Hunter', '🐛', 'Mythic', 'Given by staff'],
  legend: ['Legend', '👑', 'Mythic', 'Given by staff'], nitro: ['Nitro', '💎', 'Epic', 'Buy Nitro'],
  rich: ['Coin Hoarder', '💰', 'Epic', 'Hold 2000 coins'], partner: ['Partner', '🤝', 'Epic', 'Given by staff'],
  gametime: ['Game Time', '🎮', 'Rare', 'Given by staff'], variety: ['Game Variety', '🕹️', 'Rare', 'Given by staff'],
  streaming: ['Streaming', '📺', 'Rare', 'Given by staff'], talker: ['Talkative', '🗣️', 'Rare', 'Send 1000 messages'],
  early: ['Early Supporter', '🌟', 'Rare', 'Be one of the first 10 users'], age: ['Account Age', '🎂', 'Rare', 'Account 7 days old'],
  chatter: ['Chatterbox', '💬', 'Common', 'Send 100 messages'], first: ['First Words', '👋', 'Common', 'Send a message'],
  styled: ['Stylish', '🎨', 'Common', 'Edit your profile'], generous: ['Generous', '🎁', 'Rare', 'Gift something to a friend'], caller: ['Voice Chatter', '🎧', 'Common', 'Join a voice channel'], verified: ['Verified', '✅', 'Common', 'Given by staff'] };
let db = { users: {}, servers: [], messages: {}, news: [] };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
if (!db.news) db.news = [];
if (!db.news.length) db.news.push({ id: 'n1', title: 'Welcome to Discord!', text: 'Hey! I am the official Discord bot. I will send you news and updates here.\n\nChat in servers, earn coins by talking, and spend them on Nitro in the Nitro tab. Click anyone to see their profile.', attachments: [], ts: Date.now() },
  { id: 'n2', title: 'Patch notes: Nitro, coins and badges', text: '- Earn 1 coin per message (2 with Nitro)\n- Buy Nitro for 1000 coins: GIF banners, fonts, effects, frames\n- 16 badges to collect\n- Click profiles, server names and settings', attachments: [], ts: Date.now() + 1 });
if (!db.servers.length) db.servers.push({ id: 's1', name: 'Exe HQ', channels: [{ id: 'c1', name: 'general' }, { id: 'c2', name: 'memes' }, { id: 'c3', name: 'gaming' }] });
if (!db.servers.some(x => x.channels.some(c => c.type === 'voice'))) db.servers[0].channels.push({ id: 'cv1', name: 'Lounge', type: 'voice' });
let st; const save = () => { clearTimeout(st); st = setTimeout(() => fs.writeFile(FILE, JSON.stringify(db), () => {}), 500); };
const uid = () => crypto.randomBytes(6).toString('hex');
const hash = (p, s) => crypto.scryptSync(p, s, 32).toString('hex');
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const isAdmin = k => k === ADMIN;
const give = (u, id) => { if (BADGES[id] && !u.badges.includes(id)) u.badges.push(id); };
const okBanner = b => !b || /^#[0-9a-f]{6}$/i.test(b) || /^https:\/\/\S{3,400}$/i.test(b);

const clients = new Set();
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const bcast = o => { for (const c of clients) if (c.user) send(c, o); };
const pub = (k, on) => { const u = db.users[k], st = !on || u.status === 'invisible' ? 'offline' : (u.status || 'online'); return { user: u.name, color: u.color, online: st !== 'offline', status: st, nb: !!u.nb, admin: isAdmin(k), nitro: u.nitro || isAdmin(k), badges: u.badges, bio: u.bio, bcolor: /^#/.test(u.banner || '') ? u.banner : '', av: u.avatar ? (u.avv || 1) : 0, bn: u.bnimg ? (u.bnv || 1) : 0, t1: u.t1 || '', t2: u.t2 || '', font: u.font, effect: u.effect, frame: u.frame, joined: u.joined }; };
const presence = () => { const on = new Set([...clients].filter(c => c.user).map(c => c.user)); bcast({ t: 'presence', users: Object.keys(db.users).map(k => pub(k, on.has(k))) }); };
const sendMe = ws => ws.user && send(ws, { t: 'me', coins: db.users[ws.user].coins, status: db.users[ws.user].status || 'online' });
function autoBadges(u, k) {
  if (isAdmin(k)) give(u, 'admin');
  if (u.nitro) give(u, 'nitro');
  if (u.msgs >= 1) give(u, 'first'); if (u.msgs >= 100) give(u, 'chatter'); if (u.msgs >= 1000) give(u, 'talker');
  if (u.coins >= 2000) give(u, 'rich'); if (Date.now() - u.joined > 7 * 864e5) give(u, 'age');
}
const findCh = id => db.servers.flatMap(s => s.channels).find(c => c.id === id);
const FONTS = 7;
const rooms = () => { const r = {}; for (const c of clients) if (c.user && c.vch) (r[c.vch] = r[c.vch] || []).push({ user: db.users[c.user].name, ...c.vs }); return r; };
const vbcast = () => bcast({ t: 'voice', rooms: rooms() });
function vleave(ws) { if (!ws.user || !ws.vch) return; const ch = ws.vch, name = db.users[ws.user].name; ws.vch = null; ws.vs = {}; for (const c of clients) if (c.user && c.vch === ch) send(c, { t: 'vleft', user: name }); vbcast(); }

const srv = http.createServer((q, r) => {
  let m;
  if ((m = q.url.match(/^\/img\/([a-z0-9_]+)\/(av|bn)/i))) {
    const u = db.users[m[1].toLowerCase()], d = u && (m[2] === 'av' ? u.avatar : u.bnimg), x = d && IMG.exec(d);
    if (x) { r.writeHead(200, { 'Content-Type': 'image/' + x[1], 'Cache-Control': 'public,max-age=31536000' }); return r.end(Buffer.from(x[2], 'base64')); }
  } else if ((m = q.url.match(/^\/u\/([a-f0-9]{12}\.(png|jpeg|webp|gif))/))) {
    return fs.readFile(path.join(UP, m[1]), (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': 'image/' + m[2], 'Cache-Control': 'public,max-age=31536000' }); r.end(b); });
  }
  r.writeHead(200); r.end('Exe server is running');
});
const wss = new WebSocketServer({ server: srv, maxPayload: 6 * 1024 * 1024 });
wss.on('connection', ws => {
  clients.add(ws); ws.user = null; ws.stamps = [];
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (raw.length > 16384 && !(ws.user && (isAdmin(ws.user) || ['msg', 'setimg', 'sig'].includes(m.t)))) return;
    if (m.t === 'ping') return send(ws, { t: 'pong' });
    if (m.t === 'auth') {
      const name = clean(m.user, 20), key = name.toLowerCase(), pass = String(m.pass || '');
      if (!/^[A-Za-z0-9_]{2,20}$/.test(name)) return send(ws, { t: 'autherr', msg: 'Username: 2-20 letters, numbers or _' });
      if (pass.length < 4 || pass.length > 100) return send(ws, { t: 'autherr', msg: 'Password must be at least 4 characters' });
      let u = db.users[key];
      if (m.mode === 'register') {
        if (u) return send(ws, { t: 'autherr', msg: 'That username is taken' });
        const salt = crypto.randomBytes(16).toString('hex');
        u = db.users[key] = { name, salt, hash: hash(pass, salt), color: COLORS[Object.keys(db.users).length % COLORS.length], coins: 100, nitro: false, badges: [], bio: '', banner: '', font: 0, effect: '', frame: '', msgs: 0, joined: Date.now(), lastEdit: 0 };
        if (Object.keys(db.users).length <= 10) give(u, 'early');
      } else {
        if (!u) return send(ws, { t: 'autherr', msg: 'No account with that username' });
        if (!crypto.timingSafeEqual(Buffer.from(hash(pass, u.salt)), Buffer.from(u.hash))) return send(ws, { t: 'autherr', msg: 'Wrong password' });
      }
      for (const c of clients) if (c !== ws && c.user === key) c.close();
      ws.user = key; autoBadges(u, key); save();
      send(ws, { t: 'authok', ver: 3, status: u.status || 'online', news: db.news.slice(-50), seen: u.newsSeen || 0, user: u.name, admin: isAdmin(key), coins: u.coins, servers: db.servers, badges: BADGES, price: NITRO_PRICE });
      send(ws, { t: 'voice', rooms: rooms() });
      return presence();
    }
    if (!ws.user) return;
    const k = ws.user, u = db.users[k];
    if (m.t === 'history') return findCh(m.ch) && send(ws, { t: 'history', ch: m.ch, msgs: (db.messages[m.ch] || []).slice(-100) });
    if (m.t === 'msg') {
      const text = clean(m.text, 2000); if (!findCh(m.ch)) return;
      let img = '';
      if (m.img) { const x = IMG.exec(String(m.img)); if (!x || x[2].length > 2.2e6) return send(ws, { t: 'notice', msg: 'Image too big (max ~1.5MB)' });
        if (x[1] === 'gif' && x[2].length > 1.6e6) return send(ws, { t: 'notice', msg: 'GIF too big' });
        const id = uid() + '.' + x[1]; fs.writeFileSync(path.join(UP, id), Buffer.from(x[2], 'base64')); img = '/u/' + id; }
      if (!text && !img) return;
      const now = Date.now(); ws.stamps = ws.stamps.filter(s => now - s < 5000);
      if (ws.stamps.length >= 8) return send(ws, { t: 'notice', msg: 'Slow down!' });
      ws.stamps.push(now);
      const msg = { id: uid(), user: u.name, text, ts: now, img };
      (db.messages[m.ch] = db.messages[m.ch] || []).push(msg); if (db.messages[m.ch].length > 500) db.messages[m.ch].shift();
      u.msgs++; u.coins += u.nitro || isAdmin(k) ? 2 : 1; // Nitro earns 2x
      const had = u.badges.length; autoBadges(u, k); save();
      bcast({ t: 'msg', ch: m.ch, msg }); sendMe(ws); if (u.badges.length !== had) presence(); return;
    }
    if (m.t === 'del') { const l = db.messages[m.ch] || [], i = l.findIndex(x => x.id === m.id && x.user === u.name); if (i < 0) return; l.splice(i, 1); save(); return bcast({ t: 'del', ch: m.ch, id: m.id }); }
    if (m.t === 'newserver') { const n = clean(m.name, 30); if (!n) return; db.servers.push({ id: 's' + uid(), name: n, channels: [{ id: 'c' + uid(), name: 'general' }] }); save(); return bcast({ t: 'servers', servers: db.servers }); }
    if (m.t === 'renameserver') { const s = db.servers.find(x => x.id === m.server), n = clean(m.name, 30); if (!s || !n) return; s.name = n; save(); return bcast({ t: 'servers', servers: db.servers }); }
    if (m.t === 'newchannel') {
      const s = db.servers.find(x => x.id === m.server), n = clean(m.name, 24).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
      if (!s || !n || s.channels.length >= 30) return; s.channels.push({ id: 'c' + uid(), name: n, type: m.voice ? 'voice' : 'text' }); save(); return bcast({ t: 'servers', servers: db.servers });
    }
    if (m.t === 'profile') {
      const perk = u.nitro || isAdmin(k), hex = x => /^#[0-9a-f]{6}$/i.test(x || '');
      if (!perk && (+m.font || m.effect || m.frame || m.t1 || m.t2)) return send(ws, { t: 'notice', msg: 'Fonts, effects, frames and gradients need Nitro!' });
      u.bio = clean(m.bio, 190); u.nb = !!m.nb; u.banner = hex(m.bcolor) ? m.bcolor : ''; u.font = Math.max(0, Math.min(FONTS - 1, +m.font || 0));
      u.effect = ['', 'rainbow', 'glow', 'fire', 'neon'].includes(m.effect) ? m.effect : ''; u.frame = ['', 'gold', 'aurora', 'blossom', 'void'].includes(m.frame) ? m.frame : '';
      u.t1 = perk && hex(m.t1) ? m.t1 : ''; u.t2 = perk && hex(m.t2) ? m.t2 : ''; if (hex(m.color)) u.color = m.color;
      if (Date.now() - u.lastEdit > 6e4) { u.coins += 5; u.lastEdit = Date.now(); }
      give(u, 'styled'); save(); sendMe(ws); return presence();
    }
    if (m.t === 'setimg') {
      const f = m.kind === 'avatar' ? ['avatar', 'avv'] : m.kind === 'banner' ? ['bnimg', 'bnv'] : null; if (!f) return;
      if (m.data === '') { u[f[0]] = ''; u[f[1]] = 0; }
      else { const x = IMG.exec(String(m.data || '')); if (!x || x[2].length > 1.3e6) return send(ws, { t: 'notice', msg: 'Image too big (max ~900KB)' });
        if (x[1] === 'gif' && !(u.nitro || isAdmin(k))) return send(ws, { t: 'notice', msg: 'Animated GIFs need Nitro (normal images are free)' });
        u[f[0]] = m.data; u[f[1]] = Date.now(); }
      give(u, 'styled'); save(); send(ws, { t: 'imgok', kind: m.kind }); return presence();
    }
    if (m.t === 'status') { if (['online', 'away', 'dnd', 'invisible'].includes(m.status)) { u.status = m.status; save(); sendMe(ws); presence(); } return; }
    if (m.t === 'vjoin') {
      const c = findCh(m.ch); if (!c || c.type !== 'voice') return;
      const others = [...clients].filter(x => x !== ws && x.user && x.vch === m.ch);
      if (others.length >= 8) return send(ws, { t: 'notice', msg: 'That voice channel is full (8 max)' });
      vleave(ws); ws.vch = m.ch; ws.vs = { muted: false, deaf: false, camId: '', screenId: '' }; give(u, 'caller'); save();
      send(ws, { t: 'vpeers', ch: m.ch, peers: others.map(x => db.users[x.user].name) }); return vbcast();
    }
    if (m.t === 'vleave') return vleave(ws);
    if (m.t === 'vstate') { if (!ws.vch) return; ws.vs = { muted: !!m.muted, deaf: !!m.deaf, camId: String(m.camId || '').slice(0, 80), screenId: String(m.screenId || '').slice(0, 80) }; return vbcast(); }
    if (m.t === 'sig') { if (!ws.vch || !m.data) return; const tk = String(m.to || '').toLowerCase(); for (const c of clients) if (c.user === tk && c.vch === ws.vch) send(c, { t: 'sig', from: u.name, data: m.data }); return; }
    if (m.t === 'react') {
      const e = String(m.emoji || '').slice(0, 8), msg = (db.messages[m.ch] || []).find(x => x.id === m.id); if (!msg || !e) return;
      const r = msg.reactions = msg.reactions || {}; if (!r[e] && Object.keys(r).length >= 20) return;
      const a = r[e] || [], i = a.indexOf(u.name); if (i >= 0) a.splice(i, 1); else a.push(u.name); if (a.length) r[e] = a; else delete r[e];
      save(); return bcast({ t: 'react', ch: m.ch, id: m.id, reactions: r });
    }
    if (m.t === 'gift') {
      const tk = String(m.target || '').toLowerCase(), tu = db.users[tk], note = msg => send(ws, { t: 'notice', msg }); let n = 0;
      if (!tu || tk === k) return note('Pick someone else to gift');
      if (m.item === 'nitro') { if (tu.nitro || isAdmin(tk)) return note('They already have Nitro'); if (u.coins < NITRO_PRICE) return note('Not enough coins'); u.coins -= NITRO_PRICE; tu.nitro = true; give(tu, 'nitro'); }
      else if (m.item === 'coins') { n = Math.floor(+m.amount || 0); if (n < 1 || n > u.coins) return note('Invalid amount'); u.coins -= n; tu.coins += n; }
      else return;
      give(u, 'generous'); autoBadges(tu, tk); save(); sendMe(ws); note('🎁 Gift sent!');
      for (const c of clients) if (c.user === tk) { sendMe(c); send(c, { t: 'gift', from: u.name, item: m.item, amount: n }); } return presence();
    }
    if (m.t === 'buy') {
      if (m.item !== 'nitro' || u.nitro) return;
      if (u.coins < NITRO_PRICE) return send(ws, { t: 'notice', msg: 'Not enough coins' });
      u.coins -= NITRO_PRICE; u.nitro = true; give(u, 'nitro'); save(); sendMe(ws); return presence();
    }
    if (m.t === 'newsseen') { u.newsSeen = Date.now(); return save(); }
    if (m.t === 'postnews') {
      if (!isAdmin(k)) return;
      const title = clean(m.title, 100), text = String(m.text || '').slice(0, 2000).trim();
      const att = (Array.isArray(m.attachments) ? m.attachments : []).slice(0, 3).map(a => ({ name: clean(a && a.name, 80) || 'file', url: String((a && a.url) || '') }))
        .filter(a => /^(https:\/\/\S{3,500}|data:[\w\/.+-]{3,60};base64,[A-Za-z0-9+\/=]+)$/.test(a.url) && a.url.length < 2.2e6);
      if (!title && !text && !att.length) return;
      const post = { id: uid(), title, text, attachments: att, ts: Date.now() };
      db.news.push(post); if (db.news.length > 50) db.news.shift(); save(); return bcast({ t: 'newspost', post });
    }
    if (m.t === 'delnews') { if (!isAdmin(k)) return; db.news = db.news.filter(n => n.id !== m.id); save(); return bcast({ t: 'newsdel', id: m.id }); }
    if (m.t === 'admin') {
      if (!isAdmin(k)) return;
      const tk = String(m.target || '').toLowerCase(), tu = db.users[tk]; if (!tu) return;
      const a = m.action;
      if (a === 'givebadge') give(tu, m.value); else if (a === 'removebadge') tu.badges = tu.badges.filter(b => b !== m.value);
      else if (a === 'givenitro') { tu.nitro = true; give(tu, 'nitro'); } else if (a === 'removenitro') { tu.nitro = false; tu.badges = tu.badges.filter(b => b !== 'nitro'); }
      else if (a === 'givecoins') tu.coins += Math.max(-1e6, Math.min(1e6, parseInt(m.value) || 0));
      else if (a === 'giveall') { tu.nitro = true; Object.keys(BADGES).forEach(b => give(tu, b)); tu.coins += 100000; }
      else if (a === 'clear') tu.badges = [];
      save(); presence(); for (const c of clients) if (c.user === tk) sendMe(c); return;
    }
  });
  ws.on('close', () => { vleave(ws); clients.delete(ws); presence(); });
  ws.on('error', () => {});
});
srv.listen(PORT, () => console.log('Exe server listening on port ' + PORT));
// Exe chat server. Run: npm install && npm start
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8080, ADMIN = (process.env.ADMIN_USER || 'zzz').toLowerCase();
const FILE = path.join(process.env.DATA_DIR || __dirname, 'data.json');
const UP = path.join(path.dirname(FILE), 'uploads'); fs.mkdirSync(UP, { recursive: true });
const IMG = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+\/=]+)$/;
const COLORS = ['#f47fff', '#5865f2', '#43b581', '#faa61a', '#f04747', '#00b0f4', '#ff7a59', '#9b84ee', '#3ddc97', '#ffd166'];
const NITRO_PRICE = 1000;
const BADGES = { // id: [name, icon, rarity, how]
  admin: ['Staff', '🛡️', 'Mythic', 'Given to admins'], bughunter: ['Bug Hunter', '🐛', 'Mythic', 'Given by staff'],
  legend: ['Legend', '👑', 'Mythic', 'Given by staff'], nitro: ['Nitro', '💎', 'Epic', 'Buy Nitro'],
  rich: ['Coin Hoarder', '💰', 'Epic', 'Hold 2000 coins'], partner: ['Partner', '🤝', 'Epic', 'Given by staff'],
  gametime: ['Game Time', '🎮', 'Rare', 'Given by staff'], variety: ['Game Variety', '🕹️', 'Rare', 'Given by staff'],
  streaming: ['Streaming', '📺', 'Rare', 'Given by staff'], talker: ['Talkative', '🗣️', 'Rare', 'Send 1000 messages'],
  early: ['Early Supporter', '🌟', 'Rare', 'Be one of the first 10 users'], age: ['Account Age', '🎂', 'Rare', 'Account 7 days old'],
  chatter: ['Chatterbox', '💬', 'Common', 'Send 100 messages'], first: ['First Words', '👋', 'Common', 'Send a message'],
  styled: ['Stylish', '🎨', 'Common', 'Edit your profile'], verified: ['Verified', '✅', 'Common', 'Given by staff'] };
let db = { users: {}, servers: [], messages: {}, news: [] };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
if (!db.news) db.news = [];
if (!db.news.length) db.news.push({ id: 'n1', title: 'Welcome to Discord!', text: 'Hey! I am the official Discord bot. I will send you news and updates here.\n\nChat in servers, earn coins by talking, and spend them on Nitro in the Nitro tab. Click anyone to see their profile.', attachments: [], ts: Date.now() },
  { id: 'n2', title: 'Patch notes: Nitro, coins and badges', text: '- Earn 1 coin per message (2 with Nitro)\n- Buy Nitro for 1000 coins: GIF banners, fonts, effects, frames\n- 16 badges to collect\n- Click profiles, server names and settings', attachments: [], ts: Date.now() + 1 });
if (!db.servers.length) db.servers.push({ id: 's1', name: 'Exe HQ', channels: [{ id: 'c1', name: 'general' }, { id: 'c2', name: 'memes' }, { id: 'c3', name: 'gaming' }] });
let st; const save = () => { clearTimeout(st); st = setTimeout(() => fs.writeFile(FILE, JSON.stringify(db), () => {}), 500); };
const uid = () => crypto.randomBytes(6).toString('hex');
const hash = (p, s) => crypto.scryptSync(p, s, 32).toString('hex');
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const isAdmin = k => k === ADMIN;
const give = (u, id) => { if (BADGES[id] && !u.badges.includes(id)) u.badges.push(id); };
const okBanner = b => !b || /^#[0-9a-f]{6}$/i.test(b) || /^https:\/\/\S{3,400}$/i.test(b);

const clients = new Set();
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const bcast = o => { for (const c of clients) if (c.user) send(c, o); };
const pub = (k, on) => { const u = db.users[k]; return { user: u.name, color: u.color, online: on, admin: isAdmin(k), nitro: u.nitro || isAdmin(k), badges: u.badges, bio: u.bio, bcolor: /^#/.test(u.banner || '') ? u.banner : '', av: u.avatar ? (u.avv || 1) : 0, bn: u.bnimg ? (u.bnv || 1) : 0, t1: u.t1 || '', t2: u.t2 || '', font: u.font, effect: u.effect, frame: u.frame, joined: u.joined }; };
const presence = () => { const on = new Set([...clients].filter(c => c.user).map(c => c.user)); bcast({ t: 'presence', users: Object.keys(db.users).map(k => pub(k, on.has(k))) }); };
const sendMe = ws => ws.user && send(ws, { t: 'me', coins: db.users[ws.user].coins });
function autoBadges(u, k) {
  if (isAdmin(k)) give(u, 'admin');
  if (u.nitro) give(u, 'nitro');
  if (u.msgs >= 1) give(u, 'first'); if (u.msgs >= 100) give(u, 'chatter'); if (u.msgs >= 1000) give(u, 'talker');
  if (u.coins >= 2000) give(u, 'rich'); if (Date.now() - u.joined > 7 * 864e5) give(u, 'age');
}
const findCh = id => db.servers.flatMap(s => s.channels).find(c => c.id === id);
const FONTS = 7;

const srv = http.createServer((q, r) => {
  let m;
  if ((m = q.url.match(/^\/img\/([a-z0-9_]+)\/(av|bn)/i))) {
    const u = db.users[m[1].toLowerCase()], d = u && (m[2] === 'av' ? u.avatar : u.bnimg), x = d && IMG.exec(d);
    if (x) { r.writeHead(200, { 'Content-Type': 'image/' + x[1], 'Cache-Control': 'public,max-age=31536000' }); return r.end(Buffer.from(x[2], 'base64')); }
  } else if ((m = q.url.match(/^\/u\/([a-f0-9]{12}\.(png|jpeg|webp|gif))/))) {
    return fs.readFile(path.join(UP, m[1]), (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': 'image/' + m[2], 'Cache-Control': 'public,max-age=31536000' }); r.end(b); });
  }
  r.writeHead(200); r.end('Exe server is running');
});
const wss = new WebSocketServer({ server: srv, maxPayload: 6 * 1024 * 1024 });
wss.on('connection', ws => {
  clients.add(ws); ws.user = null; ws.stamps = [];
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (raw.length > 16384 && !(ws.user && (isAdmin(ws.user) || ['msg', 'setimg'].includes(m.t)))) return;
    if (m.t === 'ping') return send(ws, { t: 'pong' });
    if (m.t === 'auth') {
      const name = clean(m.user, 20), key = name.toLowerCase(), pass = String(m.pass || '');
      if (!/^[A-Za-z0-9_]{2,20}$/.test(name)) return send(ws, { t: 'autherr', msg: 'Username: 2-20 letters, numbers or _' });
      if (pass.length < 4 || pass.length > 100) return send(ws, { t: 'autherr', msg: 'Password must be at least 4 characters' });
      let u = db.users[key];
      if (m.mode === 'register') {
        if (u) return send(ws, { t: 'autherr', msg: 'That username is taken' });
        const salt = crypto.randomBytes(16).toString('hex');
        u = db.users[key] = { name, salt, hash: hash(pass, salt), color: COLORS[Object.keys(db.users).length % COLORS.length], coins: 100, nitro: false, badges: [], bio: '', banner: '', font: 0, effect: '', frame: '', msgs: 0, joined: Date.now(), lastEdit: 0 };
        if (Object.keys(db.users).length <= 10) give(u, 'early');
      } else {
        if (!u) return send(ws, { t: 'autherr', msg: 'No account with that username' });
        if (!crypto.timingSafeEqual(Buffer.from(hash(pass, u.salt)), Buffer.from(u.hash))) return send(ws, { t: 'autherr', msg: 'Wrong password' });
      }
      for (const c of clients) if (c !== ws && c.user === key) c.close();
      ws.user = key; autoBadges(u, key); save();
      send(ws, { t: 'authok', ver: 3, news: db.news.slice(-50), seen: u.newsSeen || 0, user: u.name, admin: isAdmin(key), coins: u.coins, servers: db.servers, badges: BADGES, price: NITRO_PRICE });
      return presence();
    }
    if (!ws.user) return;
    const k = ws.user, u = db.users[k];
    if (m.t === 'history') return findCh(m.ch) && send(ws, { t: 'history', ch: m.ch, msgs: (db.messages[m.ch] || []).slice(-100) });
    if (m.t === 'msg') {
      const text = clean(m.text, 2000); if (!findCh(m.ch)) return;
      let img = '';
      if (m.img) { const x = IMG.exec(String(m.img)); if (!x || x[2].length > 2.2e6) return send(ws, { t: 'notice', msg: 'Image too big (max ~1.5MB)' });
        if (x[1] === 'gif' && x[2].length > 1.6e6) return send(ws, { t: 'notice', msg: 'GIF too big' });
        const id = uid() + '.' + x[1]; fs.writeFileSync(path.join(UP, id), Buffer.from(x[2], 'base64')); img = '/u/' + id; }
      if (!text && !img) return;
      const now = Date.now(); ws.stamps = ws.stamps.filter(s => now - s < 5000);
      if (ws.stamps.length >= 8) return send(ws, { t: 'notice', msg: 'Slow down!' });
      ws.stamps.push(now);
      const msg = { id: uid(), user: u.name, text, ts: now, img };
      (db.messages[m.ch] = db.messages[m.ch] || []).push(msg); if (db.messages[m.ch].length > 500) db.messages[m.ch].shift();
      u.msgs++; u.coins += u.nitro || isAdmin(k) ? 2 : 1; // Nitro earns 2x
      const had = u.badges.length; autoBadges(u, k); save();
      bcast({ t: 'msg', ch: m.ch, msg }); sendMe(ws); if (u.badges.length !== had) presence(); return;
    }
    if (m.t === 'del') { const l = db.messages[m.ch] || [], i = l.findIndex(x => x.id === m.id && x.user === u.name); if (i < 0) return; l.splice(i, 1); save(); return bcast({ t: 'del', ch: m.ch, id: m.id }); }
    if (m.t === 'newserver') { const n = clean(m.name, 30); if (!n) return; db.servers.push({ id: 's' + uid(), name: n, channels: [{ id: 'c' + uid(), name: 'general' }] }); save(); return bcast({ t: 'servers', servers: db.servers }); }
    if (m.t === 'renameserver') { const s = db.servers.find(x => x.id === m.server), n = clean(m.name, 30); if (!s || !n) return; s.name = n; save(); return bcast({ t: 'servers', servers: db.servers }); }
    if (m.t === 'newchannel') {
      const s = db.servers.find(x => x.id === m.server), n = clean(m.name, 24).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
      if (!s || !n || s.channels.length >= 30) return; s.channels.push({ id: 'c' + uid(), name: n }); save(); return bcast({ t: 'servers', servers: db.servers });
    }
    if (m.t === 'profile') {
      const perk = u.nitro || isAdmin(k), hex = x => /^#[0-9a-f]{6}$/i.test(x || '');
      if (!perk && (+m.font || m.effect || m.frame || m.t1 || m.t2)) return send(ws, { t: 'notice', msg: 'Fonts, effects, frames and gradients need Nitro!' });
      u.bio = clean(m.bio, 190); u.banner = hex(m.bcolor) ? m.bcolor : ''; u.font = Math.max(0, Math.min(FONTS - 1, +m.font || 0));
      u.effect = ['', 'rainbow', 'glow', 'fire', 'neon'].includes(m.effect) ? m.effect : ''; u.frame = ['', 'gold', 'aurora', 'blossom', 'void'].includes(m.frame) ? m.frame : '';
      u.t1 = perk && hex(m.t1) ? m.t1 : ''; u.t2 = perk && hex(m.t2) ? m.t2 : ''; if (hex(m.color)) u.color = m.color;
      if (Date.now() - u.lastEdit > 6e4) { u.coins += 5; u.lastEdit = Date.now(); }
      give(u, 'styled'); save(); sendMe(ws); return presence();
    }
    if (m.t === 'setimg') {
      const f = m.kind === 'avatar' ? ['avatar', 'avv'] : m.kind === 'banner' ? ['bnimg', 'bnv'] : null; if (!f) return;
      if (m.data === '') { u[f[0]] = ''; u[f[1]] = 0; }
      else { const x = IMG.exec(String(m.data || '')); if (!x || x[2].length > 1.3e6) return send(ws, { t: 'notice', msg: 'Image too big (max ~900KB)' });
        if (x[1] === 'gif' && !(u.nitro || isAdmin(k))) return send(ws, { t: 'notice', msg: 'Animated GIFs need Nitro (normal images are free)' });
        u[f[0]] = m.data; u[f[1]] = Date.now(); }
      give(u, 'styled'); save(); send(ws, { t: 'imgok', kind: m.kind }); return presence();
    }
    if (m.t === 'buy') {
      if (m.item !== 'nitro' || u.nitro) return;
      if (u.coins < NITRO_PRICE) return send(ws, { t: 'notice', msg: 'Not enough coins' });
      u.coins -= NITRO_PRICE; u.nitro = true; give(u, 'nitro'); save(); sendMe(ws); return presence();
    }
    if (m.t === 'newsseen') { u.newsSeen = Date.now(); return save(); }
    if (m.t === 'postnews') {
      if (!isAdmin(k)) return;
      const title = clean(m.title, 100), text = String(m.text || '').slice(0, 2000).trim();
      const att = (Array.isArray(m.attachments) ? m.attachments : []).slice(0, 3).map(a => ({ name: clean(a && a.name, 80) || 'file', url: String((a && a.url) || '') }))
        .filter(a => /^(https:\/\/\S{3,500}|data:[\w\/.+-]{3,60};base64,[A-Za-z0-9+\/=]+)$/.test(a.url) && a.url.length < 2.2e6);
      if (!title && !text && !att.length) return;
      const post = { id: uid(), title, text, attachments: att, ts: Date.now() };
      db.news.push(post); if (db.news.length > 50) db.news.shift(); save(); return bcast({ t: 'newspost', post });
    }
    if (m.t === 'delnews') { if (!isAdmin(k)) return; db.news = db.news.filter(n => n.id !== m.id); save(); return bcast({ t: 'newsdel', id: m.id }); }
    if (m.t === 'admin') {
      if (!isAdmin(k)) return;
      const tk = String(m.target || '').toLowerCase(), tu = db.users[tk]; if (!tu) return;
      const a = m.action;
      if (a === 'givebadge') give(tu, m.value); else if (a === 'removebadge') tu.badges = tu.badges.filter(b => b !== m.value);
      else if (a === 'givenitro') { tu.nitro = true; give(tu, 'nitro'); } else if (a === 'removenitro') { tu.nitro = false; tu.badges = tu.badges.filter(b => b !== 'nitro'); }
      else if (a === 'givecoins') tu.coins += Math.max(-1e6, Math.min(1e6, parseInt(m.value) || 0));
      else if (a === 'giveall') { tu.nitro = true; Object.keys(BADGES).forEach(b => give(tu, b)); tu.coins += 100000; }
      else if (a === 'clear') tu.badges = [];
      save(); presence(); for (const c of clients) if (c.user === tk) sendMe(c); return;
    }
  });
  ws.on('close', () => { clients.delete(ws); presence(); });
  ws.on('error', () => {});
});
srv.listen(PORT, () => console.log('Exe server listening on port ' + PORT));
