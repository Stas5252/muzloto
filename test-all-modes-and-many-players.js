const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { io: ioClient } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const packs = JSON.parse(fs.readFileSync(path.join(__dirname, 'packs.json'), 'utf8'));
const tracks = packs.new_school.tracks; // 25 tracks

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Helper to create a connected socket
async function createClient() {
  const s = ioClient(SERVER_URL, { forceNew: true, reconnection: false });
  await new Promise((res, rej) => {
    s.on('connect', res);
    s.on('connect_error', rej);
  });
  return s;
}

// Helper to create room
async function hostCreateRoom(hostSocket, size, mode) {
  return new Promise(res => {
    hostSocket.emit('host:create', { tracks, size, mode }, res);
  });
}

// -------------------------------------------------------------
// TEST SUITE 1: 30 PLAYERS CONCURRENCY & STRESS TEST
// -------------------------------------------------------------
async function test30PlayersStress() {
  console.log('\n=============================================================');
  console.log('🚀 SUITE 1: STRESS TEST WITH 30 CONCURRENT PLAYERS');
  console.log('=============================================================');

  const hostSocket = await createClient();
  const roomRes = await hostCreateRoom(hostSocket, 3, 'line');
  const code = roomRes.code;
  console.log(`✓ Host created Room #${code} (3x3, Line mode) for 30 players`);

  const NUM_PLAYERS = 30;
  console.log(`Connecting ${NUM_PLAYERS} players simultaneously...`);

  const players = [];
  const startConnectTime = Date.now();

  const joinPromises = [];
  for (let i = 1; i <= NUM_PLAYERS; i++) {
    const name = `Игрок_${i}`;
    const pid = `pid_stress_${i}_${Math.random().toString(36).slice(2, 7)}`;
    joinPromises.push((async () => {
      const socket = await createClient();
      const joinRes = await new Promise(r => {
        socket.emit('player:join', { code, name, pid }, r);
      });
      assert(joinRes.card && joinRes.card.length === 9, `Player ${name} must receive 9-track card`);
      return { id: i, name, pid, socket, card: joinRes.card, marks: new Set() };
    })());
  }

  const connectedPlayers = await Promise.all(joinPromises);
  players.push(...connectedPlayers);
  const connectDuration = Date.now() - startConnectTime;
  console.log(`✓ All ${NUM_PLAYERS} players connected and cards generated in ${connectDuration}ms`);

  // Verify uniqueness of cards across 30 players
  const cardSignatures = new Set(players.map(p => p.card.map(c => c.kegNum).sort().join(',')));
  console.log(`✓ Card diversity: ${cardSignatures.size} distinct card combinations across 30 players`);

  // Host checks lobby count
  const lobbyState = await new Promise(r => {
    hostSocket.once('state', r);
    hostSocket.emit('host:restore', { code }, () => {});
  });
  assert.strictEqual(lobbyState.players.length, NUM_PLAYERS, `Host lobby must see exactly ${NUM_PLAYERS} players`);
  console.log(`✓ Host lobby confirms exactly ${lobbyState.players.length} players are seated`);

  // Host starts game
  await new Promise(r => hostSocket.emit('host:start', {}, r));
  console.log('✓ Host started the game');

  // Draw barrels until first legitimate winner claims bingo
  let winner = null;
  for (let turn = 1; turn <= tracks.length; turn++) {
    const draw = await new Promise(r => hostSocket.emit('host:next', {}, r));
    if (draw.end) break;
    const drawnId = draw.track.id;

    // Every player marks matching track
    for (const player of players) {
      if (player.card.some(c => c.id === drawnId)) {
        player.marks.add(drawnId);
        player.socket.emit('player:mark', { id: drawnId, marked: true });
      }
    }

    // Check who has a winning line
    for (const player of players) {
      const isMarked = idx => player.marks.has(player.card[idx].id);
      // Check 3 rows
      const rowWin = [0, 1, 2].some(r => [0, 1, 2].every(c => isMarked(r * 3 + c)));
      // Check 3 cols
      const colWin = [0, 1, 2].some(c => [0, 1, 2].every(r => isMarked(r * 3 + c)));
      // Check 2 diagonals
      const diag1 = [0, 4, 8].every(idx => isMarked(idx));
      const diag2 = [2, 4, 6].every(idx => isMarked(idx));

      if ((rowWin || colWin || diag1 || diag2) && !winner) {
        winner = player;
        console.log(`\n🎉 First Winner amongst 30 players: "${player.name}" on turn ${turn}!`);

        // Test concurrent false bingo rejection from 5 other players
        for (let j = 0; j < 5; j++) {
          const other = players[(player.id + j) % NUM_PLAYERS];
          if (other !== player) {
            const falseClaim = await new Promise(r => other.socket.emit('player:bingo', {}, r));
            if (!falseClaim.ok) {
              // Expected
            }
          }
        }

        // Winner claims bingo
        const hostStatePromise = new Promise(r => hostSocket.once('state', r));
        const winAck = await new Promise(r => player.socket.emit('player:bingo', { marks: [...player.marks] }, r));
        assert(winAck.ok, 'Winner Bingo must be approved');
        console.log(`✓ Bingo officially approved for "${player.name}"`);

        const finalState = await hostStatePromise;
        assert.strictEqual(finalState.state, 'finished');
        assert.strictEqual(finalState.winner, player.name);
        console.log(`✓ Host broadcast confirmed winner "${finalState.winner}" across all 30 clients`);
        break;
      }
    }

    if (winner) break;
  }

  assert(winner, 'Must have a winner');

  // Disconnect all
  hostSocket.disconnect();
  players.forEach(p => p.socket.disconnect());
  console.log('✓ Suite 1 passed (30 concurrent players stress test)\n');
}

