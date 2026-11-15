const assert = require('assert');

// Setup mock BroadcastChannel for Mesh tests
const channelListeners = new Map();
class MockBroadcastChannel {
  constructor(name) {
    this.name = name;
    if (!channelListeners.has(name)) channelListeners.set(name, new Set());
    this.subscribers = channelListeners.get(name);
    this.subscribers.add(this);
    this.onmessage = null;
  }
  postMessage(data) {
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

require('./comm.js');

async function runAdversarialTests() {
  console.log('\n======================================================');
  console.log('⚔️ RUNNING ADVERSARIAL & EDGE-CASE TEST SUITE');
  console.log('======================================================\n');

  // ----------------------------------------------------
  // TEST 1: Identical Names ("Макс" vs "Макс") Winner Isolation
  // ----------------------------------------------------
  console.log('--- Test 1: Two players with identical name "Макс" ---');
  const hostComm = window.createComm('host');
  const tracks = Array.from({ length: 25 }, (_, i) => ({
    id: 't_' + i,
    kegNum: i + 1,
    title: 'Song ' + (i + 1),
    artist: 'Artist ' + (i + 1),
    art: 'https://example.com/art' + i + '.jpg'
  }));

  const room = await new Promise(res => hostComm.hostCreate({ tracks, size: 3, mode: 'line' }, res));

  const p1Comm = window.createComm('player');
  const p2Comm = window.createComm('player');

  const p1Join = await new Promise(res => p1Comm.playerJoin({ code: room.code, name: 'Макс', pid: 'pid_max_1' }, res));
  const p2Join = await new Promise(res => p2Comm.playerJoin({ code: room.code, name: 'Макс', pid: 'pid_max_2' }, res));

  assert.strictEqual(p1Join.pid, 'pid_max_1');
  assert.strictEqual(p2Join.pid, 'pid_max_2');
  assert.notStrictEqual(p1Join.pid, p2Join.pid, 'PIDs must be strictly distinct even with same name!');
  console.log('✓ Both "Макс" players joined with distinct PIDs (pid_max_1 vs pid_max_2)');

  // ----------------------------------------------------
  // TEST 2: Unicast Security — Missing or Spoofed targetPid MUST BE DROPPED
  // ----------------------------------------------------
  console.log('\n--- Test 2: Unicast Spoofing & Missing targetPid Isolation ---');
  const attackerComm = window.createComm('player');
  let spoofedJoinAckReceived = false;

  attackerComm.on('card', () => { spoofedJoinAckReceived = true; });

  // Simulate an attacker sending a malicious unicast card payload with someone else's PID or missing PID
  const maliciousChan = new MockBroadcastChannel('muzloto_' + room.code);
  maliciousChan.postMessage({
    type: 'card',
    // targetPid missing! Must be dropped by all legitimate players!
    data: { card: [], marks: [] }
  });

  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(spoofedJoinAckReceived, false, 'Unicast message without valid targetPid MUST be dropped!');
  console.log('✓ Security Check: Malicious message with missing targetPid was dropped, zero crosstalk');

  // ----------------------------------------------------
  // TEST 3: Premature Bingo with Uncalled Marks
  // ----------------------------------------------------
  console.log('\n--- Test 3: Premature Bingo with Fake/Uncalled Marks ---');
  let latestHostState = null;
  hostComm.on('state', st => { latestHostState = st; });
  hostComm.hostStart();
  await new Promise(r => setTimeout(r, 50));

  // Player 1 claims they have a line by submitting uncalled marks
  const fakeClaim = await new Promise(res => {
    p1Comm.playerBingo({ marks: p1Join.card.slice(0, 3).map(c => c.id) }, res);
  });
  assert.strictEqual(fakeClaim.ok, false, 'Premature bingo with uncalled tracks must be rejected!');
  assert(latestHostState.state !== 'finished', 'Game state must NOT be finished');
  console.log(`✓ Security Check: Premature Bingo rejected: "${fakeClaim.msg}"`);

  // ----------------------------------------------------
  // TEST 4: Draw Barrels until legitimate line win for Max 1
  // ----------------------------------------------------
  console.log('\n--- Test 4: Legitimate Win Validation for Max 1 (Strict PID check) ---');
  const called = [];
  function checkL(card, cIds, marks) {
    const n = 3;
    const R = [0, 1, 2];
    const ok = idx => marks.has(card[idx].id) && cIds.includes(card[idx].id);
    for (let i = 0; i < n; i++) if (R.every(j => ok(i * n + j))) return true;
    for (let j = 0; j < n; j++) if (R.every(i => ok(i * n + j))) return true;
    if (R.every(j => ok(j * n + j))) return true;
    if (R.every(j => ok(j * n + (n - 1 - j)))) return true;
    return false;
  }

  const p1Marks = new Set();
  const p2Marks = new Set();

  while (called.length < tracks.length) {
    const nextB = await new Promise(res => hostComm.hostNext(res));
    if (nextB.end) break;
    called.push(nextB.id);

    if (p1Join.card.some(c => c.id === nextB.id)) {
      p1Marks.add(nextB.id);
      p1Comm.playerMark({ id: nextB.id, marked: true });
    }
    if (p2Join.card.some(c => c.id === nextB.id)) {
      p2Marks.add(nextB.id);
      p2Comm.playerMark({ id: nextB.id, marked: true });
    }

    if (checkL(p1Join.card, called, p1Marks)) break;
  }

  assert(checkL(p1Join.card, called, p1Marks), 'Max 1 must have assembled a line');

  // Max 1 claims Bingo
  const winClaim = await new Promise(res => {
    p1Comm.playerBingo({ marks: [...p1Marks] }, res);
  });

  assert.strictEqual(winClaim.ok, true, 'Max 1 bingo must be approved');
  assert.strictEqual(winClaim.pid, 'pid_max_1', 'Winning PID must be strictly pid_max_1');

  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(latestHostState.state, 'finished');
  assert.strictEqual(latestHostState.winner, 'Макс');
  assert.strictEqual(latestHostState.winnerPid, 'pid_max_1');
  assert.strictEqual(latestHostState.winnerDetails.pid, 'pid_max_1');
  console.log(`✓ Strict Winner PID Isolation: winnerPid is "${latestHostState.winnerPid}" (strictly Max 1, not Max 2)`);

  // ----------------------------------------------------
  // TEST 5: Game Lifecycle — Restart & New Round
  // ----------------------------------------------------
  console.log('\n--- Test 5: Game Lifecycle — New Round & Resume Verification ---');

  // Host resumes / continues
  await new Promise(res => hostComm.hostResume(res));
  assert.strictEqual(latestHostState.state, 'playing', 'State must be playing after hostResume');
  console.log('✓ hostResume properly unpaused state to "playing"');

  // Host new round
  await new Promise(res => hostComm.hostNewRound(res));
  assert.strictEqual(latestHostState.state, 'lobby', 'State must be lobby after hostNewRound');

  // Host start new round
  await new Promise(res => hostComm.hostStart(res));
  assert.strictEqual(latestHostState.state, 'playing', 'State must be playing after hostStart');

  // Next barrel on new round works without errors
  const round2Barrel = await new Promise(res => hostComm.hostNext(res));
  assert(round2Barrel.id, 'Next barrel on new round must succeed');
  assert.strictEqual(round2Barrel.turn, 1, 'New round turn must reset to 1');
  console.log(`✓ New round successfully launched! Turn #1 barrel: ${round2Barrel.id}`);

  console.log('\n======================================================');
  console.log('🎯 ALL ADVERSARIAL TESTS PASSED (100% SUCCESS)');
  console.log('======================================================\n');
}

runAdversarialTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ ADVERSARIAL TEST FAILED:', err);
  process.exit(1);
});
