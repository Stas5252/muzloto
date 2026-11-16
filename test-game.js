const assert = require('node:assert/strict');
const { io } = require('socket.io-client');

async function run() {
  let host = io('http://localhost:3000');
  const player = io('http://localhost:3000');

  await new Promise(r => host.on('connect', r));
  await new Promise(r => player.on('connect', r));
  console.log('Sockets connected');

  // 1. Create room
  const tracks = Array.from({ length: 15 }, (_, i) => ({ id: 't' + i, title: 'Song ' + (i + 1) }));
  const room = await new Promise(res => host.emit('host:create', { tracks, size: 3, mode: 'line' }, res));
  console.log('Room created with code:', room.code);

  // 2. Player joins
  const joined = await new Promise(res => player.emit('player:join', { code: room.code, name: 'Tester' }, res));
  console.log('Player Tester joined. Card length:', joined.card.length);
  console.log('Card tracks:', joined.card.map(c => c.title).join(', '));

  host.disconnect();
  host = io('http://localhost:3000');
  await new Promise(r => host.on('connect', r));
  const restored = await host.timeout(3000).emitWithAck('host:restore', {
    code: room.code,
    hostToken: room.hostToken
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.state.code, room.code);

  // 3. Start game
  const playingPromise = new Promise(res => {
    const handler = s => {
      if (s.state === 'playing') {
        player.off('state', handler);
        res(s);
      }
    };
    player.on('state', handler);
  });
  host.emit('host:start');
  await playingPromise;
  console.log('Game state is now playing');

  // Let's win: top row of Tester's 3x3 card
  const winLine = [joined.card[0].id, joined.card[1].id, joined.card[2].id];
  console.log('Win line IDs:', winLine);

  let finishedPromise = new Promise(res => {
    player.on('state', s => {
      if (s.state === 'finished') res(s);
    });
  });

  // Host calls tracks until all winLine tracks have been called
  let calls = 0;
  while (calls < 15) {
    const next = await new Promise(res => host.emit('host:next', {}, res));
    if (next.end) break;
    calls++;
    console.log(`Track called (#${next.n}): ${next.id}`);

    if (winLine.includes(next.id)) {
      player.emit('player:mark', next.id);
      console.log(`-> Tester marked ${next.id}`);
    }

    // Try bingo
    const checkBingo = await new Promise(res => player.emit('player:bingo', {}, res));
    if (checkBingo.ok) {
      console.log('-> BINGO claimed and approved by server!');
      break;
    }
  }

  const finalState = await finishedPromise;
  assert.equal(finalState.winnerPid, joined.pid);
  assert.equal(finalState.winnerDetails.pid, joined.pid);
  console.log('Game finished! Winner:', finalState.winner);

  if (finalState.winner === 'Tester') {
    console.log('\n=== ALL TESTS PASSED: MuzLoto is fully operational! ===\n');
  } else {
    throw new Error('Winner was not Tester: ' + finalState.winner);
  }

  host.disconnect();
  player.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