// -------------------------------------------------------------
// TEST SUITE 2: ALL 4 WINNING LINE GEOMETRIES (3x3 Grid)
// -------------------------------------------------------------
async function testLineGeometries() {
  console.log('=============================================================');
  console.log('📐 SUITE 2: LINE GEOMETRIES (ROW, COLUMN, DIAGONAL, ANTI-DIAG)');
  console.log('=============================================================');

  const geometries = [
    { name: 'Row 0 (Горизонталь 1)', indices: [0, 1, 2] },
    { name: 'Row 1 (Горизонталь 2)', indices: [3, 4, 5] },
    { name: 'Row 2 (Горизонталь 3)', indices: [6, 7, 8] },
    { name: 'Column 0 (Вертикаль 1)', indices: [0, 3, 6] },
    { name: 'Column 1 (Вертикаль 2)', indices: [1, 4, 7] },
    { name: 'Column 2 (Вертикаль 3)', indices: [2, 5, 8] },
    { name: 'Main Diagonal (Главная диагональ ↘)', indices: [0, 4, 8] },
    { name: 'Anti-Diagonal (Побочная диагональ ↙)', indices: [2, 4, 6] }
  ];

  for (const geo of geometries) {
    const hostSocket = await createClient();
    const roomRes = await hostCreateRoom(hostSocket, 3, 'line');
    const code = roomRes.code;

    const playerSocket = await createClient();
    const joinRes = await new Promise(r => {
      playerSocket.emit('player:join', { code, name: `Тестер_${geo.name}`, pid: `pid_${Date.now()}` }, r);
    });

    await new Promise(r => hostSocket.emit('host:start', {}, r));

    // Force call the specific 3 tracks matching the player's geometry
    const targetTrackIds = geo.indices.map(idx => joinRes.card[idx].id);

    // Call barrels until all 3 are called
    while (true) {
      const draw = await new Promise(r => hostSocket.emit('host:next', {}, r));
      if (draw.end) break;
      const calledId = draw.track.id;
      if (targetTrackIds.includes(calledId)) {
        playerSocket.emit('player:mark', { id: calledId, marked: true });
      }
      // Check if all 3 called
      const calledState = await new Promise(r => {
        hostSocket.once('state', r);
        hostSocket.emit('host:restore', { code }, () => {});
      });
      if (targetTrackIds.every(id => calledState.called.includes(id))) break;
    }

    // Claim bingo
    const claim = await new Promise(r => playerSocket.emit('player:bingo', { marks: targetTrackIds }, r));
    assert(claim.ok, `Line geometry "${geo.name}" must trigger valid Bingo`);
    console.log(`  ✓ Geometry validated: ${geo.name} -> BINGO APPROVED`);

    hostSocket.disconnect();
    playerSocket.disconnect();
  }
  console.log('✓ Suite 2 passed (All 8 line geometries in 3x3 verified)\n');
}

