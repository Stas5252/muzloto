const { io } = require('socket.io-client');
const assert = require('assert');

async function test11Players() {
  console.log('\n========================================');
  console.log('🧪 RUNNING 11 CONCURRENT PLAYERS TEST');
  console.log('========================================\n');

  const host = io('http://localhost:3000');
  await new Promise(r => host.on('connect', r));
  console.log('✓ Host connected to server');

  // 1. Host creates a room with 30 tracks
  const tracks = Array.from({ length: 30 }, (_, i) => ({
    id: 'track_' + i,
    title: 'Song ' + (i + 1),
    artist: 'Artist ' + (i + 1),
    art: 'https://example.com/art' + i + '.jpg'
  }));

  const room = await new Promise(res => host.emit('host:create', { tracks, size: 3, mode: 'line' }, res));
  assert(room.code, 'Room code must exist');
  console.log(`✓ Room #${room.code} created with ${tracks.length} tracks (3x3 grid, line mode)`);

  // 2. Connect 11 distinct player sockets
  const PLAYER_COUNT = 11;
  const playerSockets = [];
  const playerInfos = [];

  const playerNames = [
    'Алина', 'Иван', 'Катя', 'Дмитрий', 'Ольга',
    'Сергей', 'Макс', 'Анна', 'Артем', 'Виктория', 'Михаил'
  ];

  console.log(`\nConnecting and joining ${PLAYER_COUNT} distinct players...`);
  for (let i = 0; i < PLAYER_COUNT; i++) {
    const pSock = io('http://localhost:3000');
    await new Promise(r => pSock.on('connect', r));
    playerSockets.push(pSock);

    const name = playerNames[i];
    const pid = 'session_pid_' + i + '_' + Math.random().toString(36).slice(2, 8);

    const joinData = await new Promise(res => {
      pSock.emit('player:join', { code: room.code, name, pid }, res);
    });

    assert(!joinData.error, 'Join error: ' + joinData.error);
    assert.strictEqual(joinData.card.length, 9, 'Card must have 9 cells for 3x3');
    assert(joinData.pid, 'Must have a valid PID');
    assert(joinData.card[0].art, 'Card cells must have art property');

    playerInfos.push({
      index: i,
      name,
      pid: joinData.pid,
      socket: pSock,
      card: joinData.card,
      marks: new Set()
    });
    console.log(`  [Player ${i + 1}/11] "${name}" joined (PID: ${joinData.pid.slice(0, 14)}..., Card: [${joinData.card.map(c => c.kegNum).join(',')}])`);
  }

  // Verify all 11 players have distinct PIDs
  const uniquePids = new Set(playerInfos.map(p => p.pid));
  assert.strictEqual(uniquePids.size, 11, 'All 11 players must have unique PIDs! No PID collision allowed.');
  console.log(`\n✓ All ${uniquePids.size} players have verified distinct, non-colliding PIDs`);

  // 3. Start game
  const statePromises = playerSockets.map(s => new Promise(res => {
    const handler = st => {
      if (st.state === 'playing') {
        s.off('state', handler);
        res(st);
      }
    };
    s.on('state', handler);
  }));

  host.emit('host:start');
  await Promise.all(statePromises);
  console.log('✓ Host started game; all 11 players received "playing" state');

  // Let's designate Player 7 ("Макс") as the target player to legitimately assemble a line
  const maxPlayer = playerInfos.find(p => p.name === 'Макс');
  assert(maxPlayer, 'Player "Макс" must exist');

  // Helper to check line completion
  function checkLine(card, calledIds, marks) {
    const n = 3;
    const R = [0, 1, 2];
    const ok = idx => marks.has(card[idx].id) && calledIds.includes(card[idx].id);
    for (let i = 0; i < n; i++) if (R.every(j => ok(i * n + j))) return true;
    for (let j = 0; j < n; j++) if (R.every(i => ok(i * n + j))) return true;
    if (R.every(j => ok(j * n + j))) return true;
    if (R.every(j => ok(j * n + (n - 1 - j)))) return true;
    return false;
  }

  // 4. Test: Premature Bingo when no one has a line
  const ivanPlayer = playerInfos.find(p => p.name === 'Иван');
  const prematureBingo = await new Promise(res => ivanPlayer.socket.emit('player:bingo', {}, res));
  assert.strictEqual(prematureBingo.ok, false, 'Server must REJECT premature Bingo when no line is formed');
  console.log(`✓ Security Check: Premature Bingo from "${ivanPlayer.name}" correctly rejected: "${prematureBingo.msg}"`);

  // 5. Host calls barrels one by one
  const calledIds = [];
  let firstWinner = null;
  let calls = 0;

  while (calls < tracks.length) {
    const callRes = await new Promise(res => host.emit('host:next', {}, res));
    if (callRes.end) break;
    calls++;
    const calledId = callRes.id;
    calledIds.push(calledId);

    // All 11 players mark their cards if they have this track
    for (const player of playerInfos) {
      if (player.card.some(c => c.id === calledId)) {
        player.marks.add(calledId);
        player.socket.emit('player:mark', { id: calledId, marked: true });
      }
    }

    // Check if anyone has completed a line
    for (const player of playerInfos) {
      if (checkLine(player.card, calledIds, player.marks)) {
        firstWinner = player;
        console.log(`\n🎉 Turn #${calls} (barrel ${calledId}): "${player.name}" legitimately completed a winning line!`);
        break;
      }
    }

    if (firstWinner) break;
  }

  assert(firstWinner, 'At least one player must complete a line');

  // 6. Security Check: A player who does NOT have a winning line attempts to claim Bingo
  const nonWinner = playerInfos.find(p => p !== firstWinner && !checkLine(p.card, calledIds, p.marks));
  if (nonWinner) {
    const fakeBingo = await new Promise(res => nonWinner.socket.emit('player:bingo', { marks: [...nonWinner.marks] }, res));
    assert.strictEqual(fakeBingo.ok, false, 'Non-winner must be rejected');
    console.log(`✓ Security Check: Non-winner "${nonWinner.name}" attempting Bingo was REJECTED: "${fakeBingo.msg}"`);
  }

  // 7. The legitimate winner presses BINGO!
  console.log(`\n-> "${firstWinner.name}" presses BINGO button...`);
  const finishPromise = new Promise(res => {
    host.on('state', st => {
      if (st.state === 'finished') res(st);
    });
  });

  const bingoClaim = await new Promise(res => {
    firstWinner.socket.emit('player:bingo', { marks: [...firstWinner.marks] }, res);
  });

  assert.strictEqual(bingoClaim.ok, true, `Legitimate Bingo claim for ${firstWinner.name} must be approved!`);
  assert.strictEqual(bingoClaim.winner, firstWinner.name, `Winner returned must be "${firstWinner.name}"`);
  console.log(`✓ BINGO approved for "${firstWinner.name}"!`);

  const finalState = await finishPromise;
  console.log(`\n✓ Final state broadcast received on TV:`);
  console.log(`   State:  ${finalState.state}`);
  console.log(`   Winner: ${finalState.winner}`);
  console.log(`   Winner Details Name: ${finalState.winnerDetails.name}`);
  console.log(`   Winning Indices: [${finalState.winnerDetails.winIndices.join(', ')}]`);

  // STRICT WINNER VALIDATION
  assert.strictEqual(finalState.winner, firstWinner.name, `State winner MUST be strictly "${firstWinner.name}"!`);
  assert.strictEqual(finalState.winnerDetails.name, firstWinner.name, `Winner details name MUST be strictly "${firstWinner.name}"!`);
  assert(finalState.winnerDetails.winIndices.length >= 3, 'Winning indices must have at least 3 cells');

  // Verify none of the other 10 players was mistakenly recorded as winner
  for (const other of playerInfos) {
    if (other !== firstWinner) {
      assert.notStrictEqual(finalState.winner, other.name, `Player ${other.name} must NOT be the winner!`);
    }
  }
  console.log(`✓ Strict Isolation: Verified that exactly "${firstWinner.name}" won, and 0 of the other 10 players were misattributed.`);

  // 8. Test: Trying to claim Bingo after game has ended
  const anotherPlayer = playerInfos.find(p => p !== firstWinner);
  const lateBingo = await new Promise(res => anotherPlayer.socket.emit('player:bingo', {}, res));
  assert.strictEqual(lateBingo.ok, false, 'Late Bingo after finish must be rejected');
  console.log(`✓ Security Check: Late claim after finish rejected: "${lateBingo.msg}"`);

  // Clean up
  host.disconnect();
  playerSockets.forEach(s => s.disconnect());

  console.log('\n============================================================');
  console.log('🎯 11-PLAYER CONCURRENCY & WINNER ISOLATION TEST: 100% PASSED');
  console.log('============================================================\n');
}

test11Players().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
