/**
 * Unified Real-time Communication Adapter for MuzLoto
 * Supports both:
 * 1. Socket.IO (Local Node.js server)
 * 2. PeerJS WebRTC (GitHub Pages & Serverless Cloud Mode)
 */

window.createComm = function(role) {
  const isGitHubPages = window.location.hostname.endsWith('github.io') || window.location.protocol === 'file:';
  const hasSocketIo = (typeof io !== 'undefined') && !isGitHubPages;

  const listeners = {};
  function emitLocal(event, data) {
    (listeners[event] || []).forEach(cb => {
      try { cb(data); } catch(e) { console.error(e); }
    });
  }

  const adapter = {
    mode: hasSocketIo ? 'socket.io' : 'peerjs',
    on(event, handler) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    off(event, handler) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(h => h !== handler);
    }
  };

  // ==========================================
  // MODE 1: Socket.IO
  // ==========================================
  if (hasSocketIo) {
    const socket = io();
    adapter.socket = socket;

    socket.on('connect', () => emitLocal('connect'));
    socket.on('state', s => emitLocal('state', s));
    socket.on('card', c => emitLocal('card', c));

    if (role === 'host') {
      adapter.hostCreate = (data, cb) => socket.emit('host:create', data, cb);
      adapter.hostStart = cb => socket.emit('host:start', {}, cb);
      adapter.hostNext = cb => socket.emit('host:next', {}, cb);
      adapter.hostNewRound = cb => socket.emit('host:newround', {}, cb);
    } else {
      adapter.playerJoin = (data, cb) => socket.emit('player:join', data, cb);
      adapter.playerMark = id => socket.emit('player:mark', id);
      adapter.playerBingo = cb => socket.emit('player:bingo', {}, cb);
    }
    return adapter;
  }

  // ==========================================
  // MODE 2: PeerJS (Serverless for GitHub Pages)
  // ==========================================
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

  let peer = null;
  let roomCode = null;
  const players = new Map(); // pid -> { name, sid, card, marks, conn }
  let roomState = {
    code: '',
    state: 'lobby',
    mode: 'line',
    size: 3,
    tracks: [],
    order: [],
    called: [],
    currentTrack: null,
    winner: null,
    winnerDetails: null
  };

  function getWinInfo(r, p) {
    const n = r.size;
    const R = [...Array(n).keys()];
    const ok = idx => p.marks.has(p.card[idx]) && r.called.includes(p.card[idx]);

    if (r.mode === 'full') {
      const isFull = p.card.every((_, i) => ok(i));
      return isFull ? { win: true, winIndices: R.map((_, i) => i) } : { win: false, winIndices: [] };
    }
    for (let i = 0; i < n; i++) {
      if (R.every(j => ok(i * n + j))) return { win: true, winIndices: R.map(j => i * n + j) };
    }
    for (let j = 0; j < n; j++) {
      if (R.every(i => ok(i * n + j))) return { win: true, winIndices: R.map(i => i * n + j) };
    }
    if (R.every(j => ok(j * n + j))) return { win: true, winIndices: R.map(j => j * n + j) };
    if (R.every(j => ok(j * n + (n - 1 - j)))) return { win: true, winIndices: R.map(j => j * n + (n - 1 - j)) };
    return { win: false, winIndices: [] };
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.random() * (i + 1) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newCard(r) {
    return shuffle(r.tracks.map(t => t.id)).slice(0, r.size * r.size);
  }

  function cardOut(r, p) {
    return {
      card: p.card.map(id => {
        const tr = r.tracks.find(t => t.id === id);
        return {
          id,
          kegNum: tr ? tr.kegNum : '?',
          title: tr ? tr.title : id,
          artist: tr ? tr.artist : '',
          displayTitle: tr ? tr.displayTitle : id,
          art: tr ? tr.art : ''
        };
      }),
      marks: [...p.marks]
    };
  }

  function makePub(r) {
    return {
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
          displayTitle: tr ? tr.displayTitle : id
        };
      }),
      winner: r.winner,
      winnerDetails: r.winnerDetails || null,
      currentTrack: r.currentTrack || null,
      players: [...players.values()].map(p => ({
        name: p.name,
        online: !!p.conn && p.conn.open,
        marksCount: p.marks.size
      }))
    };
  }

  function broadcastState() {
    const pubData = makePub(roomState);
    emitLocal('state', pubData);
    for (const p of players.values()) {
      if (p.conn && p.conn.open) {
        p.conn.send({ type: 'state', data: pubData });
      }
    }
  }

  if (role === 'host') {
    adapter.hostCreate = (data, cb) => {
      const code = String(1000 + Math.random() * 9000 | 0);
      roomCode = code;
      const rawTracks = data.tracks || [];
      const tracks = rawTracks.map((t, i) => ({
        id: String(t.id || 't' + i),
        kegNum: i + 1,
        title: String(t.title || 'Песня ' + (i + 1)),
        artist: String(t.artist || ''),
        displayTitle: String(t.displayTitle || `${t.artist || ''} — ${t.title || ''}`),
        preview: t.preview || '',
        art: t.art || ''
      }));

      roomState = {
        code,
        tracks,
        size: data.size || 3,
        mode: data.mode || 'line',
        state: 'lobby',
        order: [],
        called: [],
        currentTrack: null,
        winner: null,
        winnerDetails: null
      };

      // Connect PeerJS
      const peerId = 'muzloto_' + code;
      peer = new Peer(peerId);

      peer.on('open', () => {
        cb({ code });
        broadcastState();
      });

      peer.on('error', err => {
        console.warn('PeerJS error:', err);
        // Fallback or retry
      });

      peer.on('connection', conn => {
        let playerPid = null;
        conn.on('data', msg => {
          if (!msg || !msg.type) return;

          if (msg.type === 'join') {
            const { name, pid } = msg;
            playerPid = pid || Math.random().toString(36).slice(2, 10);
            let p = players.get(playerPid);
            if (!p) {
              p = { name, card: newCard(roomState), marks: new Set(), conn };
              players.set(playerPid, p);
            } else {
              p.name = name;
              p.conn = conn;
            }
            conn.send({
              type: 'join:ack',
              data: {
                pid: playerPid,
                code: roomState.code,
                mode: roomState.mode,
                size: roomState.size,
                ...cardOut(roomState, p)
              }
            });
            broadcastState();
          } else if (msg.type === 'mark') {
            const p = players.get(playerPid);
            if (!p || roomState.state !== 'playing' || !p.card.includes(msg.id)) return;
            p.marks.has(msg.id) ? p.marks.delete(msg.id) : p.marks.add(msg.id);
            broadcastState();
          } else if (msg.type === 'bingo') {
            const p = players.get(playerPid);
            if (!p || roomState.state !== 'playing') {
              return conn.send({ type: 'bingo:ack', data: { ok: false, msg: 'Игра не идёт' } });
            }
            const winInfo = getWinInfo(roomState, p);
            if (winInfo.win) {
              roomState.state = 'finished';
              roomState.winner = p.name;
              roomState.winnerDetails = {
                name: p.name,
                card: cardOut(roomState, p),
                winIndices: winInfo.winIndices
              };
              conn.send({ type: 'bingo:ack', data: { ok: true, winner: p.name } });
              broadcastState();
            } else {
              conn.send({ type: 'bingo:ack', data: { ok: false, msg: 'Пока не бинго: отмечены не все бочонки!' } });
            }
          }
        });

        conn.on('close', () => {
          broadcastState();
        });
      });
    };

    adapter.hostStart = cb => {
      if (!roomState || roomState.state !== 'lobby') return;
      roomState.state = 'playing';
      roomState.order = shuffle(roomState.tracks.map(t => t.id));
      roomState.called = [];
      roomState.currentTrack = null;
      roomState.winner = null;
      roomState.winnerDetails = null;
      broadcastState();
      if (cb) cb();
    };

    adapter.hostNext = cb => {
      if (!roomState || roomState.state !== 'playing') return cb && cb({ error: 'not playing' });
      if (roomState.called.length >= roomState.order.length) {
        roomState.state = 'finished';
        roomState.currentTrack = null;
        broadcastState();
        return cb && cb({ end: true });
      }

      const nextId = roomState.order[roomState.called.length];
      roomState.called.push(nextId);
      const trackObj = roomState.tracks.find(t => t.id === nextId);
      const turnNumber = roomState.called.length;
      const kegNum = trackObj.kegNum;
      const nickname = LOTTO_NICKNAMES[kegNum] || null;

      roomState.currentTrack = {
        ...trackObj,
        turn: turnNumber,
        kegNum,
        nickname
      };

      broadcastState();
      if (cb) {
        cb({
          id: nextId,
          turn: turnNumber,
          n: turnNumber,
          kegNum,
          nickname,
          total: roomState.order.length,
          remaining: roomState.order.length - turnNumber,
          track: roomState.currentTrack
        });
      }
    };

    adapter.hostNewRound = cb => {
      roomState.state = 'lobby';
      roomState.called = [];
      roomState.currentTrack = null;
      roomState.winner = null;
      roomState.winnerDetails = null;
      for (const p of players.values()) {
        p.card = newCard(roomState);
        p.marks = new Set();
        if (p.conn && p.conn.open) {
          p.conn.send({ type: 'card', data: cardOut(roomState, p) });
        }
      }
      broadcastState();
      if (cb) cb();
    };
  } else {
    // PLAYER ADAPTER
    let playerConn = null;
    let pendingJoinCb = null;
    let pendingBingoCb = null;

    adapter.playerJoin = (data, cb) => {
      const code = String(data.code).trim();
      pendingJoinCb = cb;

      peer = new Peer();
      peer.on('open', () => {
        playerConn = peer.connect('muzloto_' + code);
        playerConn.on('open', () => {
          playerConn.send({ type: 'join', name: data.name, pid: data.pid });
        });

        playerConn.on('data', msg => {
          if (!msg || !msg.type) return;
          if (msg.type === 'join:ack') {
            if (pendingJoinCb) {
              pendingJoinCb(msg.data);
              pendingJoinCb = null;
            }
          } else if (msg.type === 'state') {
            emitLocal('state', msg.data);
          } else if (msg.type === 'card') {
            emitLocal('card', msg.data);
          } else if (msg.type === 'bingo:ack') {
            if (pendingBingoCb) {
              pendingBingoCb(msg.data);
              pendingBingoCb = null;
            }
          }
        });

        playerConn.on('error', err => {
          if (pendingJoinCb) {
            pendingJoinCb({ error: 'Не удалось подключиться к ТВ. Проверьте код комнаты.' });
            pendingJoinCb = null;
          }
        });
      });

      peer.on('error', err => {
        if (pendingJoinCb) {
          pendingJoinCb({ error: 'Ошибка соединения: ' + err.type });
          pendingJoinCb = null;
        }
      });
    };

    adapter.playerMark = id => {
      if (playerConn && playerConn.open) {
        playerConn.send({ type: 'mark', id });
      }
    };

    adapter.playerBingo = cb => {
      pendingBingoCb = cb;
      if (playerConn && playerConn.open) {
        playerConn.send({ type: 'bingo' });
      } else {
        cb({ ok: false, msg: 'Нет связи с ТВ' });
      }
    };
  }

  return adapter;
};
