const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { io: ioClient } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function createClient() {
  const s = ioClient(SERVER_URL, { forceNew: true, reconnection: false });
  await new Promise((res, rej) => {
    s.on('connect', res);
    s.on('connect_error', rej);
  });
  return s;
}

async function run12PlayersGame() {
  console.log('\n=============================================================');
  console.log('🎉 E2E REAL PARTY PLAYTEST: 1 HOST & 12 FRIENDS (50 TRACKS)');
  console.log('=============================================================');

  const packs = JSON.parse(fs.readFileSync(path.join(__dirname, 'packs.json'), 'utf8'));
  const tracks = packs.new_school.tracks;
  assert.strictEqual(tracks.length, 50, 'Pack must have exactly 50 tracks');

  const friendsNames = [
    'Макс', 'Алина', 'Иван', 'Катя', 'Дима', 'Оля',
    'Сергей', 'Анна', 'Артём', 'Вика', 'Никита', 'Лера'
  ];

  // 1. Host creates room
  const hostSocket = await createClient();
  const createRes = await new Promise(res => {
    hostSocket.emit('host:create', { tracks, size: 3, mode: 'full' }, res);
  });
  const roomCode = createRes.code;
  console.log(`✓ Host created Room #${roomCode} with 50 tracks in the bag (3x3 grid, Full Card mode)`);

  // 2. 12 Friends connect
  console.log('\n12 Friends scanning QR code and joining from their phones:');
  const friends = [];
  for (let i = 0; i < friendsNames.length; i++) {
    const name = friendsNames[i];
    const pid = `p_${i + 1}_${Math.random().toString(36).slice(2, 8)}`;
    const socket = await createClient();
    const joinRes = await new Promise(r => {
      socket.emit('player:join', { code: roomCode, name, pid }, r);
    });

    assert(joinRes.card && joinRes.card.length === 9, 'Player must receive 9 tracks on card');
    friends.push({
      id: i + 1,
      name,
      pid,
      socket,
      card: joinRes.card,
      marks: new Set()
    });

    const kegNums = joinRes.card.map(c => c.kegNum).join(', ');
    console.log(`  [Игрок ${i + 1}/12] "${name}" подключился (Карточка: [${kegNums}])`);
  }

  // 3. Verify lobby state
  const lobbyState = await new Promise(r => {
    hostSocket.once('state', r);
    hostSocket.emit('host:restore', { code: roomCode }, () => {});
  });
  assert.strictEqual(lobbyState.players.length, 12, 'Lobby must see exactly 12 players');
  console.log(`\n✓ Host TV screen confirms: 12 players seated at the table`);

  // 4. Start game
  await new Promise(r => hostSocket.emit('host:start', {}, r));
  console.log('✓ Host clicks "Начать игру" -> Game is LIVE!');

  // 5. Draw barrels from bag of 50 tracks
  console.log('\n--- LIVE GAMEPLAY (Ход за ходом) ---');
  let winner = null;
  let winningTurn = 0;
  const calledBarrels = [];

  for (let turn = 1; turn <= tracks.length; turn++) {
    const draw = await new Promise(r => hostSocket.emit('host:next', {}, r));
    if (draw.end) break;

    const drawnTrack = draw.track;
    calledBarrels.push(drawnTrack);

    // Each friend marks if barrel on card
    for (const friend of friends) {
      if (friend.card.some(c => c.id === drawnTrack.id)) {
        friend.marks.add(drawnTrack.id);
        friend.socket.emit('player:mark', { id: drawnTrack.id, marked: true });
      }

      // Check full card completion (9 marks)
      if (friend.marks.size === 9 && !winner) {
        winner = friend;
        winningTurn = turn;
      }
    }

    if (turn % 5 === 0 || winner || turn === 1) {
      const topMarks = Math.max(...friends.map(f => f.marks.size));
      console.log(`  Ход ${turn}/50: Бочонок №${draw.kegNum} — "${drawnTrack.artist} — ${drawnTrack.title}" | В мешке: ${draw.remaining} | Лидер имеет: ${topMarks}/9`);
    }

    if (winner) break;
  }

  assert(winner, 'A legitimate winner must be found');

  console.log(`\n🎉🎉🎉 БИНГО! ПОБЕДИТЕЛЬ: "${winner.name}" на ${winningTurn}-м ходу!`);
  console.log(`Все 9 бочонков закрыты на карточке ${winner.name}!`);

  // Winner claims Bingo
  const finalStatePromise = new Promise(r => {
    const handler = s => {
      if (s.state === 'finished') {
        hostSocket.off('state', handler);
        r(s);
      }
    };
    hostSocket.on('state', handler);
  });
  const claimRes = await new Promise(r => winner.socket.emit('player:bingo', { marks: [...winner.marks] }, r));
  assert(claimRes.ok, 'Legitimate Bingo must be approved');
  console.log(`✓ Победа официально подтверждена сервером для игрока "${winner.name}"`);

  const finalState = await finalStatePromise;
  assert.strictEqual(finalState.state, 'finished');
  assert.strictEqual(finalState.winner, winner.name);
  console.log(`✓ ТВ-экран транслирует победу: Победитель "${finalState.winner}"`);

  // 6. Inspect close calls of the other 11 friends
  console.log('\n--- ИТОГОВАЯ ТАБЛИЦА СОРЕВНОВАНИЯ 12 ДРУЗЕЙ ---');
  const sortedFriends = [...friends].sort((a, b) => b.marks.size - a.marks.size);
  sortedFriends.forEach((f, idx) => {
    const icon = f === winner ? '🏆 ПОБЕДИТЕЛЬ' : (f.marks.size === 8 ? '🔥 1 до победы!' : (f.marks.size === 7 ? '⚡ 2 до победы' : ''));
    console.log(`  ${idx + 1}. ${f.name.padEnd(8)}: закрыто ${f.marks.size}/9 бочонков ${icon}`);
  });

  // 7. Calculate Real-Life Time
  console.log('\n=============================================================');
  console.log('⏱ МАТЕМАТИЧЕСКИЙ РАСЧЁТ ВРЕМЕНИ ДЛЯ 12 ИГРОКОВ:');
  console.log('=============================================================');
  const secondsAt35 = winningTurn * 35;
  const secondsAt40 = winningTurn * 40;
  const secondsAt45 = winningTurn * 45;

  console.log(`• Всего сыграно ходов: ${winningTurn} из 50`);
  console.log(`• В мешке осталось несыгранных бочонков: ${50 - winningTurn}`);
  console.log(`• Быстрый темп (35 сек/трек): ${(secondsAt35 / 60).toFixed(1)} минут (${secondsAt35} сек)`);
  console.log(`• Комфортный темп вечеринки (40 сек/трек): ${(secondsAt40 / 60).toFixed(1)} минут (${secondsAt40} сек)`);
  console.log(`• Танцевальный темп с подпеванием (45 сек/трек): ${(secondsAt45 / 60).toFixed(1)} минут (${secondsAt45} сек)`);

  assert(winningTurn >= 25, 'With 12 players in full card mode, winner must NOT win prematurely (must take 25+ turns)');
  console.log(`\n✓ ЗАЩИТА ОТ РАННЕЙ ПОБЕДЫ: Никто не выиграл случайно на 5-15 ходах! Игра длилась полноценных ${winningTurn} раундов.`);

  // Verify Database
  const statsRes = await fetch(`${SERVER_URL}/api/stats`);
  const stats = await statsRes.json();
  const winRecord = stats.history.find(h => h.roomCode === roomCode);
  assert(winRecord, 'Match must be saved in database');
  assert.strictEqual(winRecord.winnerName, winner.name);
  assert.strictEqual(winRecord.turn, winningTurn);
  assert.strictEqual(winRecord.playerCount, 12);
  console.log(`✓ БАЗА ДАННЫХ: Партия #${winRecord.id} сохранена (Победитель: ${winRecord.winnerName}, Ход: ${winRecord.turn}, Игроков: ${winRecord.playerCount})`);

  // Disconnect
  hostSocket.disconnect();
  friends.forEach(f => f.socket.disconnect());

  console.log('\n=============================================================');
  console.log('🎯 12-PLAYER REAL PARTY TEST: 100% SUCCESS');
  console.log('=============================================================\n');
}

run12PlayersGame().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