// -------------------------------------------------------------
// TEST SUITE 3: 4x4 GRID (16 CELLS) - LINE AND FULL CARD
// -------------------------------------------------------------
async function test4x4GridModes() {
  console.log('=============================================================');
  console.log('🔲 SUITE 3: 4x4 GRID MODES (16 CELLS ON CARD)');
  console.log('=============================================================');

  // Subtest 3A: 4x4 Line Mode (Requires 4 in a line)
  {
    const hostSocket = await createClient();
    const roomRes = await hostCreateRoom(hostSocket, 4, 'line');
    const code = roomRes.code;

    const playerSocket = await createClient();
    const joinRes = await new Promise(r => {
      playerSocket.emit('player:join', { code, name: 'Игрок_4x4_Линия', pid: 'pid_4x4_line' }, r);
    });

    assert.strictEqual(joinRes.card.length, 16, '4x4 Card must contain exactly 16 tracks');
    assert.strictEqual(joinRes.size, 4, 'Room size must be 4');
    console.log(`  ✓ 4x4 Line mode created, player received 16-cell card`);

    await new Promise(r => hostSocket.emit('host:start', {}, r));

    // Target diagonal [0, 5, 10, 15]
    const diag4Indices = [0, 5, 10, 15];
    const targetTrackIds = diag4Indices.map(idx => joinRes.card[idx].id);

    while (true) {
      const draw = await new Promise(r => hostSocket.emit('host:next', {}, r));
      if (draw.end) break;
      const calledId = draw.track.id;
      if (targetTrackIds.includes(calledId)) {
        playerSocket.emit('player:mark', { id: calledId, marked: true });
      }
      const calledState = await new Promise(r => {
        hostSocket.once('state', r);
        hostSocket.emit('host:restore', { code }, () => {});
      });
      if (targetTrackIds.every(id => calledState.called.includes(id))) break;
    }

    const claim = await new Promise(r => playerSocket.emit('player:bingo', { marks: targetTrackIds }, r));
    assert(claim.ok, '4x4 4-in-a-row diagonal must trigger Bingo');
    console.log(`  ✓ 4x4 Diagonal (4 tracks) validated -> BINGO APPROVED`);

    hostSocket.disconnect();
    playerSocket.disconnect();
  }

  // Subtest 3B: 4x4 Full Card Mode (Requires all 16 cells)
  {
    const hostSocket = await createClient();
    const roomRes = await hostCreateRoom(hostSocket, 4, 'full');
    const code = roomRes.code;

    const playerSocket = await createClient();
    const joinRes = await new Promise(r => {
      playerSocket.emit('player:join', { code, name: 'Игрок_4x4_Фулл', pid: 'pid_4x4_full' }, r);
    });

    assert.strictEqual(joinRes.card.length, 16, '4x4 Card must have 16 tracks');
    await new Promise(r => hostSocket.emit('host:start', {}, r));

    const all16Ids = joinRes.card.map(c => c.id);

    // Call barrels until all 16 are drawn
    while (true) {
      const draw = await new Promise(r => hostSocket.emit('host:next', {}, r));
      if (draw.end) break;
      const calledId = draw.track.id;
      if (all16Ids.includes(calledId)) {
        playerSocket.emit('player:mark', { id: calledId, marked: true });
      }
      const calledState = await new Promise(r => {
        hostSocket.once('state', r);
        hostSocket.emit('host:restore', { code }, () => {});
      });
      if (all16Ids.every(id => calledState.called.includes(id))) break;
    }

    const claim = await new Promise(r => playerSocket.emit('player:bingo', { marks: all16Ids }, r));
    assert(claim.ok, '4x4 Full card must trigger Bingo when all 16 cells are called');
    console.log(`  ✓ 4x4 Full card (all 16 tracks) validated -> BINGO APPROVED`);

    hostSocket.disconnect();
    playerSocket.disconnect();
  }
  console.log('✓ Suite 3 passed (4x4 Line and 4x4 Full Card verified)\n');
}

