const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const QR = require('qrcode');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const app = express();
const srv = http.createServer(app);
const io = new Server(srv, { maxHttpBufferSize: 2e6, cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Russian Lotto Traditional Nicknames for Barrels
const LOTTO_NICKNAMES = {
  1: 'Кол',
  2: 'Гусь',
  3: 'Троица',
  7: 'Семёрка / Топор',
  10: 'Бычий глаз',
  11: 'Барабанные палочки',
  12: 'Дюжина',
  13: 'Чёртова дюжина',
  18: 'В первый раз',
  20: 'Гусь в шляпе',
  21: 'Очко',
  22: 'Утята / Гуси-лебеди',
  25: 'Четвертак',
  33: 'Кудрявый',
  44: 'Стульчики',
  50: 'Полтинник',
  55: 'Перчатки',
  69: 'Туда-сюда',
  77: 'Топорики',
  88: 'Бабушка',
  90: 'Дед'
};

const getPacks = () => {
  try {
    const packsPath = path.join(__dirname, 'packs.json');
    if (fs.existsSync(packsPath)) {
      return JSON.parse(fs.readFileSync(packsPath, 'utf-8'));
    }
  } catch (e) {
    console.warn('Could not load packs.json:', e.message);
  }
  return {};
};

// IP detection preferring real Wi-Fi / Ethernet LAN IP over virtual VPN/proxies
const lanIp = () => {
  const list = [];
  const ifaces = os.networkInterfaces();
  for (const [name, l] of Object.entries(ifaces)) {
    for (const i of l || []) {
      if (i.family === 'IPv4' && !i.internal) {
        list.push({ name, addr: i.address });
      }
    }
  }
  const pref = list.find(i => /^192\.168\./.test(i.addr)) ||
               list.find(i => /^10\./.test(i.addr)) ||
               list.find(i => /ethernet|wi-fi|wlan/i.test(i.name)) ||
               list[0];
  return pref ? pref.addr : 'localhost';
};

app.get('/api/info', (req, res) => {
  res.json({ lan: lanIp(), port: PORT });
});

app.get('/api/packs', (req, res) => {
  res.json(getPacks());
});

const searchCache = new Map();

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ results: [] });

  const cacheKey = q.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 3600000) {
    return res.json({ results: cached.data });
  }

  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=25`;
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error('Search provider error: ' + response.statusText);
    const data = await response.json();

    const results = (data.results || [])
      .filter(r => r.previewUrl)
      .map(r => ({
        id: String(r.trackId),
        title: r.trackName,
        artist: r.artistName,
        displayTitle: `${r.artistName} — ${r.trackName}`,
        preview: r.previewUrl,
        art: (r.artworkUrl100 || '').replace('100x100bb', '400x400bb'),
        genre: r.primaryGenreName || 'Music',
        duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 30
      }));

    searchCache.set(cacheKey, { time: Date.now(), data: results });
    res.json({ results });
  } catch (err) {
    console.warn('Live search fallback for:', q, err.message);
    const qLower = q.toLowerCase();
    const fallbackResults = [];
    const currentPacks = getPacks();
    for (const p of Object.values(currentPacks)) {
      for (const t of p.tracks || []) {
        if (t.displayTitle && t.displayTitle.toLowerCase().includes(qLower)) {
          if (!fallbackResults.some(f => f.id === t.id)) {
            fallbackResults.push(t);
          }
        }
      }
    }
    res.json({ results: fallbackResults, fallback: true });
  }
});

app.get('/qr.svg', async (req, res) => {
  try {
    const text = String(req.query.text || '').slice(0, 500);
    const svg = await QR.toString(text, { type: 'svg', margin: 1, color: { dark: '#000000', light: '#ffffff' } });
    res.type('image/svg+xml').send(svg);
  } catch (err) {
    res.status(500).send('Error generating QR');
  }
});

// Game state & rooms
const rooms = {};

const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.random() * (i + 1) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Player gets a random subset of tracks for their card
const newCard = r => shuffle(r.tracks.map(t => t.id)).slice(0, r.size * r.size);

const cardOut = (r, p) => ({
  card: p.card.map(id => {
    const tr = r.tracks.find(t => t.id === id);
    return {
      id,
      kegNum: tr ? tr.kegNum : '?',
      title: tr ? tr.title : id,
      artist: tr ? tr.artist : '',
      displayTitle: tr ? (tr.displayTitle || `${tr.artist || ''} — ${tr.title || ''}`) : id,
      art: tr ? tr.art : ''
    };
  }),
  marks: [...p.marks]
});

// Winning condition checking
function getWinInfo(r, p) {
  const n = r.size;
  const R = [...Array(n).keys()];
  const ok = idx => p.marks.has(p.card[idx]) && r.called.includes(p.card[idx]);

  if (r.mode === 'full') {
    const isFull = p.card.every((_, i) => ok(i));
    return isFull ? { win: true, winIndices: p.card.map((_, i) => i) } : { win: false, winIndices: [] };
  }

  // Rows
  for (let i = 0; i < n; i++) {
    if (R.every(j => ok(i * n + j))) {
      return { win: true, winIndices: R.map(j => i * n + j) };
    }
  }
  // Columns
  for (let j = 0; j < n; j++) {
    if (R.every(i => ok(i * n + j))) {
      return { win: true, winIndices: R.map(i => i * n + j) };
    }
  }
  // Diagonals
  if (R.every(j => ok(j * n + j))) {
    return { win: true, winIndices: R.map(j => j * n + j) };
  }
  if (R.every(j => ok(j * n + (n - 1 - j)))) {
    return { win: true, winIndices: R.map(j => j * n + (n - 1 - j)) };
  }

  return { win: false, winIndices: [] };
}

const pub = r => ({
  code: r.code,
  state: r.state,
  mode: r.mode,
  size: r.size,
  turn: r.called.length,
  calledCount: r.called.length,
  totalCount: r.tracks.length,
  remainingCount: r.tracks.length - r.called.length,
  calledHistory: r.called.map((id, idx) => {
    const tr = r.tracks.find(t => t.id === id);
    return {
      turn: idx + 1,
      kegNum: tr ? tr.kegNum : '?',
      id,
      title: tr ? tr.title : id,
      artist: tr ? tr.artist : '',
      displayTitle: tr ? tr.displayTitle : id,
      art: tr ? tr.art : ''
    };
  }),
  winner: r.winner,
  winnerPid: r.winnerPid || null,
  winnerDetails: r.winnerDetails || null,
  currentTrack: r.currentTrack || null,
  players: [...r.players.values()].map(p => ({
    name: p.name,
    online: !!p.sid,
    marksCount: p.marks.size
  }))
});

const push = r => io.to(r.code).emit('state', pub(r));

io.on('connection', s => {
  const hostRoom = () => rooms[s.data.host];

  s.on('host:create', (d, ack) => {
    const size = d.size === 4 ? 4 : 3;
    const rawTracks = Array.isArray(d.tracks) ? d.tracks.slice(0, 300) : [];
    
    // Assign each track its unique, fixed Keg Number (Бочонок № 1, № 2, № 3 ...)
    const tracks = rawTracks.map((t, i) => ({
      id: String(t.id || 't' + i),
      kegNum: i + 1,
      title: String(t.title || 'Песня ' + (i + 1)).slice(0, 150),
      artist: String(t.artist || '').slice(0, 150),
      displayTitle: String(t.displayTitle || `${t.artist || ''} — ${t.title || ''}`).slice(0, 200),
      preview: t.preview || '',
      art: t.art || ''
    }));

    if (tracks.length < size * size) {
      return ack({ error: `Нужно минимум ${size * size} треков для сетки ${size}×${size}` });
    }

    let code;
    do {
      code = String(1000 + Math.random() * 9000 | 0);
    } while (rooms[code]);

    rooms[code] = {
      code,
      tracks,
      size,
      mode: d.mode === 'full' ? 'full' : 'line',
      state: 'lobby',
      order: [],
      called: [],
      currentTrack: null,
      winner: null,
      winnerDetails: null,
      players: new Map(),
      host: s.id,
      created: Date.now()
    };

    s.data.host = code;
    s.join(code);
    ack({ code });
    push(rooms[code]);
  });

  s.on('host:start', (_, ack) => {
    if (typeof _ === 'function') { ack = _; }
    if (!ack) ack = () => {};
    const r = hostRoom();
    if (!r || r.state !== 'lobby') return ack({ error: 'not in lobby' });
    r.state = 'playing';
    // Shuffle the tracks so barrels are drawn from the bag completely at RANDOM!
    r.order = shuffle(r.tracks.map(t => t.id));
    r.called = [];
    r.currentTrack = null;
    r.winner = null;
    r.winnerPid = null;
    r.winnerDetails = null;
    push(r);
    ack({ ok: true });
  });

  s.on('host:next', (_, ack) => {
    const r = hostRoom();
    if (!r || r.state !== 'playing') return ack && ack({ error: 'Игра не идёт' });
    if (r.called.length >= r.order.length) {
      r.state = 'finished';
      r.currentTrack = null;
      push(r);
      return ack({ end: true });
    }

    // Pull next random barrel out of the bag!
    const nextId = r.order[r.called.length];
    r.called.push(nextId);
    const trackObj = r.tracks.find(t => t.id === nextId);
    const turnNumber = r.called.length;
    const kegNum = trackObj.kegNum;
    const nickname = LOTTO_NICKNAMES[kegNum] || null;

    r.currentTrack = {
      ...trackObj,
      turn: turnNumber,
      kegNum,
      nickname
    };

    push(r);
    ack({
      id: nextId,
      turn: turnNumber,
      n: turnNumber,
      kegNum,
      nickname,
      total: r.order.length,
      remaining: r.order.length - turnNumber,
      track: r.currentTrack
    });
  });

  s.on('host:newround', (_, ack) => {
    if (typeof _ === 'function') { ack = _; }
    if (!ack) ack = () => {};
    const r = hostRoom();
    if (!r) return ack({ error: 'no room' });
    r.state = 'lobby';
    r.called = [];
    r.currentTrack = null;
    r.winner = null;
    r.winnerPid = null;
    r.winnerDetails = null;
    for (const p of r.players.values()) {
      p.card = newCard(r);
      p.marks = new Set();
      if (p.sid) io.to(p.sid).emit('card', cardOut(r, p));
    }
    push(r);
    ack({ ok: true });
  });

  s.on('host:resume', (_, ack) => {
    if (typeof _ === 'function') { ack = _; }
    if (!ack) ack = () => {};
    const r = hostRoom();
    if (!r) return ack({ error: 'no room' });
    r.state = 'playing';
    r.winner = null;
    r.winnerPid = null;
    r.winnerDetails = null;
    push(r);
    ack({ ok: true });
  });

  s.on('player:join', (d, ack) => {
    if (!ack) ack = () => {};
    const r = rooms[String(d && d.code)];
    if (!r) return ack({ error: 'Комната не найдена. Проверьте 4-значный код.' });
    const name = String((d && d.name) || '').trim().slice(0, 20);
    if (!name) return ack({ error: 'Пожалуйста, введите ваше имя' });

    let pid = (d && d.pid) ? String(d.pid).trim() : null;
    let p = pid ? r.players.get(pid) : null;

    // Prevent cross-session collisions: if existing PID belongs to another active socket, assign new PID
    if (p && p.sid && p.sid !== s.id) {
      pid = null;
      p = null;
    }

    if (!p) {
      pid = pid || ('p_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now().toString(36));
      p = { name, card: newCard(r), marks: new Set() };
      r.players.set(pid, p);
    }
    p.name = name;
    p.sid = s.id;
    s.data.room = r.code;
    s.data.pid = pid;
    s.join(r.code);

    ack({
      pid,
      code: r.code,
      mode: r.mode,
      size: r.size,
      ...cardOut(r, p)
    });
    push(r);
  });

  s.on('player:mark', d => {
    const r = rooms[s.data.room];
    const p = r && r.players.get(s.data.pid);
    if (!p || r.state !== 'playing') return;

    let id;
    let explicitMark = null;
    if (typeof d === 'object' && d !== null) {
      id = d.id;
      if (typeof d.marked === 'boolean') explicitMark = d.marked;
    } else {
      id = d;
    }

    if (!id || !p.card.includes(id)) return;

    if (explicitMark !== null) {
      if (explicitMark) p.marks.add(id);
      else p.marks.delete(id);
    } else {
      if (p.marks.has(id)) p.marks.delete(id);
      else p.marks.add(id);
    }
    push(r);
  });

  s.on('player:bingo', (d, ack) => {
    if (typeof d === 'function') {
      ack = d;
      d = {};
    }
    if (!ack) ack = () => {};
    const r = rooms[s.data.room];
    const p = r && r.players.get(s.data.pid);
    if (!p) {
      return ack({ ok: false, msg: 'Игрок не найден в комнате' });
    }
    if (r.state === 'finished') {
      return ack({ ok: false, msg: `Игра уже завершена! Победитель: ${r.winner || 'Определён'}` });
    }
    if (r.state !== 'playing') {
      return ack({ ok: false, msg: 'Игра сейчас не идёт' });
    }

    // Safely reconcile client-reported marks with called barrels (never allows uncalled tracks)
    if (d && Array.isArray(d.marks)) {
      for (const mId of d.marks) {
        if (p.card.includes(mId) && r.called.includes(mId)) {
          p.marks.add(mId);
        }
      }
    }

    const winInfo = getWinInfo(r, p);
    if (winInfo.win) {
      r.state = 'finished';
      r.winner = p.name;
      r.winnerPid = p.pid;
      r.winnerDetails = {
        name: p.name,
        pid: p.pid,
        card: cardOut(r, p),
        winIndices: winInfo.winIndices
      };
      push(r);
      ack({ ok: true, winner: p.name, pid: p.pid });
    } else {
      ack({ ok: false, msg: 'Пока не бинго! Проверьте: все ли отмеченные бочонки уже выпали на ТВ?' });
    }
  });

  s.on('disconnect', () => {
    const r = rooms[s.data.room];
    const p = r && r.players.get(s.data.pid);
    if (p && p.sid === s.id) {
      p.sid = null;
      push(r);
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const c in rooms) {
    if (now - rooms[c].created > 12 * 3600 * 1000) {
      delete rooms[c];
    }
  }
}, 600 * 1000);

srv.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵 МузЛото сервер запущен`);
  console.log(`ТВ / Ведущий: http://localhost:${PORT}/tv.html`);
  console.log(`Игроки:       http://${lanIp()}:${PORT}/play.html\n`);
});
