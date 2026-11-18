export const validRoom = room => /^[a-f0-9]{24}$/.test(room || '');
export const token = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), n => n.toString(16).padStart(2, '0')).join('');

function loadSocket() {
  if (window.io) return Promise.resolve(window.io);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onload = () => window.io ? resolve(window.io) : reject();
    script.onerror = reject;
    document.head.append(script);
  });
}

export function connectRoom(room, receive, changed) {
  const active = new Set();
  const senders = new Map();
  const stops = [];
  let ended = false;
  const key = 'vne-ocheredi-' + room;
  const arrive = message => {
    if (!ended && message?.room === room && ['player', 'state'].includes(message.type)) receive(message);
  };
  function status(name, connected) {
    if (ended || active.has(name) === connected) return;
    if (connected) active.add(name);
    else active.delete(name);
    changed([...active]);
  }

  if ('BroadcastChannel' in window) {
    const local = new BroadcastChannel(key);
    local.onmessage = event => arrive(event.data);
    senders.set('browser', message => local.postMessage(message));
    stops.push(() => local.close());
  }

  async function attachLan() {
    try {
      const io = await loadSocket();
      if (ended) return;
      const socket = io('/party-quiz', { timeout: 3500 });
      socket.on('connect', () => socket.emit('quiz:join', room, ok => status('lan', ok === true)));
      socket.on('disconnect', () => status('lan', false));
      socket.on('quiz:frame', arrive);
      senders.set('lan', message => socket.emit('quiz:frame', message));
      stops.push(() => socket.disconnect());
    } catch {}
  }

  function attachRealtime() {
    const config = window.MUZLOTO_CLOUD_AUDIO;
    if (!config?.url || !config.key) return;
    const endpoint = new URL('/realtime/v1/websocket', config.url);
    endpoint.protocol = 'wss:';
    endpoint.searchParams.set('apikey', config.key);
    endpoint.searchParams.set('vsn', '1.0.0');
    const topic = 'realtime:' + key;
    let ws, heartbeat, retry, deadline;
    let sequence = 0;
    let heartbeatRef = null;
    let joinRef = null;
    const write = (event, payload, target = topic, ref = String(++sequence)) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ topic: target, event, payload, ref, join_ref: target === topic ? joinRef : null }));
      }
      return ref;
    };
    function open() {
      if (ended) return;
      ws = new WebSocket(endpoint.href);
      deadline = setTimeout(() => ws.close(), 6500);
      ws.onopen = () => {
        joinRef = String(++sequence);
        write('phx_join', { config: { broadcast: { self: false, ack: false }, presence: { enabled: false }, private: false } }, topic, joinRef);
      };
      ws.onmessage = ({ data }) => {
        let packet;
        try { packet = JSON.parse(data); } catch { return; }
        if (packet.event === 'phx_reply' && packet.ref === joinRef) {
          if (packet.payload?.status !== 'ok') { ws.close(); return; }
          clearTimeout(deadline);
          status('realtime', true);
        } else if (packet.event === 'phx_reply' && packet.ref === heartbeatRef) {
          heartbeatRef = null;
        } else if (packet.topic === topic && packet.event === 'broadcast' && packet.payload?.event === 'quiz') {
          arrive(packet.payload.payload);
        } else if (packet.topic === topic && ['phx_error', 'phx_close'].includes(packet.event)) {
          ws.close();
        }
      };
      ws.onclose = () => {
        status('realtime', false);
        clearTimeout(deadline);
        clearInterval(heartbeat);
        heartbeatRef = null;
        if (!ended) retry = setTimeout(open, 2400);
      };
      heartbeat = setInterval(() => {
        if (heartbeatRef) { ws.close(); return; }
        heartbeatRef = write('heartbeat', {}, 'phoenix');
      }, 25000);
    }
    senders.set('realtime', message => write('broadcast', { type: 'broadcast', event: 'quiz', payload: message }));
    stops.push(() => { clearTimeout(retry); clearTimeout(deadline); clearInterval(heartbeat); ws?.close(); });
    open();
  }

  function attachMqtt() {
    if (!window.mqtt) return;
    const topic = 'muzloto/party-quiz/' + room;
    const client = window.mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
      clientId: 'vq_' + token().slice(0, 18), connectTimeout: 6500, reconnectPeriod: 3500, resubscribe: false
    });
    client.on('error', () => status('mqtt', false));
    client.on('close', () => status('mqtt', false));
    client.on('connect', () => client.subscribe(topic, (error, grants) => {
      status('mqtt', !error && client.connected && grants?.[0]?.qos === 0);
    }));
    client.on('message', (name, data) => {
      if (name !== topic) return;
      try { arrive(JSON.parse(data.toString())); } catch {}
    });
    senders.set('mqtt', message => client.publish(topic, JSON.stringify(message)));
    stops.push(() => client.end(true));
  }

  if (location.hostname.endsWith('.github.io')) {
    attachRealtime();
    attachMqtt();
  } else {
    attachLan();
  }

  return {
    send(message) {
      const frame = { ...message, room };
      for (const [name, send] of senders) {
        if (name === 'browser' || active.has(name)) send(frame);
      }
    },
    close() {
      ended = true;
      for (const stop of stops) stop();
    }
  };
}
