const assert = require('node:assert/strict');

(async () => {
  const { demoPack, validPack, createGame, command, publicState } = await import('../quiz/game.mjs');
  const pack = validPack(demoPack);
  assert.ok(pack.categories.some(c => c.title.includes('Вика')));
  assert.throws(() => validPack({ title: 'Пусто', categories: [] }));

  const game = createGame();
  const player = (id, name) => ({ id, name });
  const host = (type, data = {}) => command(game, pack, { type, ...data }, true);
  const send = (id, type, data = {}) => command(game, pack, { id, type, ...data });
  host('start');
  assert.equal(game.phase, 'board', 'The host can play without connected players');
  assert.equal(send('p1', 'join', player('p1', 'Вика')), true);
  assert.equal(send('p2', 'join', player('p2', 'Оля')), true);
  assert.equal(send('p1', 'join', player('p1', 'Вика')), false, 'Reconnect does not create an extra player');
  assert.equal(send('p1', 'pick', { question: 'c0q0' }), false, 'Only the host controls the board');

  host('pick', { question: 'c0q0' });
  const ticket = game.ticket;
  assert.equal(send('p1', 'buzz', { ticket }), false, 'Buzz stays locked while the host reads');
  host('open');
  assert.equal(send('p2', 'buzz', { ticket: 'old' }), false);
  assert.equal(send('p1', 'buzz', { ticket }), true);
  assert.equal(send('p2', 'buzz', { ticket }), true);
  assert.equal(game.answering, 'p1', 'Arrival order determines who can answer');
  assert.equal(send('p2', 'buzz', { ticket }), false, 'Repeated taps do not requeue players');
  host('judge', { verdict: 'wrong' });
  assert.equal(game.players.p1.score, -100);
  assert.equal(game.answering, 'p2', 'The next player gets the question after a wrong answer');
  host('judge', { verdict: 'correct' });
  assert.equal(game.players.p2.score, 100);
  assert.equal(game.phase, 'reveal');
  host('board');
  assert.equal(host('pick', { question: 'c0q0' }), false, 'A used question cannot be reopened');
  assert.equal(host('undo'), true);
  assert.equal(game.phase, 'reveal', 'Undo can restore the preceding host step');
  host('board');

  host('pick', { question: 'c0q2' });
  assert.equal(host('assign', { player: 'p1' }), true);
  assert.equal(game.answering, 'p1');
  host('judge', { verdict: 'neutral' });
  assert.equal(game.players.p1.score, -100);
  assert.equal(send('p2', 'buzz', { ticket: game.ticket }), true);
  host('reveal');
  host('board');

  host('pick', { question: 'c2q1' });
  host('open');
  send('p1', 'buzz', { ticket: game.ticket });
  host('judge', { verdict: 'correct' });
  assert.equal(game.players.p1.score, 300, 'Double-price questions apply the bonus once');
  host('board');

  const output = JSON.stringify(publicState(game, pack));
  assert.ok(!output.includes(pack.categories[0].questions[0].answer));
  assert.ok(!output.includes(pack.categories[0].questions[0].prompt));

  host('final');
  assert.equal(send('p2', 'final-answer', { ticket: game.ticket, wager: 200, answer: 'Тайна' }), false);
  assert.equal(send('p2', 'final-answer', { ticket: game.ticket, wager: 75, answer: 'Тайна' }), true);
  assert.ok(!JSON.stringify(publicState(game, pack)).includes('Тайна'), 'Final responses stay off the public scoreboard');
  assert.equal(send('p2', 'final-answer', { ticket: game.ticket, wager: 25, answer: 'Другое' }), false);
  host('finish', { correct: ['p2'] });
  assert.equal(game.players.p2.score, 175);
  assert.equal(host('finish', { correct: ['p2'] }), false, 'A final wager is calculated once');
  console.log('PASS party quiz: deck, authority, buzzer order, duplicate clicks, scoring, undo and sealed final');
})().catch(error => { console.error(error); process.exitCode = 1; });
