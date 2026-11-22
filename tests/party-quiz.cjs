const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const { demoPack, validPack, restoreDraft, createGame, restoreGame, command, publicState, remainingQuestions, settle, activeFinal, findQuestion,
    chooser, awaitingHandoff, remover, pace } = await import('../quiz/game.mjs');
  const { screenState, validScreenState, screenPhotoChunk, photoChunkSize, validScreenPhoto } = await import('../quiz/screen.mjs');
  const pack = validPack(demoPack);
  assert.equal(pack.rounds?.length, 3, 'The starter game has three rounds');
  assert.deepEqual(pack.rounds.map(r => r.categories.reduce((n, c) => n + c.questions.length, 0)), [24, 24, 24]);
  const photos = pack.rounds.flatMap(r => r.categories.flatMap(c => c.questions.map(q => q.image))).filter(Boolean);
  assert.equal(photos.length, 52);
  assert.equal(new Set(photos).size, photos.length, 'Every illustrated starter question uses its own image');
  for (const asset of photos) assert.ok(fs.statSync(path.join(__dirname, '../quiz', asset)).size > 1000);
  const categories = pack.rounds.flatMap(round => round.categories);
  assert.deepEqual(pack.rounds.map(round => round.categories.length), [6, 6, 6]);
  for (const title of ['Чей это рюкзак?', 'Цветы по фото', 'Зум на вещь', 'Куда приехали?', 'Что за блюдо?',
    'Игры на столе', 'Кого выдали детали?', 'Угадай инструмент', 'Праздник на фото', 'Пословица по картинке',
    'Где это в России?', 'Сказка по картинке', 'Как сюда доехали?']) {
    assert.equal(categories.find(category => category.title === title).questions.filter(question => question.image).length, 4);
  }
  for (const legacyAsset of ['media/new-care-iron.webp', 'media/new-experiment-egg.webp', 'media/new-macro-velcro.webp']) {
    const olderPack = structuredClone(demoPack);
    olderPack.rounds[0].categories[0].questions[0].image = legacyAsset;
    assert.equal(validPack(olderPack).rounds[0].categories[0].questions[0].image, legacyAsset);
  }
  const zodiacPrompt = 'Какой знак зодиака обозначают этим символом?';
  const zodiac = validPack({
    title: 'Старый набор',
    categories: [{ title: 'Карты и знаки', questions: [
      { value: 100, prompt: `♌
${zodiacPrompt}`, answer: 'Лев' },
      { value: 300, prompt: `♊
${zodiacPrompt}`, answer: 'Близнецы' }
    ] }]
  }).rounds[0].categories[0].questions;
  assert.deepEqual(zodiac.map(({ prompt, image }) => [prompt, image]), [
    [zodiacPrompt, 'media/zodiac-leo.webp'],
    [zodiacPrompt, 'media/zodiac-gemini.webp']
  ]);
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
  assert.throws(() => validPack({ title: 'Пусто', categories: [] }));

  const screenGame = createGame();
  const inviteLink = 'https://example.com/quiz/?play=' + 'a'.repeat(24);
  const lobbyScreen = screenState(screenGame, pack, inviteLink);
  assert.equal(lobbyScreen.invite, inviteLink, 'The TV lobby gets the player link for its QR code');
  assert.ok(validScreenState(lobbyScreen));
  assert.ok(validScreenState(screenState(screenGame, pack)));
  assert.ok(!validScreenState({ ...lobbyScreen, invite: 'javascript:alert(1)' }));
  assert.ok(!validScreenState({ ...lobbyScreen, invite: 'https://example.com/quiz/?play=short' }));
  assert.ok(command(screenGame, pack, { type: 'start' }, true));
  const board = screenState(screenGame, pack, inviteLink);
  assert.equal(board.invite, '');
  assert.ok(validScreenState(board));
  assert.ok(!JSON.stringify(board).includes(pack.rounds[0].categories[0].questions[0].prompt));
  assert.ok(command(screenGame, pack, { type: 'pick', question: 'c0q0' }, true));
  const question = screenState(screenGame, pack);
  assert.ok(validScreenState(question));
  assert.equal(question.question.answer, '');
  assert.equal(question.question.hint, '');
  assert.equal(question.source.final.answer, '');
  assert.ok(!validScreenState({ ...question, question: { ...question.question, image: 'https://example.com/photo.jpg' } }));
  assert.ok(command(screenGame, pack, { type: 'hint' }, true));
  assert.equal(screenState(screenGame, pack).question.hint, pack.rounds[0].categories[0].questions[0].hint);
  assert.ok(command(screenGame, pack, { type: 'reveal' }, true));
  assert.equal(screenState(screenGame, pack).question.answer, pack.rounds[0].categories[0].questions[0].answer);
  const photo = 'data:image/png;base64,' + 'a'.repeat(photoChunkSize);
  assert.equal(screenPhotoChunk(photo, 0) + screenPhotoChunk(photo, 1), photo);
  assert.equal(screenPhotoChunk(photo, 2), '');
  assert.ok(validScreenPhoto(photo));

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
  assert.equal(publicState(game, pack).opened, false, 'Buttons stay closed while the host reads the question');
  assert.equal(send('p1', 'buzz', { ticket, ms: 5 }), false, 'A press before the host opens the buttons does not count');
  assert.equal(host('open'), true);
  assert.equal(host('open'), false);
  assert.equal(send('p2', 'buzz', { ticket: 'old', ms: 5 }), false);
  assert.equal(send('p1', 'buzz', { ticket, ms: 480 }), true);
  assert.equal(game.answering, null, 'The host waits a moment for slower connections before naming the winner');
  assert.equal(publicState(game, pack).racing, true);
  assert.equal(send('p2', 'buzz', { ticket, ms: 210 }), true);
  assert.equal(send('p2', 'buzz', { ticket, ms: 1 }), false, 'Repeated taps do not count twice');
  assert.equal(send('p1', 'buzz', { ticket, ms: 1 }), false);
  assert.equal(host('judge', { verdict: 'correct' }), false, 'Nobody is judged before the race is settled');
  const beforeSettle = game.revision;
  assert.equal(settle(game), true);
  assert.equal(game.revision, beforeSettle + 1);
  assert.equal(game.answering, 'p2', 'The fastest reaction wins even when its message arrived later');
  assert.deepEqual(game.queue, ['p1']);
  assert.equal(settle(game), false);
  assert.equal(publicState(game, pack).racing, false);
  host('judge', { verdict: 'wrong' });
  assert.equal(game.players.p2.score, -100);
  assert.equal(game.answering, 'p1', 'The next player gets the question after a wrong answer');
  host('judge', { verdict: 'wrong' });
  assert.equal(game.players.p1.score, -100);
  assert.equal(game.answering, null);
  assert.equal(game.opened, true);
  host('reveal');
  host('board');
  assert.equal(host('undo'), true);
  host('board');

  host('pick', { question: 'c0q1' });
  host('open');
  assert.equal(send('p1', 'buzz', { ticket: game.ticket, ms: -4 }), true, 'A broken reaction time is ranked last');
  assert.equal(send('p2', 'buzz', { ticket: game.ticket, ms: 59000 }), true);
  settle(game);
  assert.equal(game.answering, 'p2');
  assert.equal(send('p1', 'buzz', { ticket: game.ticket, ms: 3 }), false);
  host('judge', { verdict: 'neutral' });
  assert.equal(game.answering, 'p1');
  host('judge', { verdict: 'correct' });
  assert.equal(game.players.p1.score, 100);
  assert.equal(game.players.p2.score, -100);
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
  assert.equal(game.players.p1.score, 100);
  assert.equal(send('p2', 'buzz', { ticket: game.ticket, ms: 300 }), true);
  host('reveal');
  host('board');

  host('pick', { question: 'c2q1' });
  assert.equal(send('p1', 'buzz', { ticket: game.ticket, ms: 300 }), false, 'Double-price questions wait for the host too');
  host('open');
  assert.equal(send('p1', 'buzz', { ticket: game.ticket, ms: 300 }), true);
  settle(game);
  host('judge', { verdict: 'correct' });
  assert.equal(game.players.p1.score, 500, 'Double-price questions apply the bonus once');
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
  assert.equal(game.players.p2.score, -100);
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
  assert.equal(send('p1', 'final-answer', { ticket: game.ticket, wager: 600, answer: 'Тайна' }), false);
  assert.equal(send('p1', 'final-answer', { ticket: game.ticket, wager: 75, answer: 'Тайна' }), true);
  assert.ok(!JSON.stringify(publicState(game, pack)).includes('Тайна'), 'Final responses stay off the public scoreboard');
  assert.equal(send('p1', 'final-answer', { ticket: game.ticket, wager: 25, answer: 'Другое' }), false);
  host('finish', { correct: ['p1'] });
  assert.equal(game.phase, 'showdown', 'The stakes are opened one by one');
  assert.equal(game.players.p1.score, 500, 'A stake counts when it is opened');
  assert.equal(host('finish', { correct: ['p1'] }), false, 'A final wager is calculated once');
  assert.equal(host('score', { player: 'p1', score: 1 }), false, 'The score is frozen while the stakes are opened');
  assert.equal(screenState(game, pack).session.verdicts.length, 0, 'A closed stake stays off the TV');
  assert.equal(screenState(game, pack).source.final.answer, '');
  assert.equal(host('unveil'), true);
  assert.equal(game.players.p1.score, 575);
  const opened = screenState(game, pack);
  assert.ok(validScreenState(opened));
  assert.deepEqual(opened.session.verdicts.map(v => [v.id, v.wager, v.correct]), [['p1', 75, true]]);
  assert.equal(opened.source.final.answer, pack.final.answer, 'The right answer follows the last stake');
  assert.equal(host('unveil'), true);
  assert.equal(game.phase, 'results');
  assert.equal(game.players.p1.score, 575);

  // Play again: the same room and players, a clean score, no way back into the old results.
  const revisionBefore = game.revision;
  assert.equal(host('again'), true);
  assert.equal(game.phase, 'lobby');
  assert.deepEqual(Object.keys(game.players), ['p1', 'p2'].filter(id => game.players[id]));
  assert.ok(Object.values(game.players).every(player => player.score === 0), 'Scores start from zero');
  assert.ok(Object.keys(game.players).length > 0, 'Players stay in the room');
  assert.equal(game.revision, revisionBefore + 1, 'Phones accept the new lobby as a newer state');
  assert.deepEqual([game.used, game.verdicts, game.finalAnswers, game.previous], [[], [], {}, null]);
  assert.equal(host('undo'), false, 'The finished game cannot be restored over the new one');
  assert.equal(host('again'), false, 'Play again is offered only after the results');
  assert.equal(send('p7', 'join', { name: 'Новенький' }), true, 'New players can join the next game');
  assert.equal(host('start'), true);

  const legacy = validPack({ title: 'Старый набор', categories: [{ title: 'Тема', questions: [{ prompt: 'Вопрос?', answer: 'Ответ', value: 100 }] }] });
  assert.equal(legacy.rounds.length, 1);
  assert.equal(legacy.rounds[0].categories[0].questions[0].id, 'c0q0');
  const oldGame = createGame();
  delete oldGame.roundIndex;
  assert.equal(command(oldGame, legacy, { type: 'start' }, true), true);
  assert.equal(command(oldGame, legacy, { type: 'pick', question: 'c0q0' }, true), true);
  delete oldGame.mode;
  delete oldGame.race;
  delete oldGame.turn;
  assert.equal(restoreGame(oldGame, legacy), oldGame, 'A saved question stays closed until the host opens it');
  assert.equal(publicState(oldGame, legacy).mode, 'buzz');
  assert.equal(command(oldGame, legacy, { type: 'open' }, true), true, 'A game saved by the previous version keeps working');
  assert.equal(command(oldGame, legacy, { id: 'p9', type: 'join', name: 'Гость' }), true);
  assert.equal(command(oldGame, legacy, { id: 'p9', type: 'buzz', ticket: oldGame.ticket, ms: 100 }), true);
  assert.equal(settle(oldGame), true);
  assert.equal(oldGame.answering, 'p9');

  // Answering in turns: no button, players go round the table.
  const table = createGame('turns');
  const seat = (type, data = {}) => command(table, pack, { type, ...data }, true);
  for (const [id, name] of [['p1', 'Аня'], ['p2', 'Боря'], ['p3', 'Вера']]) command(table, pack, { id, type: 'join', name });
  seat('start');
  assert.equal(publicState(table, pack).mode, 'turns');
  assert.equal(publicState(table, pack).turn, 'p1');
  seat('pick', { question: 'c0q0' });
  assert.equal(table.answering, 'p1', 'The player whose turn it is answers first');
  assert.equal(table.opened, false);
  assert.equal(seat('open'), false);
  assert.equal(command(table, pack, { id: 'p2', type: 'buzz', ticket: table.ticket, ms: 1 }), false, 'There is no button race in turns mode');
  seat('judge', { verdict: 'wrong' });
  assert.equal(table.answering, 'p2', 'A miss passes the question to the next seat');
  seat('judge', { verdict: 'neutral' });
  assert.equal(table.answering, 'p3');
  seat('judge', { verdict: 'wrong' });
  assert.equal(table.answering, null, 'Everyone gets one try');
  assert.deepEqual([table.players.p1.score, table.players.p2.score, table.players.p3.score], [-100, 0, -100]);
  seat('reveal');
  seat('board');
  assert.equal(publicState(table, pack).turn, 'p2', 'The turn moves on after every question');
  seat('pick', { question: 'c0q1' });
  assert.equal(table.answering, 'p2');
  seat('judge', { verdict: 'correct' });
  seat('board');
  assert.equal(publicState(table, pack).turn, 'p3');
  seat('pick', { question: 'c0q3' });
  assert.equal(table.answering, null, 'A handoff question still waits for the host');
  assert.equal(seat('open'), true);
  assert.equal(table.answering, 'p3', 'Declining the handoff gives the question to the player whose turn it is');
  seat('judge', { verdict: 'wrong' });
  assert.equal(table.answering, 'p1', 'The round wraps to the first seat');
  seat('reveal');
  seat('board');
  assert.equal(seat('mode', { mode: 'buzz' }), true, 'The host can switch modes between questions');
  assert.equal(seat('mode', { mode: 'buzz' }), false);
  assert.equal(seat('mode', { mode: 'chaos' }), false);
  assert.equal(publicState(table, pack).turn, null);
  seat('pick', { question: 'c0q2' });
  assert.equal(seat('mode', { mode: 'turns' }), false, 'The mode is fixed while a question is open');
  assert.equal(table.answering, null);

  // Converted SIGame packs.
  const packsDir = path.join(__dirname, '../quiz/packs');
  const index = JSON.parse(fs.readFileSync(path.join(packsDir, 'index.json'), 'utf8'));
  assert.equal(index.length, 10);
  assert.equal(new Set(index.map(item => item.title)).size, 10, 'Every pack has its own title');
  const media = new Set();
  for (const item of index) {
    assert.match(item.id, /^[a-z0-9-]{1,24}$/);
    assert.ok(item.title.length <= 80 && item.description && item.themes.length === 3);
    const bundled = validPack(JSON.parse(fs.readFileSync(path.join(packsDir, item.id + '.json'), 'utf8')));
    assert.equal(bundled.title, item.title);
    const questions = bundled.rounds.flatMap(round => round.categories.flatMap(category => category.questions));
    assert.equal(questions.length, item.questions);
    assert.equal(bundled.finals.length, item.finals);
    assert.ok(bundled.finals.length >= 6);
    for (const entry of [...questions, ...bundled.finals]) {
      for (const key of ['image', 'answerImage', 'audio', 'answerAudio']) if (entry[key]) media.add(entry[key]);
    }
  }
  assert.ok(media.size > 600);
  for (const file of media) assert.ok(fs.statSync(path.join(__dirname, '../quiz', file)).size > 200, file);
  assert.deepEqual(fs.readdirSync(path.join(packsDir, 'media')).sort(), [...media].map(file => path.basename(file)).sort(), 'No unused media is shipped');
  assert.throws(() => validPack({ ...demoPack, finals: [{ topic: 'Тема', prompt: 'Вопрос', answer: 'Ответ', image: 'packs/media/../../secret.webp' }] }));
  const inline = 'data:image/png;base64,AAAA';
  assert.throws(() => validPack({ ...demoPack, finals: [{ topic: 'Тема', prompt: 'Вопрос', answer: 'Ответ', answerImage: inline }] }),
    /Фото ответа/, 'The TV frame carries no inline pictures, so a final cannot hold one');
  const inlineAnswer = structuredClone(demoPack);
  inlineAnswer.rounds[0].categories[0].questions[0].answerImage = inline;
  assert.throws(() => validPack(inlineAnswer), /Фото ответа/);
  inlineAnswer.rounds[0].categories[0].questions[0].answerImage = '';
  inlineAnswer.rounds[0].categories[0].questions[0].image = inline;
  assert.equal(validPack(inlineAnswer).rounds[0].categories[0].questions[0].image, inline, 'Question photos may still be uploaded');

  const zodiacPack = validPack(JSON.parse(fs.readFileSync(path.join(packsDir, 'zodiak.json'), 'utf8')));
  const sneakers = zodiacPack.rounds[0].categories[1].questions[0];
  assert.ok(sneakers.image && sneakers.answerImage, 'Picture answers are kept');
  const quiz = createGame();
  const lead = (type, data = {}) => command(quiz, zodiacPack, { type, ...data }, true);
  command(quiz, zodiacPack, { id: 'p1', type: 'join', name: 'Аня' });
  lead('start');
  lead('pick', { question: sneakers.id });
  let shown = screenState(quiz, zodiacPack);
  assert.ok(validScreenState(shown));
  assert.equal(shown.question.image, sneakers.image);
  assert.equal(shown.question.answerImage, '', 'The answer picture stays off the TV until the reveal');
  assert.ok(!JSON.stringify(shown).includes(sneakers.answerImage));
  lead('reveal');
  shown = screenState(quiz, zodiacPack);
  assert.ok(validScreenState(shown));
  assert.equal(shown.question.answerImage, sneakers.answerImage);
  assert.ok(!validScreenState({ ...shown, question: { ...shown.question, answerImage: 'https://example.com/a.webp' } }));
  assert.ok(!validScreenState({ ...shown, question: { ...shown.question, audio: 'packs/media/000000000000.webp' } }));
  lead('board');
  const sounded = zodiacPack.rounds.flatMap(round => round.categories.flatMap(category => category.questions)).find(q => q.audio);
  assert.ok(sounded, 'Audio questions are kept');
  assert.equal(findQuestion(zodiacPack, sounded.id).audio, sounded.audio);
  lead('next-round', { skip: true }); lead('start-round'); lead('next-round', { skip: true }); lead('start-round');
  assert.equal(lead('final', { skip: true, topic: 3 }), true, 'The host chooses the final topic');
  assert.equal(activeFinal(zodiacPack, quiz), zodiacPack.finals[3]);
  assert.equal(publicState(quiz, zodiacPack).finalTopic, zodiacPack.finals[3].topic);
  shown = screenState(quiz, zodiacPack);
  assert.ok(validScreenState(shown));
  assert.equal(shown.source.final.prompt, zodiacPack.finals[3].prompt);
  assert.equal(shown.source.final.answer, '');
  assert.ok(!JSON.stringify(shown).includes(zodiacPack.finals[3].answer));
  lead('finish', { correct: [] });
  shown = screenState(quiz, zodiacPack);
  assert.ok(validScreenState(shown));
  assert.equal(shown.source.final.answer, zodiacPack.finals[3].answer);

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
  // Modifier cards: read out by the host, nobody answers, the score is settled by hand.
  const modPack = validPack({ title: 'Модификаторы', categories: [{ title: 'Сюрприз', questions: [
    { value: 100, prompt: 'Забери 1000 баллов у кого угодно', answer: 'Забери 1000 баллов у кого угодно', kind: 'modifier' },
    { value: 200, prompt: 'Столица Франции?', answer: 'Париж' }] }] });
  const [modCard, plain] = modPack.rounds[0].categories[0].questions;
  assert.equal(modCard.kind, 'modifier');
  for (const mode of ['buzz', 'turns']) {
    const play = createGame(mode);
    const lead = (type, more = {}) => command(play, modPack, { type, ...more }, true);
    command(play, modPack, { id: 'pa', type: 'join', name: 'Аня' });
    command(play, modPack, { id: 'pb', type: 'join', name: 'Боря' });
    assert.equal(lead('score', { player: 'pa', score: 500 }), false, 'No score edits in the lobby');
    lead('start');
    assert.equal(lead('pick', { question: modCard.id }), true);
    assert.equal(play.answering, null, 'Nobody is put on the spot by a modifier, even in turns mode');
    assert.equal(publicState(play, modPack).modifier, true);
    assert.equal(lead('open'), false, 'A modifier never opens the buzzers');
    assert.equal(command(play, modPack, { id: 'pa', type: 'buzz', ticket: play.ticket, time: 300 }), false);
    const frame = screenState(play, modPack);
    assert.ok(validScreenState(frame), 'The TV accepts a modifier card');
    assert.equal(frame.question.kind, 'modifier');
    assert.equal(lead('score', { player: 'pa', score: 1000 }), true);
    assert.equal(lead('score', { player: 'pb', score: -1000 }), true);
    assert.deepEqual([play.players.pa.score, play.players.pb.score], [1000, -1000]);
    assert.equal(lead('undo'), true, 'A wrong edit can be undone');
    assert.equal(play.players.pb.score, 0);
    for (const score of [1.5, '100', NaN, 1e12, 1000]) assert.equal(lead('score', { player: 'pa', score }), false);
    assert.equal(lead('score', { player: 'nobody', score: 5 }), false);
    assert.equal(lead('reveal'), true);
    assert.deepEqual([play.phase, play.current, play.used], ['board', null, [modCard.id]], 'A modifier goes straight back to the board');
    assert.equal(lead('pick', { question: plain.id }), true);
    assert.equal(publicState(play, modPack).modifier, false);
    if (mode === 'buzz') assert.equal(lead('open'), true, 'Ordinary questions still open the buzzers');
    else assert.ok(play.answering, 'Ordinary questions still go to the player whose turn it is');
    lead('reveal');
    lead('board');
    assert.equal(lead('final'), true);
    assert.equal(lead('score', { player: 'pa', score: 5000 }), false, 'Final wagers are capped by the score, so it is frozen');
  }
  {
    // «Своя игра» rules: who chooses, «кот в мешке», the timer setting, a pause, themes of the final struck out in turn.
    const show = createGame();
    const act = (type, extra = {}) => command(show, zodiacPack, { type, ...extra }, true);
    const say = (id, type, extra = {}) => command(show, zodiacPack, { type, id, ticket: show.ticket, ...extra });
    for (const [id, name] of [['pa', 'Аня'], ['pb', 'Боря'], ['pc', 'Вика']]) command(show, zodiacPack, { type: 'join', id, name });
    assert.equal(pace(show), 10);
    assert.equal(act('pace', { seconds: 9 }), false);
    assert.equal(act('pace', { seconds: 15 }), true);
    assert.equal(act('pace', { seconds: 15 }), false);
    assert.equal(act('pause'), false, 'There is nothing to pause in the lobby');
    act('start');
    assert.equal(chooser(show), 'pa', 'The first player opens the game');
    const cards = zodiacPack.rounds[0].categories.flatMap(category => category.questions);
    const plain = cards.find(q => q.kind === 'normal');
    act('pick', { question: plain.id });
    act('open');
    assert.equal(act('pause'), true);
    assert.equal(say('pb', 'buzz', { ms: 200 }), false, 'A paused game takes no buzzes');
    assert.ok(publicState(show, zodiacPack).paused && screenState(show, zodiacPack).session.paused);
    assert.equal(act('pause'), true);
    assert.equal(say('pb', 'buzz', { ms: 200 }), true);
    settle(show);
    act('judge', { verdict: 'correct' });
    assert.equal(chooser(show), 'pb', 'Whoever answered right chooses next');
    assert.equal(screenState(show, zodiacPack).session.turn, 'pb');
    act('pause');
    assert.equal(act('undo'), true, 'A pause does not replace the action that «Отмена» takes back');
    assert.equal(show.phase, 'question');
    assert.equal(show.paused, true, 'Undo leaves the pause as it is');
    act('pause');
    act('reveal'); act('board');
    const cat = cards.find(q => q.kind === 'handoff');
    act('pick', { question: cat.id });
    assert.equal(awaitingHandoff(show, zodiacPack), true);
    let frame = screenState(show, zodiacPack, '', { kind: 'buzz', left: 4000, total: 15000 });
    assert.ok(validScreenState(frame) && frame.session.handoff);
    assert.equal(publicState(show, zodiacPack).prompt, '', 'A «кот в мешке» stays closed on the phones until it is handed over');
    assert.equal(publicState(show, zodiacPack).image, '');
    assert.equal(validScreenState({ ...frame, session: { ...frame.session, timer: { kind: 'buzz', left: -1, total: 15000 } } }), false);
    assert.equal(validScreenState({ ...frame, session: { ...frame.session, timer: { kind: 'wait', left: 1, total: 15000 } } }), false);
    act('assign', { player: 'pc' });
    assert.equal(awaitingHandoff(show, zodiacPack), false);
    assert.equal(show.answering, 'pc');
    assert.equal(publicState(show, zodiacPack).image, cat.image);
    act('judge', { verdict: 'correct' });
    assert.equal(chooser(show), 'pc');
    assert.equal(publicState(show, zodiacPack).answer, cat.answer, 'The phones show the answer once it is revealed');
    act('board');
    act('next-round', { skip: true }); act('start-round'); act('next-round', { skip: true }); act('start-round');
    assert.equal(act('final', { skip: true }), true);
    assert.equal(show.phase, 'themes', 'Several final themes are struck out one by one');
    frame = screenState(show, zodiacPack);
    assert.ok(validScreenState(frame));
    assert.equal(frame.source.themes.length, zodiacPack.finals.length);
    assert.equal(frame.source.final.prompt, '', 'The final question stays closed while themes are struck out');
    const first = remover(show);
    assert.equal(show.players[first].score, Math.min(...Object.values(show.players).map(p => p.score)), 'The lowest score strikes first');
    const other = Object.keys(show.players).find(id => id !== first);
    assert.equal(say(other, 'strike', { topic: 0 }), false, 'Only the player whose turn it is strikes a theme');
    assert.equal(say(first, 'strike', { topic: 0 }), true);
    assert.notEqual(remover(show), first, 'The next player strikes the next theme');
    assert.equal(say(remover(show), 'strike', { topic: 0 }), false, 'A struck theme is gone');
    assert.equal(act('score', { player: 'pa', score: 50 }), true, 'The score can still be corrected before the stakes');
    for (let topic = 1; topic < zodiacPack.finals.length - 1; topic++) assert.equal(act('strike', { topic }), true);
    assert.equal(show.phase, 'final');
    assert.equal(activeFinal(zodiacPack, show), zodiacPack.finals.at(-1), 'The last theme left is played');
    assert.equal(act('strike', { topic: 0 }), false);
    for (const [id, wager] of [['pa', 50], ['pb', 0], ['pc', 100]]) assert.equal(say(id, 'final-answer', { wager, answer: 'Ответ ' + id }), true);
    act('finish', { correct: ['pc'] });
    assert.equal(show.verdicts.at(-1).id, 'pc', 'The leader learns the result last');
    const before = Object.fromEntries(Object.entries(show.players).map(([id, p]) => [id, p.score]));
    assert.equal(act('unveil', { all: true }), true);
    assert.equal(show.phase, 'results');
    assert.deepEqual([show.players.pa.score, show.players.pc.score], [before.pa - 50, before.pc + 100]);
  }
  const imported = fs.readdirSync(path.join(__dirname, '../quiz/packs')).filter(name => name.endsWith('.json') && name !== 'index.json')
    .flatMap(name => validPack(JSON.parse(fs.readFileSync(path.join(__dirname, '../quiz/packs', name), 'utf8'))).rounds)
    .flatMap(round => round.categories.flatMap(category => category.questions));
  assert.equal(imported.filter(question => question.kind === 'modifier').length, 44);
  assert.ok(imported.every(question => !question.prompt.startsWith('[МОДИФИКАТОР]')), 'Modifier cards show their effect, not a placeholder');

  console.log('PASS party quiz: modifiers and manual score, 72 questions, bundled photos, round gates, carryover, undo, legacy packs, fair buzzer, turns mode, 10 converted packs and sealed final');
})().catch(error => { console.error(error); process.exitCode = 1; });
