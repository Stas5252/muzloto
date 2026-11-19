const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../comm.js'), 'utf8');
const channels = new Set();
const clients = new Set();
const tasks = new Map();
let clock = 0;
let nextTimer = 0;
let drop = () => false;

function schedule(callback, delay = 0) {
  tasks.set(++nextTimer, { time: clock + delay, callback });
  return nextTimer;
}

function advance(ms = 0) {
  const end = clock + ms;
  while (true) {
    const next = [...tasks.entries()].sort((a, b) => a[1].time - b[1].time)[0];
    if (!next || next[1].time > end) break;
    const [id, task] = next;
    tasks.delete(id);
    clock = task.time;
    task.callback();
  }
  clock = end;
}

function makeStorage() {
  const data = new Map();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, val) => data.set(key, String(val)),
    removeItem: key => data.delete(key)
  };
}

function open(role, localStorage = makeStorage(), transport = 'broadcast') {
  const contextChannels = new Set();
  class BroadcastChannel {
    constructor(topic) {
      this.topic = topic;
      contextChannels.add(this);
      channels.add(this);
    }
    postMessage(message) {
      if (drop(message)) return;
      for (const channel of channels) {
        if (channel !== this && channel.topic === this.topic) {
          schedule(() => { if (channels.has(channel)) channel.onmessage({ data: structuredClone(message) }); });
        }
      }
    }
    close() { channels.delete(this); }
  }
  const timers = new Set();
  const context = {
    window: { location: { hostname: 'example.github.io' } },
    localStorage,
    sessionStorage: makeStorage(),
    BroadcastChannel: transport === 'broadcast' ? BroadcastChannel : undefined,
    setTimeout(callback, delay) {
      const id = schedule(() => { timers.delete(id); callback(); }, delay);
      timers.add(id);
      return id;
    },
    clearTimeout(id) { tasks.delete(id); timers.delete(id); }
  };
  if (transport === 'mqtt') {
    context.mqtt = {
      connect() {
        const events = {};
        const topics = new Set();
        const client = {
          connected: false,
          publish(topic, payload) {
            const message = JSON.parse(payload);
            if (drop(message)) return;
            for (const peer of clients) {
              if (peer.topics.has(topic)) schedule(() => peer.events.message(topic, payload));
            }
          },
          subscribe(names, done) {
            const list = Array.isArray(names) ? names : [names];
            schedule(() => {
              for (const name of list) topics.add(name);
              done?.(null, list.map(topic => ({ topic, qos: 0 })));
            }, 40);
          },
          on(type, fn) { events[type] = fn; },
          end() { client.connected = false; clients.delete(client); },
          events,
          topics
        };
        clients.add(client);
        schedule(() => { client.connected = true; events.connect(); }, role === 'host' ? 1450 : 0);
        return client;
      }
    };
  }
  vm.runInNewContext(script, context);
  return {
    comm: context.window.createComm(role),
    close() {
      for (const channel of contextChannels) channel.close();
      for (const timer of timers) tasks.delete(timer);
    }
  };
}

const hostStorage = makeStorage();
const host = open('host', hostStorage);
const storage = makeStorage();
let player = open('player', storage);
const tracks = Array.from({ length: 9 }, (_, id) => ({ id: 'track-' + id }));
let room;
host.comm.hostCreate({ tracks }, res => { room = res.code; });
let state;
host.comm.on('state', value => { state = value; });
const seat = { code: room, name: 'Игрок', pid: 'test-player' };
let attempts = 0;
drop = msg => msg.type === 'join' && attempts++ === 0;
let card;
player.comm.playerJoin(seat, res => { card = res; });
advance(2500);
assert.equal(card?.pid, seat.pid, 'Retry a lost initial join');
assert.equal(state.players.length, 1, 'Retry does not add a duplicate seat');

host.comm.hostStart();
let draw;
host.comm.hostNext(res => { draw = res; });
advance();
drop = msg => msg.type === 'mark';
player.comm.playerMark({ id: draw.id, marked: true });
advance(1300);
assert.equal(state.players[0].marksCount, 0);
player.close();