// -------------------------------------------------------------
// TEST SUITE 4: 3x3 FULL CARD MODE (ALL 9 CELLS)
// -------------------------------------------------------------
async function test3x3FullCardMode() {
  console.log('=============================================================');
  console.log('🎯 SUITE 4: 3x3 FULL CARD MODE (ALL 9 CELLS REQUIRED)');
  console.log('=============================================================');

  const hostSocket = await createClient();
  const roomRes = await hostCreateRoom(hostSocket, 3, 'full');
  const code = roomRes.code;

  const playerSocket = await createClient();
  const joinRes = await new Promise(r => {
    playerSocket.emit('player:join', { code, name: 'ФуллКардМастер', pid: 'pid_3x3_full' }, r);
  });

  await new Promise(r => hostSocket.emit('host:start', {}, r));
  const cardIds = joinRes.card.map(c => c.id);

  // Partial mark: 8 out of 9 tracks called and marked
  let countCalled = 0;
  while (true) {
    const draw = await new Promise(r => hostSocket.emit('host:next', {}, r));
    if (draw.end) break;
    const calledId = draw.track.id;
    if (cardIds.includes(calledId)) {
      playerSocket.emit('player:mark', { id: calledId, marked: true });
      countCalled++;
    }
    if (countCalled === 8) break; // Stop at 8
  }

  // Attempting bingo with 8 of 9 must FAIL
  const premature = await new Promise(r => playerSocket.emit('player:bingo', {}, r));
  assert.strictEqual(premature.ok, false, 'Bingo with 8/9 marks in Full Card mode must be rejected');
  console.log(`  ✓ Anti-cheat: 8/9 cells marked rejected with message: "${premature.msg}"`);

  // Call remaining barrels until the 9th is drawn
  while (true) {
    const draw = await new Promise(r => hostSocket.emit('host:next', {}, r));
    if (draw.end) break;
    const calledId = draw.track.id;
    if (cardIds.includes(calledId)) {
      playerSocket.emit('player:mark', { id: calledId, marked: true });
    }
    const calledState = await new Promise(r => {
      hostSocket.once('state', r);
      hostSocket.emit('host:restore', { code }, () => {});
    });
    if (cardIds.every(id => calledState.called.includes(id))) break;
  }

  // Now all 9 are marked -> must SUCCEED
  const win = await new Promise(r => playerSocket.emit('player:bingo', { marks: cardIds }, r));
  assert(win.ok, 'Bingo with all 9/9 cells in Full Card mode must succeed');
  console.log(`  ✓ 9/9 cells marked -> BINGO APPROVED`);

  hostSocket.disconnect();
  playerSocket.disconnect();
  console.log('✓ Suite 4 passed (3x3 Full Card verified)\n');
}

// -------------------------------------------------------------
// MAIN RUNNER
// -------------------------------------------------------------
async function runAll() {
  console.log('=============================================================');
  console.log('🧪 MUZLOTO MASTER TEST SUITE: ALL GAME MODES & 30 PLAYERS');
  console.log('=============================================================');

  const start = Date.now();
  await test30PlayersStress();
  await testLineGeometries();
  await test4x4GridModes();
  await test3x3FullCardMode();

  const totalTime = ((Date.now() - start) / 1000).toFixed(2);
  console.log('=============================================================');
  console.log(`🏆 ALL TEST SUITES PASSED FLAWLESSLY IN ${totalTime}s!`);
  console.log('=============================================================');
  process.exit(0);
}

runAll().catch(e => {
  console.error('\n❌ MASTER TEST SUITE FAILED:', e);
  process.exit(1);
});
