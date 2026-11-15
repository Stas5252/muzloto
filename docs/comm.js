/**
 * Unified Multi-Channel Real-time Communication Adapter for MuzLoto
 * Supports:
 * 1. Socket.IO (Local Node.js server)
 * 2. BroadcastChannel (Instant zero-latency cross-tab communication)
 * 3. MQTT WebSockets (Public cloud pub/sub broker for reliable multi-device mobile play)
 * 4. PeerJS (WebRTC P2P direct data channels)
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
    mode: hasSocketIo ? 'socket.io' : 'cloud-mesh',
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
  // MODE 1: Socket.IO (Local Server)
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
      adapter.hostResume = cb => socket.emit('host:resume', {}, cb);
    } else {
      adapter.playerJoin = (data, cb) => socket.emit('player:join', data, cb);
      adapter.playerMark = arg => socket.emit('player:mark', arg);
      adapter.playerBingo = (arg, cb) => {
        if (typeof arg === 'function') { cb = arg; arg = {}; }
        socket.emit('player:bingo', arg || {}, cb);
      };
    }
    return adapter;
  }

  // ==========================================
  // MODE 2: Multi-Channel Cloud Mesh (GitHub Pages)
  // Combines BroadcastChannel + MQTT + PeerJS
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

  let roomCode = null;
  const players = new Map(); // pid -> { name, card, marks, conn, sendFn }
  let roomState = {
    code: '',
    state: 'lobby',
    mode: 'full',
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
      return isFull ? { win: true, winIndices: p.card.map((_, i) => i) } : { win: false, winIndices: [] };
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
          displayTitle: tr ? tr.displayTitle : id,
          art: tr ? tr.art : ''
        };
      }),
      winner: r.winner,
      winnerPid: r.winnerPid || null,
      winnerDetails: r.winnerDetails || null,
      currentTrack: r.currentTrack || null,
      players: [...players.values()].map(p => ({
        name: p.name,
        online: true,
        marksCount: p.marks.size
      }))
    };
  }

  let broadcastChan = null;
  let mqttClient = null;
  let peerInstance = null;

  function broadcastState() {
    const pubData = makePub(roomState);
    emitLocal('state', pubData);

    const payload = JSON.stringify({ type: 'state', data: pubData });

    // 1. BroadcastChannel
    if (broadcastChan) {
      try { broadcastChan.postMessage({ type: 'state', data: pubData }); } catch(e) {}
    }

    // 2. MQTT
    if (mqttClient && mqttClient.connected) {
      try { mqttClient.publish(`muzloto/${roomCode}/host_to_client`, payload); } catch(e) {}
    }

    // 3. PeerJS connections
    for (const p of players.values()) {
      if (p.conn && p.conn.open) {
        try { p.conn.send({ type: 'state', data: pubData }); } catch(e) {}
      }
    }
  }

  function sendToPlayer(targetPid, message) {
    message.targetPid = targetPid;
    // 1. BroadcastChannel (Filtered locally by targetPid on recipient)
    if (broadcastChan) {
      try { broadcastChan.postMessage(message); } catch(e) {}
    }
    // 2. MQTT (Direct to player's private topic only!)
    if (mqttClient && mqttClient.connected) {
      const payload = JSON.stringify(message);
      try { mqttClient.publish(`muzloto/${roomCode}/to_player/${targetPid}`, payload); } catch(e) {}
    }
    // 3. PeerJS
    const p = players.get(targetPid);
    if (p && p.conn && p.conn.open) {
      try { p.conn.send(message); } catch(e) {}
    }
  }

  // Common message handler for Host
  function handleHostMessage(msg, senderConn) {
    if (!msg || !msg.type) return;

    if (msg.type === 'join') {
      const { name, pid } = msg;
      const playerPid = (pid && String(pid).trim()) || ('p_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36));
      let p = players.get(playerPid);
      if (!p) {
        p = { name, pid: playerPid, card: newCard(roomState), marks: new Set(), conn: senderConn };
        players.set(playerPid, p);
      } else {
        p.name = name;
        if (senderConn) p.conn = senderConn;
      }
      sendToPlayer(playerPid, {
        type: 'join:ack',
        targetPid: playerPid,
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
      const p = players.get(msg.pid);
      if (!p || roomState.state !== 'playing') return;
      const trackId = (typeof msg.id === 'object' && msg.id !== null) ? msg.id.id : msg.id;
      if (!trackId || !p.card.includes(trackId)) return;

      if (typeof msg.marked === 'boolean') {
        if (msg.marked) p.marks.add(trackId);
        else p.marks.delete(trackId);
      } else {
        p.marks.has(trackId) ? p.marks.delete(trackId) : p.marks.add(trackId);
      }
      broadcastState();
    } else if (msg.type === 'bingo') {
      const p = players.get(msg.pid);
      if (!p) {
        return sendToPlayer(msg.pid, {
          type: 'bingo:ack',
          targetPid: msg.pid,
          data: { ok: false, msg: 'Игрок не найден в комнате' }
        });
      }
      if (roomState.state === 'finished') {
        return sendToPlayer(msg.pid, {
          type: 'bingo:ack',
          targetPid: msg.pid,
          data: { ok: false, msg: `Игра уже завершена! Победитель: ${roomState.winner || 'Определён'}` }
        });
      }
      if (roomState.state !== 'playing') {
        return sendToPlayer(msg.pid, {
          type: 'bingo:ack',
          targetPid: msg.pid,
          data: { ok: false, msg: 'Игра сейчас не идёт' }
        });
      }
      // Reconcile client-reported marks safely with called barrels
      if (msg.marks && Array.isArray(msg.marks)) {
        for (const mId of msg.marks) {
          if (p.card.includes(mId) && roomState.called.includes(mId)) {
            p.marks.add(mId);
          }
        }
      }
      const winInfo = getWinInfo(roomState, p);
      if (winInfo.win) {
        roomState.state = 'finished';
        roomState.winner = p.name;
        roomState.winnerPid = p.pid;
        roomState.winnerDetails = {
          name: p.name,
          pid: p.pid,
          card: cardOut(roomState, p),
          winIndices: winInfo.winIndices
        };
        sendToPlayer(p.pid, {
          type: 'bingo:ack',
          targetPid: p.pid,
          data: { ok: true, winner: p.name, pid: p.pid }
        });
        broadcastState();
      } else {
        sendToPlayer(p.pid, {
          type: 'bingo:ack',
          targetPid: p.pid,
          data: { ok: false, msg: 'Пока не бинго: отмечены не все выпавшие бочонки!' }
        });
      }
    }
  }

  // ==========================================
  // HOST IMPLEMENTATION
  // ==========================================
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
        mode: data.mode || 'full',
        state: 'lobby',
        order: [],
        called: [],
        currentTrack: null,
        winner: null,
        winnerDetails: null
      };

      // 1. Instant local callback: Transition to lobby immediately!
      if (cb) cb({ code });
      broadcastState();

      // 2. BroadcastChannel setup (instant tab communication on same browser)
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          broadcastChan = new BroadcastChannel('muzloto_' + code);
          broadcastChan.onmessage = ev => {
            const msg = ev.data;
            handleHostMessage(msg);
          };
        }
      } catch(e) { console.warn('BroadcastChannel error:', e); }

      // 3. MQTT WebSockets setup (bypasses all NATs, cellular networks, firewalls)
      try {
        if (typeof mqtt !== 'undefined') {
          const clientId = 'host_' + Math.random().toString(16).slice(2, 10);
          mqttClient = mqtt.connect('wss://broker.emqx.io:8084/mqtt', { clientId, clean: true, reconnectPeriod: 3000 });
          mqttClient.on('connect', () => {
            mqttClient.subscribe(`muzloto/${code}/client_to_host`);
            broadcastState();
          });
          mqttClient.on('message', (topic, message) => {
            try {
              const msg = JSON.parse(message.toString());
              handleHostMessage(msg);
            } catch(e) {}
          });
        }
      } catch(e) { console.warn('MQTT setup error:', e); }

      // 4. PeerJS WebRTC channel setup
      try {
        if (typeof Peer !== 'undefined') {
          const peerId = 'muzloto_' + code;
          peerInstance = new Peer(peerId);
          peerInstance.on('connection', conn => {
            conn.on('data', msg => {
              handleHostMessage(msg, conn);
            });
          });
          peerInstance.on('error', err => console.warn('PeerJS notice:', err));
        }
      } catch(e) { console.warn('PeerJS error:', e); }
    };

    adapter.hostStart = cb => {
      if (!roomState || roomState.state !== 'lobby') return;
      roomState.state = 'playing';
      roomState.order = shuffle(roomState.tracks.map(t => t.id));
      roomState.called = [];
      roomState.currentTrack = null;
      roomState.winner = null;
      roomState.winnerPid = null;
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
      roomState.winnerPid = null;
      roomState.winnerDetails = null;
      for (const p of players.values()) {
        p.card = newCard(roomState);
        p.marks = new Set();
        sendToPlayer(p.pid, {
          type: 'card',
          targetPid: p.pid,
          data: cardOut(roomState, p)
        });
      }
      broadcastState();
      if (cb) cb();
    };

    adapter.hostResume = cb => {
      if (!roomState) return;
      roomState.state = 'playing';
      roomState.winner = null;
      roomState.winnerPid = null;
      roomState.winnerDetails = null;
      broadcastState();
      if (cb) cb();
    };

  } else {
    // ==========================================
    // PLAYER IMPLEMENTATION
    // ==========================================
    let playerPid = null;
    let joinedRoomCode = null;
    let pendingJoinCb = null;
    let pendingBingoCb = null;
    let playerConn = null;

    function getPlayerPid() {
      if (playerPid) return playerPid;
      try {
        let sp = sessionStorage.getItem('muzloto_session_pid');
        if (!sp) {
          sp = 'p_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
          sessionStorage.setItem('muzloto_session_pid', sp);
        }
        playerPid = sp;
      } catch(e) {
        playerPid = 'p_' + Math.random().toString(36).slice(2, 10);
      }
      return playerPid;
    }

    function sendToHost(msg) {
      const myPid = getPlayerPid();
      msg.pid = myPid;
      const payload = JSON.stringify(msg);

      // 1. BroadcastChannel
      if (broadcastChan) {
        try { broadcastChan.postMessage(msg); } catch(e) {}
      }
      // 2. MQTT
      if (mqttClient && mqttClient.connected && joinedRoomCode) {
        try { mqttClient.publish(`muzloto/${joinedRoomCode}/client_to_host`, payload); } catch(e) {}
      }
      // 3. PeerJS
      if (playerConn && playerConn.open) {
        try { playerConn.send(msg); } catch(e) {}
      }
    }

    function handleIncomingPlayerMessage(msg) {
      if (!msg || !msg.type) return;

      // Broadcast state is for all players
      if (msg.type === 'state') {
        emitLocal('state', msg.data);
        return;
      }

      const myPid = getPlayerPid();
      // Drop ALL unicast messages not strictly addressed to my PID!
      if (!msg.targetPid || msg.targetPid !== myPid) {
        return;
      }

      if (msg.type === 'join:ack') {
        if (msg.data && msg.data.pid) {
          playerPid = msg.data.pid;
          try {
            sessionStorage.setItem('muzloto_session_pid', playerPid);
            if (joinedRoomCode) sessionStorage.setItem('muzloto_session_pid_' + joinedRoomCode, playerPid);
          } catch(e) {}
        }
        if (pendingJoinCb) {
          pendingJoinCb(msg.data);
          pendingJoinCb = null;
        }
      } else if (msg.type === 'card') {
        emitLocal('card', msg.data);
      } else if (msg.type === 'bingo:ack') {
        if (pendingBingoCb) {
          pendingBingoCb(msg.data);
          pendingBingoCb = null;
        }
      }
    }

    adapter.playerJoin = (data, cb) => {
      const code = String(data.code).trim();
      joinedRoomCode = code;
      pendingJoinCb = cb;

      const myPid = (data && data.pid) || getPlayerPid();
      playerPid = myPid;
      try {
        sessionStorage.setItem('muzloto_session_pid', myPid);
        sessionStorage.setItem('muzloto_session_pid_' + code, myPid);
      } catch(e) {}

      const joinPayload = { type: 'join', name: data.name, pid: myPid };

      // 1. BroadcastChannel (Instant on same machine/browser tabs)
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          broadcastChan = new BroadcastChannel('muzloto_' + code);
          broadcastChan.onmessage = ev => handleIncomingPlayerMessage(ev.data);
          broadcastChan.postMessage(joinPayload);
        }
      } catch(e) {}

      // 2. MQTT WebSockets (Public mobile mesh)
      try {
        if (typeof mqtt !== 'undefined') {
          const clientId = 'p_' + myPid.slice(-8) + '_' + Math.random().toString(16).slice(2, 6);
          mqttClient = mqtt.connect('wss://broker.emqx.io:8084/mqtt', { clientId, clean: true, reconnectPeriod: 3000 });
          mqttClient.on('connect', () => {
            mqttClient.subscribe(`muzloto/${code}/host_to_client`);
            mqttClient.subscribe(`muzloto/${code}/to_player/${myPid}`);
            mqttClient.publish(`muzloto/${code}/client_to_host`, JSON.stringify(joinPayload));
          });
          mqttClient.on('message', (topic, message) => {
            try {
              const msg = JSON.parse(message.toString());
              handleIncomingPlayerMessage(msg);
            } catch(e) {}
          });
        }
      } catch(e) {}

      // 3. PeerJS (WebRTC P2P fallback)
      try {
        if (typeof Peer !== 'undefined') {
          peerInstance = new Peer();
          peerInstance.on('open', () => {
            playerConn = peerInstance.connect('muzloto_' + code);
            playerConn.on('open', () => {
              playerConn.send(joinPayload);
            });
            playerConn.on('data', msg => handleIncomingPlayerMessage(msg));
          });
        }
      } catch(e) {}

      // Safety timeout in case room code does not exist
      setTimeout(() => {
        if (pendingJoinCb) {
          pendingJoinCb({ error: 'Не удалось найти комнату #' + code + '. Проверьте 4 цифры на экране ТВ.' });
          pendingJoinCb = null;
        }
      }, 7000);
    };

    adapter.playerMark = arg => {
      let id, marked;
      if (typeof arg === 'object' && arg !== null) {
        id = arg.id;
        marked = arg.marked;
      } else {
        id = arg;
      }
      sendToHost({ type: 'mark', id, marked });
    };

    adapter.playerBingo = (arg, cb) => {
      let marks = [];
      let callback = cb;
      if (typeof arg === 'function') {
        callback = arg;
      } else if (arg && Array.isArray(arg.marks)) {
        marks = arg.marks;
      }
      pendingBingoCb = callback;
      sendToHost({ type: 'bingo', marks });
    };
  }

  return adapter;
};
