const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'muzloto-server-regression-'));
  const repo = path.join(__dirname, '..');
  fs.copyFileSync(path.join(repo, 'server.js'), path.join(directory, 'server.js'));
  const port = 3027;
  const url = 'http://127.0.0.1:' + port;
  const env = { ...process.env, PORT: String(port), NODE_PATH: path.join(repo, 'node_modules') };
  let server;
  const clients = [];
  async function start() {
    server = spawn(process.execPath, [path.join(directory, 'server.js')], { env, windowsHide: true });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Server startup timeout')), 8000);
      server.once('exit', () => { clearTimeout(timer); reject(Error('Server stopped before startup')); });
      server.stdout.on('data', chunk => {
        if (String(chunk).includes(':' + port)) { clearTimeout(timer); resolve(); }
      });
      server.stderr.on('data', chunk => process.stderr.write(chunk));
    });
  }
  async function connect() {
    const client = io(url, { forceNew: true, reconnection: false });
    clients.push(client);
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
    return client;
  }
  const ack = (client, event, data = {}) => client.timeout(3000).emitWithAck(event, data);
  try {
    await start();
    const host = await connect();
    const player = await connect();
    const stranger = await connect();
    const tracks = Array.from({ length: 9 }, (_, i) => ({ id: 'track_' + i, title: 'Track ' + i }));
    const room = await ack(host, 'host:create', { tracks, mode: 'full', size: 3 });
    const stolen = await ack(stranger, 'host:restore', { code: room.code });
    assert.ok(stolen.error, 'Room code alone must not grant host control');
    const joined = await ack(player, 'player:join', { code: room.code, name: 'Same winner', pid: 'same_player' });
    assert.equal(joined.nextTrack, undefined, 'Only the host receives the next track');
    const sameName = await ack(stranger, 'player:join', { code: room.code, name: 'Same winner', pid: 'other_player' });
    assert.notEqual(sameName.pid, joined.pid, 'Nicknames do not identify player seats');
    assert.equal((await ack(stranger, 'player:leave')).ok, true);
    assert.equal((await ack(player, 'player:leave')).ok, true);
    const returned = await ack(player, 'player:join', { code: room.code, name: 'Same winner', pid: joined.pid });
    assert.deepEqual(returned, joined, 'Returning to the same seat restores its card');
    await ack(stranger, 'player:join', { code: room.code, name: 'Leaving', pid: 'leaving_player' });
    assert.equal((await ack(stranger, 'player:leave')).ok, true);
    assert.equal((await ack(host, 'host:restore', { code: room.code })).state.players.length, 1);
    for (let round = 1; round <= 2; round++) {
      if (round > 1) await ack(host, 'host:newround');
      await ack(host, 'host:start');
      let expectedTrack;
      for (let i = 0; i < 9; i++) {
        const draw = await ack(host, 'host:next');
        if (i > 0) assert.equal(draw.id, expectedTrack);
        expectedTrack = draw.nextTrack?.id;
      }
      assert.equal(expectedTrack, undefined, 'There is no next track at the end of a round');
      assert.equal((await ack(player, 'player:bingo', { marks: joined.card.map(t => t.id) })).ok, true);
      assert.equal((await ack(player, 'player:bingo', { marks: joined.card.map(t => t.id) })).ok, false,
        'Duplicate claim in one round must not count as another victory');
      assert.equal((await ack(host, 'host:resume')).ok, true);
      assert.equal((await ack(player, 'player:bingo', { marks: joined.card.map(t => t.id) })).ok, false,
        'A winner must not win the continued round again');
    }
    let stats = await (await fetch(url + '/api/stats')).json();
    assert.equal(stats.history.length, 2, 'Two fast rounds by the same winner must both be recorded');
    assert.equal(stats.leaderboard[0].wins, 2);
    for (const name of ['__proto__', 'constructor']) {
      const extra = await connect();
      const extraRoom = await ack(host, 'host:create', { tracks, mode: 'full', size: 3 });
      const seat = await ack(extra, 'player:join', { code: extraRoom.code, name });
      await ack(host, 'host:start');
      for (let i = 0; i < 9; i++) await ack(host, 'host:next');
      assert.equal((await ack(extra, 'player:bingo', { marks: seat.card.map(t => t.id) })).ok, true);
      stats = await (await fetch(url + '/api/stats')).json();
      assert.equal(stats.leaderboard.find(item => item.name === name)?.wins, 1,
        'Special player names must be recorded as ordinary names: ' + name);
    }
    // Lobby settings keep the room and its players; an ended game refuses new players.
    {
      const guest = await connect();
      const stranger = await connect();
      const party = await ack(host, 'host:create', { tracks, mode: 'full', size: 3 });
      const seat = await ack(guest, 'player:join', { code: party.code, name: 'Гость' });
      assert.equal(seat.card.length, 9);
      const dealt = new Promise(resolve => guest.once('card', resolve));
      assert.equal((await ack(stranger, 'host:update', { tracks, mode: 'line', size: 4 })).ok, undefined, 'Only the host changes settings');
      const longer = Array.from({ length: 16 }, (_, i) => ({ id: 'u' + i, title: 'Песня ' + i, artist: 'Артист' }));
      const updated = await ack(host, 'host:update', { tracks: longer, mode: 'line', size: 4 });
      assert.deepEqual([updated.ok, updated.code], [true, party.code], 'New settings keep the room code');
      assert.equal((await dealt).card.length, 16, 'A player in the lobby gets a card for the new settings');
      assert.match((await ack(host, 'host:update', { tracks: longer.slice(0, 5), size: 3 })).error, /минимум 9/);
      await ack(host, 'host:start');
      assert.ok((await ack(host, 'host:update', { tracks: longer, size: 4 })).error, 'Settings are fixed once the round starts');
      const closed = new Promise(resolve => guest.on('state', state => state.state === 'closed' && resolve(state)));
      assert.equal((await ack(stranger, 'host:close')).ok, undefined, 'Only the host ends the game');
      assert.equal((await ack(host, 'host:close')).ok, true);
      assert.equal((await closed).code, party.code, 'Players are told that the game has ended');
      assert.match((await ack(stranger, 'player:join', { code: party.code, name: 'Поздно' })).error, /уже завершена/);
    }
    clients.forEach(client => client.disconnect());
    await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
    await start();
    stats = await (await fetch(url + '/api/stats')).json();
    assert.equal(stats.history.length, 4, 'Restart must retain distinct rounds with the same room, winner and draw');
    console.log('PASS server: host authentication, duplicate bingo rejected, consecutive victories, lobby settings, ended game and restart persistence');
  } finally {
    clients.forEach(client => client.disconnect());
    if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
