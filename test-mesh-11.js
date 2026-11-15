const assert = require('assert');

// Mock browser globals for comm.js Cloud Mesh test
const channelListeners = new Map(); // channelName -> Set(callbacks)

class MockBroadcastChannel {
  constructor(name) {
    this.name = name;
    if (!channelListeners.has(name)) channelListeners.set(name, new Set());
    this.subscribers = channelListeners.get(name);
    this.subscribers.add(this);
    this.onmessage = null;
  }

  postMessage(data) {
    // Deliver copy asynchronously to all other subscribers on this channel
    const serialized = JSON.stringify(data);
    for (const sub of this.subscribers) {
      if (sub !== this && sub.onmessage) {
        const copy = JSON.parse(serialized);
        setImmediate(() => {
          if (sub.onmessage) sub.onmessage({ data: copy });
        });
      }
    }
  }

  close() {
    this.subscribers.delete(this);
  }
}

global.BroadcastChannel = MockBroadcastChannel;
global.window = {
  location: { hostname: 'stas5252.github.io', protocol: 'https:' }
};
global.sessionStorage = {
  data: {},
  getItem(k) { return this.data[k] || null; },
  setItem(k, v) { this.data[k] = String(v); },
  removeItem(k) { delete this.data[k]; }
};

// Load comm.js
require('./comm.js');

async function testMesh11Players() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING CLOUD MESH 11 CONCURRENT PLAYERS TEST');
  console.log('======================================================\n');

  // 1. Host creates room
  const hostComm = window.createComm('host');
  assert.strictEqual(hostComm.mode, 'cloud-mesh', 'Comm mode must be cloud-mesh on github.io');

  const tracks = Array.from({ length: 30 }, (_, i) => ({
    id: 'tr_' + i,
    kegNum: i + 1,
    title: 'Mesh Song ' + (i + 1),
    artist: 'Mesh Artist ' + (i + 1),
    art: 'https://example.com/art' + i + '.jpg'
  }));

  const room = await new Promise(res => hostComm.hostCreate({ tracks, size: 3, mode: 'line' }, res));
  console.log(`✓ Mesh Room created with code: #${room.code}`);

  // 2. Connect 11 distinct player adapters (each simulating an independent tab/session)
  const PLAYER_COUNT = 11;
  const playerAdapters = [];
  const playerCards = [];

  const names = [
    'Алина', 'Иван', 'Катя', 'Дмитрий', 'Ольга',
    'Сергей', 'Макс', 'Анна', 'Артем', 'Виктория', 'Михаил'
  ];

  for (let i = 0; i < PLAYER_COUNT; i++) {
    // Create distinct adapter
    const pComm = window.createComm('player');
    const name = names[i];
    const uniquePid = 'mesh_p_' + i + '_' + Math.random().toString(36).slice(2, 9);

    const joinRes = await new Promise(res => {
      pComm.playerJoin({ code: room.code, name, pid: uniquePid }, res);
    });

    assert(!joinRes.error, 'Join error: ' + joinRes.error);
    assert.strictEqual(joinRes.pid, uniquePid, `Player ${name}'s PID must match their requested session PID!`);
    assert.strictEqual(joinRes.card.length, 9, 'Card must have 9 cells');
    assert(joinRes.card[0].art, 'Card must have art URL');

    playerAdapters.push(pComm);
    playerCards.push({
      index: i,
      name,
      pid: uniquePid,
      comm: pComm,
      card: joinRes.card,
      marks: new Set()
    });

    console.log(`  [Mesh Player ${i + 1}/11] "${name}" joined (PID: ${uniquePid}, Card: [${joinRes.card.map(c => c.kegNum).join(',')}])`);
  }

  // Verify all 11 players have distinct PIDs
  const pids = new Set(playerCards.map(p => p.pid));
  assert.strictEqual(pids.size, 11, 'All 11 mesh players must have strictly distinct PIDs');
  console.log(`\n✓ All ${pids.size} players joined with isolated, non-colliding PIDs`);

  // 3. Host starts game
  let hostState = null;
  hostComm.on('state', st => { hostState = st; });
  hostComm.hostStart();
  await new Promise(r => setTimeout(r, 50));
  assert.strictEqual(hostState.state, 'playing', 'Room must transition to playing state');
  console.log('✓ Mesh Host started game');

  // Helper to check line
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

  // 4. Host calls barrels one by one
  const calledIds = [];
  let firstWinner = null;
  let calls = 0;

  while (calls < tracks.length) {
    const nextBarrel = await new Promise(res => hostComm.hostNext(res));
    if (nextBarrel.end) break;
    calls++;
    const barrelId = nextBarrel.id;
    calledIds.push(barrelId);

    // All players mark matching cards
    for (const p of playerCards) {
      if (p.card.some(c => c.id === barrelId)) {
        p.marks.add(barrelId);
        p.comm.playerMark({ id: barrelId, marked: true });
      }
    }

    // Check for line
    for (const p of playerCards) {
      if (checkLine(p.card, calledIds, p.marks)) {
        firstWinner = p;
        console.log(`\n🎉 Turn #${calls} (barrel ${barrelId}): "${p.name}" legitimately assembled a winning line!`);
        break;
      }
    }

    if (firstWinner) break;
  }

  assert(firstWinner, 'A player must complete a line');

  // 5. Non-winner tries to claim Bingo
  const nonWinner = playerCards.find(p => p !== firstWinner && !checkLine(p.card, calledIds, p.marks));
  if (nonWinner) {
    const badBingo = await new Promise(res => nonWinner.comm.playerBingo({ marks: [...nonWinner.marks] }, res));
    assert.strictEqual(badBingo.ok, false, 'Non-winner must be rejected');
    console.log(`✓ Mesh Security: Non-winner "${nonWinner.name}" claim REJECTED: "${badBingo.msg}"`);
  }

  // 6. First winner claims Bingo!
  console.log(`\n-> "${firstWinner.name}" claims BINGO via Mesh...`);
  const winClaim = await new Promise(res => firstWinner.comm.playerBingo({ marks: [...firstWinner.marks] }, res));
  assert.strictEqual(winClaim.ok, true, `Winner claim for "${firstWinner.name}" must be approved!`);
  assert.strictEqual(winClaim.winner, firstWinner.name, `Winner returned must be "${firstWinner.name}"`);
  console.log(`✓ BINGO approved for "${firstWinner.name}"!`);

  // Wait for state broadcast
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(hostState.state, 'finished', 'Host state must be finished');
  assert.strictEqual(hostState.winner, firstWinner.name, `Host winner must be strictly "${firstWinner.name}"`);
  assert.strictEqual(hostState.winnerDetails.name, firstWinner.name, `WinnerDetails name must be "${firstWinner.name}"`);

  console.log(`\n✓ Final state verified: Winner is "${hostState.winner}", Indices: [${hostState.winnerDetails.winIndices.join(', ')}]`);

  // Verify none of other 10 players won
  for (const other of playerCards) {
    if (other !== firstWinner) {
      assert.notStrictEqual(hostState.winner, other.name, `${other.name} must not be winner`);
    }
  }
  console.log('✓ Strict Isolation: Verified that exactly the player who assembled the line won in Cloud Mesh mode.');

  console.log('\n============================================================');
  console.log('🎯 CLOUD MESH 11-PLAYER TEST: 100% PASSED');
  console.log('============================================================\n');
}

testMesh11Players().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ MESH TEST FAILED:', err);
  process.exit(1);
});
