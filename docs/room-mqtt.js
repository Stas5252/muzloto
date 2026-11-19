(function () {
  'use strict';
  const brokers = ['wss://broker.emqx.io:8084/mqtt', 'wss://mqtt.iotbhai.io/mqtt'];

  window.connectRoomMqtt = function (topics, receive, ready, changed) {
    if (typeof mqtt === 'undefined') return null;
    const clients = [];
    const active = new Set();
    let closed = false;
    const publishTo = (client, topic, message) => {
      try { client.publish(topic, JSON.stringify(message)); } catch {}
    };
    for (const url of brokers) {
      let client;
      try {
        client = mqtt.connect(url, {
          clientId: 'muz_' + Math.random().toString(36).slice(2, 13),
          clean: true, connectTimeout: 5000, reconnectPeriod: 3000, resubscribe: false
        });
      } catch { continue; }
      clients.push(client);
      const disconnect = () => { if (active.delete(client) && !active.size) changed?.(false); };
      client.on('error', disconnect);
      client.on('close', disconnect);
      client.on('connect', () => client.subscribe(topics, (error, grants) => {
        if (closed || !client.connected || error || !grants || grants.length !== topics.length ||
            grants.some(grant => grant.qos > 2)) return;
        const wasConnected = active.size > 0;
        active.add(client);
        if (!wasConnected) changed?.(true);
        ready?.((topic, message) => publishTo(client, topic, message));
      }));
      client.on('message', (topic, data) => {
        if (!closed && topics.includes(topic)) {
          try { receive(JSON.parse(data.toString())); } catch {}
        }
      });
    }
    return {
      get connected() { return active.size > 0; },
      publish(topic, message) {
        for (const client of active) publishTo(client, topic, message);
      },
      close() {
        closed = true;
        active.clear();
        for (const client of clients) client.end(true);
      }
    };
  };
})();
