const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const { demoPack, validPack, restoreDraft, createGame, restoreGame, command, publicState, remainingQuestions } = await import('../quiz/game.mjs');
  const pack = validPack(demoPack);
  assert.equal(pack.rounds?.length, 3, 'The starter game has three rounds');
  assert.deepEqual(pack.rounds.map(r => r.categories.reduce((n, c) => n + c.questions.length, 0)), [24, 24, 24]);
  const photos = pack.rounds.flatMap(r => r.categories.flatMap(c => c.questions.map(q => q.image))).filter(Boolean);
  assert.equal(photos.length, 45);
  assert.equal(new Set(photos).size, photos.length, 'Every illustrated starter question uses its own image');
  for (const asset of photos) assert.ok(fs.statSync(path.join(__dirname, '../quiz', asset)).size > 1000);
  const categories = pack.rounds.flatMap(round => round.categories);
  for (const title of ['Кто на фото?', 'Город с высоты', 'Фильм по фото', 'Хиты по картинкам']) {
    assert.equal(categories.find(category => category.title === title).questions.filter(question => question.image).length, 4);
  }
  const zodiac = categories.find(category => category.title === 'Карты и знаки').questions;
  const oldDeck = structuredClone(demoPack);
  for (const [index, symbol, asset] of [[0, '♌', 'zodiac-leo'], [2, '♊', 'zodiac-gemini']]) {
    const question = zodiac[index];
    assert.equal(question.image, `media/${asset}.webp`);
    assert.equal(question.prompt, 'Какой знак зодиака обозначают этим символом?');
    const savedQuestion = oldDeck.rounds[0].categories[4].questions[index];
    savedQuestion.prompt = `${symbol}\n${question.prompt}`;
    delete savedQuestion.image;
  }
  assert.deepEqual(validPack(oldDeck).rounds[0].categories[4].questions, zodiac);
  for (const category of categories) {
    assert.doesNotMatch(category.title, /[A-Za-z]/u);
    for (const { prompt, answer, hint } of category.questions) assert.doesNotMatch(`${prompt} ${answer} ${hint}`, /[A-Za-z]/u);
  }
  assert.doesNotMatch(Object.values(pack.final).join(' '), /[A-Za-z]/u);
  assert.throws(() => {
    const altered = structuredClone(demoPack);
    altered.rounds[0].categories[0].questions[0].image = 'https://example.com/not-bundled.png';
    validPack(altered);
  });
  assert.equal(pack.rounds[1].categories.find(c => c.title === 'Для Вики').questions.length, 4);
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
  assert.equal(publicState(game, pack).opened, true, 'Choosing an ordinary question opens the buzzers');
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

  host('pick', { question: 'c0q3' });
  assert.equal(send('p2', 'buzz', { ticket: game.ticket }), false, 'A handoff waits for a host choice');
  assert.equal(host('open'), true, 'The host can offer a handoff question to everyone');
  assert.equal(publicState(game, pack).opened, true);
  assert.equal(host('undo'), true);
  assert.equal(host('assign', { player: 'p1' }), true);
  assert.equal(game.answering, 'p1');
  host('judge', { verdict: 'neutral' });
  assert.equal(game.players.p1.score, -100);
  assert.equal(send('p2', 'buzz', { ticket: game.ticket }), true);
  host('reveal');
  host('board');

  host('pick', { question: 'c2q1' });
  assert.equal(send('p1', 'buzz', { ticket: game.ticket }), true, 'Double-price questions open immediately');
  host('judge', { verdict: 'correct' });
  assert.equal(game.players.p1.score, 300, 'Double-price questions apply the bonus once');
  host('board');

  const output = JSON.stringify(publicState(game, pack));
  assert.ok(!output.includes(pack.rounds[0].categories[0].questions[0].answer));
  assert.ok(!output.includes(pack.rounds[0].categories[0].questions[0].prompt));

  assert.equal(host('final', { skip: true }), false, 'The final does not open from round one');
  assert.equal(host('next-round'), false, 'Unplayed questions require an explicit skip');
  assert.equal(host('pick', { question: 'r1c0q0' }), false, 'Future round questions stay locked');
  assert.equal(host('next-round', { skip: true }), true);
  assert.equal(game.phase, 'intermission');
  assert.equal(game.roundIndex, 1);
  assert.equal(game.players.p2.score, 100);
  assert.equal(host('undo'), true);
  assert.equal(game.roundIndex, 0);
  assert.ok(game.used.includes('c0q0'));
  assert.equal(host('next-round', { skip: true }), true);
  assert.equal(host('start-round'), true);
  assert.equal(host('pick', { question: 'c0q0' }), false);
  assert.equal(host('pick', { question: 'r1c0q0' }), true);
  assert.equal(send('p1', 'buzz', { ticket }), false);
  host('reveal');
  host('board');
  assert.equal(host('next-round', { skip: true }), true);
  assert.equal(host('start-round'), true);
  assert.equal(game.roundIndex, 2);
  assert.equal(host('next-round', { skip: true }), false);

  assert.equal(host('final'), false);
  assert.equal(host('final', { skip: true }), true);
  assert.equal(send('p2', 'final-answer', { ticket: game.ticket, wager: 200, answer: 'Тайна' }), false);
  assert.equal(send('p2', 'final-answer', { ticket: game.ticket, wager: 75, answer: 'Тайна' }), true);
  assert.ok(!JSON.stringify(publicState(game, pack)).includes('Тайна'), 'Final responses stay off the public scoreboard');
  assert.equal(send('p2', 'final-answer', { ticket: game.ticket, wager: 25, answer: 'Другое' }), false);
  host('finish', { correct: ['p2'] });
  assert.equal(game.players.p2.score, 175);
  assert.equal(host('finish', { correct: ['p2'] }), false, 'A final wager is calculated once');

  const legacy = validPack({ title: 'Старый набор', categories: [{ title: 'Тема', questions: [{ prompt: 'Вопрос?', answer: 'Ответ', value: 100 }] }] });
  assert.equal(legacy.rounds.length, 1);
  assert.equal(legacy.rounds[0].categories[0].questions[0].id, 'c0q0');
  const oldGame = createGame();
  delete oldGame.roundIndex;
  assert.equal(command(oldGame, legacy, { type: 'start' }, true), true);
  assert.equal(command(oldGame, legacy, { type: 'pick', question: 'c0q0' }, true), true);
  oldGame.opened = false;
  const resumed = restoreGame(oldGame, legacy);
  assert.equal(resumed.opened, true, 'A saved question waiting for manual opening can resume');
  assert.equal(resumed.revision, oldGame.revision + 1);
  assert.equal(resumed.ticket, oldGame.ticket);
  assert.equal(restoreGame(resumed, legacy), resumed);
  resumed.previous = { ...oldGame, previous: null };
  assert.equal(command(resumed, legacy, { type: 'undo' }, true), true);
  assert.equal(resumed.opened, true, 'Undo cannot restore a disabled ordinary question');

  const migratedDraft = restoreDraft({ title: 'Свой черновик', categories: [{ title: 'Фото', questions: [{ prompt: '', answer: 'Вика', value: 100 }] }] });
  assert.equal(migratedDraft.rounds[0].categories[0].questions[0].answer, 'Вика');
  const fullGame = createGame();
  const move = (type, more = {}) => command(fullGame, pack, { type, ...more }, true);
  assert.equal(move('start'), true);
  for (const [index, round] of pack.rounds.entries()) {
    assert.equal(remainingQuestions(pack, fullGame), 24);
    for (const category of round.categories) {
      for (const question of category.questions) {
        assert.equal(move('pick', { question: question.id }), true);
        assert.equal(move('reveal'), true);
        assert.equal(move('board'), true);
      }
    }
    assert.equal(remainingQuestions(pack, fullGame), 0);
    if (index < pack.rounds.length - 1) {
      assert.equal(move('next-round'), true);
      assert.equal(move('next-round'), false, 'A double click cannot skip the intermission');
      assert.equal(move('start-round'), true);
    }
  }
  assert.equal(new Set(fullGame.used).size, 72);
  assert.equal(move('final'), true, 'A full three-round run reaches the final with no skips');
  console.log('PASS party quiz: 72 questions, bundled photos, round gates, carryover, undo, legacy packs, buzzer and sealed final');
})().catch(error => { console.error(error); process.exitCode = 1; });
