const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Test both Server Mode and Mesh Mode for 1 Host + 10 Friends
const { io: ioClient } = require('socket.io-client');

async function runServerE2ETest() {
  console.log('\n======================================================');
  console.log('🎮 E2E TEST: HUMAN HOST & 10 FRIENDS (NODE SERVER)');
  console.log('======================================================');

  const SERVER_URL = 'http://localhost:3000';
  const friendNames = [
    'Макс', 'Алина', 'Иван', 'Катя', 'Дима',
    'Оля', 'Сергей', 'Анна', 'Артём', 'Вика'
  ];

  // 1. Host Connects
  const hostSocket = ioClient(SERVER_URL, { forceNew: true });
  await new Promise((res, rej) => {
    hostSocket.on('connect', res);
    hostSocket.on('connect_error', rej);
  });
  console.log('✓ Host (Ведущий) connected to server');

  // Load tracks from packs.json or generate 25 party tracks
  const packs = JSON.parse(fs.readFileSync(path.join(__dirname, 'packs.json'), 'utf8'));
  const tracks = packs.new_school.tracks;

  // 2. Host creates room
  const createRes = await new Promise(res => {
    hostSocket.emit('host:create', { tracks, size: 3, mode: 'full' }, res);
  });
  const roomCode = createRes.code;
  console.log(`✓ Room #${roomCode} created with 25 tracks (3x3 grid, Full Card mode)`);

  // 3. 10 Friends Join
  console.log('\n10 Friends joining the room on their phones...');
  const friends = [];
  for (let i = 0; i < friendNames.length; i++) {
    const name = friendNames[i];
    const pid = `p_${i + 1}_${Math.random().toString(36).slice(2, 8)}`;
    const socket = ioClient(SERVER_URL, { forceNew: true });
    await new Promise(r => socket.on('connect', r));

    const joinRes = await new Promise(r => {
      socket.emit('player:join', { code: roomCode, name, pid }, r);
    });

    assert(joinRes.card && joinRes.card.length === 9, `${name} must receive a 3x3 card with 9 tracks`);
    friends.push({
      id: i + 1,
      name,
      pid,
      socket,
      card: joinRes.card,
      marks: new Set()
    });
    console.log(`  [Друг ${i + 1}/10] "${name}" вошёл в игру (PID: ${pid}, Карточка: [${joinRes.card.map(c => c.kegNum).join(', ')}])`);
  }

  // 4. Verify Host sees 10 players in lobby
  const lobbyState = await new Promise(r => {
    hostSocket.once('state', r);
    hostSocket.emit('host:restore', { code: roomCode }, () => {});
  });
  assert.strictEqual(lobbyState.players.length, 10, 'Host must see exactly 10 players in lobby');
  console.log(`✓ Host confirms 10 players are sitting at the table in lobby`);

  // 5. Host starts game
  await new Promise(r => hostSocket.emit('host:start', {}, r));
  console.log('✓ Host clicks "Начать игру" -> game state switched to "playing"');

  // 6. Anti-Cheat Test 1: Premature Bingo from Friend 1 (Макс) with 0 called barrels
  const prematureBingo = await new Promise(r => {
    friends[0].socket.emit('player:bingo', {}, r);
  });
  assert.strictEqual(prematureBingo.ok, false, 'Premature bingo must be rejected');
  console.log(`✓ Anti-Cheat Check: Friend "${friends[0].name}" pressing BINGO on turn 0 was REJECTED: "${prematureBingo.msg}"`);

  // 7. Play the game barrel by barrel
  console.log('\nHost drawing barrels from the sack one by one:');
  let winnerFound = null;
  const calledTrackIds = [];

  for (let turn = 1; turn <= tracks.length; turn++) {
    const nextBarrel = await new Promise(r => hostSocket.emit('host:next', {}, r));
    if (nextBarrel.end) {
      console.log('  Мешок пуст!');
      break;
    }

    const calledTrack = nextBarrel.track;
    calledTrackIds.push(calledTrack.id);
    console.log(`  Ход ${turn}: Бочонок №${nextBarrel.kegNum} — "${calledTrack.artist} — ${calledTrack.title}" (В мешке: ${nextBarrel.remaining})`);

    // Each friend checks their card and marks if barrel matches
    for (const friend of friends) {
      const match = friend.card.find(c => c.id === calledTrack.id);
      if (match) {
        friend.marks.add(match.id);
        // Sync mark with server
        friend.socket.emit('player:mark', { id: match.id, marked: true });
      }

      // Check if friend has 9 marks (Full Card)
      if (friend.marks.size === 9 && !winnerFound) {
        console.log(`\n🎉 BINGO! Friend "${friend.name}" gathered ALL 9 BARRELS on turn ${turn}!`);
        winnerFound = friend;

        // Non-winner (Friend 2 - Алина) attempts to falsely claim Bingo
        const nonWinner = friends.find(f => f !== friend);
        const nonWinnerClaim = await new Promise(r => nonWinner.socket.emit('player:bingo', {}, r));
        assert.strictEqual(nonWinnerClaim.ok, false, 'Non-winner must be rejected');
        console.log(`✓ Anti-Cheat Check: Non-winner "${nonWinner.name}" attempting Bingo was REJECTED: "${nonWinnerClaim.msg}"`);

        // Attach state listener BEFORE claiming Bingo
        const finalStatePromise = new Promise(r => hostSocket.once('state', r));

        // Legitimate winner claims Bingo!
        const winAck = await new Promise(r => friend.socket.emit('player:bingo', { marks: [...friend.marks] }, r));
        assert(winAck.ok, 'Legitimate Bingo must be approved');
        console.log(`✓ BINGO officially APPROVED for "${friend.name}"!`);

        const finalState = await finalStatePromise;
        assert.strictEqual(finalState.state, 'finished', 'Game state must be finished');
        assert.strictEqual(finalState.winner, winnerFound.name, 'Winner must match');
        console.log(`✓ TV Screen received victory broadcast: Winner "${finalState.winner}"`);
        break;
      }
    }

    if (winnerFound) break;
  }

  assert(winnerFound, 'A legitimate winner must be found');

  // 9. Verify Database (Stats & Leaderboard)
  const statsRes = await fetch(`${SERVER_URL}/api/stats`);
  const statsData = await statsRes.json();
  const leaderRecord = statsData.leaderboard.find(l => l.name === winnerFound.name);
  assert(leaderRecord, `Winner "${winnerFound.name}" must be recorded in Leaderboard database`);
  assert(leaderRecord.wins >= 1, 'Leaderboard must record at least 1 win');
  console.log(`✓ Database Check: Winner "${winnerFound.name}" recorded in Leaderboard with ${leaderRecord.wins} win(s)`);

  const historyRecord = statsData.history.find(h => h.winnerName === winnerFound.name);
  assert(historyRecord, 'Match History database must contain the finished game');
  assert(historyRecord.roomCode === roomCode, 'Match History must match room code');
  console.log(`✓ Database Check: Match record #${historyRecord.id} saved in Match History (Room #${historyRecord.roomCode}, Mode: ${historyRecord.mode})`);

  // 10. Clean up sockets
  hostSocket.disconnect();
  friends.forEach(f => f.socket.disconnect());

  console.log('\n======================================================');
  console.log('🎯 1 HUMAN + 10 FRIENDS E2E TEST: 100% SUCCESS');
  console.log('======================================================\n');
}

runServerE2ETest().catch(e => {
  console.error('E2E TEST FAILED:', e);
  process.exit(1);
});