drop = () => false;
player = open('player', storage);
player.comm.playerJoin(seat, res => { card = res; });
advance(1800);
assert.equal(state.players[0].marksCount, 1, 'Recover an offline mark even after reopening the player page');
assert.ok(card.marks.includes(draw.id), 'The reopened card includes the pending mark');
assert.equal(storage.getItem(`muzloto_pending_marks_${room}:${seat.pid}`), null, 'An acknowledged mark leaves the outbox');

let earlier;
drop = msg => {
  if (msg.type === 'mark' && msg.marked) earlier = structuredClone(msg);
  return false;
};
player.comm.playerMark({ id: draw.id, marked: true });
player.comm.playerMark({ id: draw.id, marked: false });
advance();
assert.equal(state.players[0].marksCount, 0);
const channel = [...channels][1];
channel.postMessage(earlier);
advance();
assert.equal(state.players[0].marksCount, 0, 'A delayed duplicate cannot undo a newer tap');

host.comm.hostNewRound();
host.comm.hostStart();
for (let index = 0; index < tracks.length; index++) host.comm.hostNext();
advance();
channel.postMessage(earlier);
advance();
assert.equal(state.players[0].marksCount, 0, 'A delayed mark from the previous round is ignored');

let bingoRequests = 0;
let bingoReplies = 0;
drop = msg => (msg.type === 'bingo' && ++bingoRequests === 1) || (msg.type === 'bingo:ack' && ++bingoReplies === 1);
let bingo;
player.comm.playerBingo({ marks: tracks.map(track => track.id) }, result => { bingo = result; });
advance(3300);
assert.equal(bingo?.ok, true, 'Retry a lost bingo request and a lost success response');
assert.equal(state.state, 'finished');
assert.equal(JSON.parse(hostStorage.getItem('muzloto_db_stats')).history.length, 1, 'A retried win is recorded once');

drop = () => false;
const mqttHost = open('host', makeStorage(), 'mqtt');
const mqttPlayer = open('player', makeStorage(), 'mqtt');
const illustratedTracks = tracks.map(track => ({
  ...track, title: 'Название песни', artist: 'Исполнитель',
  art: 'https://covers.example/' + 'illustrated-album-cover/'.repeat(14) + track.id + '.jpg'
}));
let tvState;
let phoneState;
mqttHost.comm.on('state', value => { tvState = value; });
mqttPlayer.comm.on('state', value => { phoneState = value; });
mqttHost.comm.hostCreate({ tracks: illustratedTracks }, res => { room = res.code; });
let mqttCard;
mqttPlayer.comm.playerJoin({ ...seat, code: room }, res => { mqttCard = res; });
advance(2800);
assert.equal(mqttCard?.pid, seat.pid, 'MQTT joins after asynchronous subscription and a slow host connection');

drop = msg => msg.type === 'card';
let refreshedCard;
mqttPlayer.comm.on('card', res => { refreshedCard = res; });
mqttHost.comm.hostNewRound();
advance(2000);
assert.ok(refreshedCard?.roundId > mqttCard.roundId, 'Recover a new card if the original card event was lost');

drop = msg => msg.type === 'state' && Buffer.byteLength(JSON.stringify(msg)) > 4096;
mqttHost.comm.hostStart();
for (const track of illustratedTracks) mqttHost.comm.hostNext();
advance();
mqttPlayer.comm.playerBingo({ marks: illustratedTracks.map(track => track.id) }, () => {});
advance();
assert.equal(tvState.winnerDetails.card.card.length, 9, 'The TV still receives the winning card');
assert.equal(phoneState.state, 'finished', 'The winner reaches phones over a size-limited relay');
assert.equal(phoneState.winnerPid, seat.pid);
assert.equal(phoneState.called.length, illustratedTracks.length);

let retry;
drop = msg => {
  if (msg.type === 'join') retry = structuredClone(msg);
  return false;
};
player.comm.playerJoin(seat, () => {});
advance();
player.comm.playerLeave();
advance();
assert.equal(state.players.length, 0);
// Inject a delayed join into the old room after the player's explicit exit.
const delayed = [...channels][0];
const receiver = delayed.onmessage;
receiver({ data: retry });
advance();
assert.equal(state.players.length, 0, 'A delayed retry does not reactivate a departed player');
console.log('PASS mesh: join retry, offline marks and bingo, deduplication, round isolation, MQTT subscription race, card resync and explicit leave');
