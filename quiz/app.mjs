import { demoPack, validPack, restoreDraft, createGame, restoreGame, command, publicState, findQuestion, kinds, points,
  standings, activeRound, roundIndex, roundQuestions, remainingQuestions, activeFinal, settle, modes, turnPlayer,
  chooser, awaitingHandoff, finalTopics, remover, paces, pace, answerTime } from './game.mjs?v=22';
import { connectRoom, token, validRoom } from './relay.mjs?v=3';
import { screenState, validScreenState, photoChunkSize, photoBatchSize, screenPhotoChunk, validScreenPhoto } from './screen.mjs?v=7';
import { read, write, photoData } from './storage.mjs?v=2';
import { listenForHost, pairHost, askPin, validPin, waitingUrl } from '../tv-pair.mjs?v=1';

const app = document.querySelector('#app');
const network = document.querySelector('#network');
const notice = document.querySelector('#notice');
const params = new URLSearchParams(location.search);
const numberForm = new Intl.PluralRules('ru');
const questionLabel = count => `${count} ${{ one: 'вопрос', few: 'вопроса', many: 'вопросов', other: 'вопроса' }[numberForm.select(count)]}`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const action = (name, label, attrs = '', style = '') => `<button class="button ${style}" type="button" data-action="${name}" ${attrs}>${label}</button>`;
const stored = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const remember = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const mode = params.has('play') ? 'player' : params.has('tv') ? 'tv' : 'host';

let screen = 'home';
let draft = mode === 'host' ? structuredClone(demoPack) : null;
let editorRound = 0;
let savedRoom = null;
let savedInfo = '';
const plural = (count, one, few, many) => `${count} ${count % 10 === 1 && count % 100 !== 11 ? one :
  count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? few : many}`;
const playersLabel = count => plural(count, 'игрок', 'игрока', 'игроков');
// What the saved room is, so the host can tell "continue" from "new game" at a glance.
function describeSaved(title, session) {
  const stage = session.phase === 'lobby' ? 'сбор игроков' : ['themes', 'final', 'showdown'].includes(session.phase) ? 'финал' :
    session.phase === 'results' ? 'итоги' : `раунд ${roundIndex(session) + 1}`;
  return `${title} · ${stage} · ${playersLabel(Object.keys(session.players || {}).length)}`;
}
let game, pack, room, connection, tvRoom, screenConnection;
let invite = '';
let currentNetwork = [];
let noticeTimer;
let storeTimer;
let localFailure = false;
let sound;
let library = [];
let chosenPack = stored('vne-ocheredi-pack') || 'draft';
let raceTimer;
let wakeLock;
let pair;
const pairLabel = () => ({ attached: 'ТВ подключён ✓', waiting: `ТВ ${pair.pin()}: ждём экран…` })[pair?.state()] || 'Подключить ТВ';
const raceWindow = 300;
const modeNotes = {
  buzz: 'Ведущий читает вопрос и открывает кнопки. Отвечает тот, кто нажал быстрее всех.',
  turns: 'Игроки отвечают по кругу. Ошибся — вопрос переходит следующему.'
};
const correctFinal = new Set();
const pendingPlayerTimers = new Set();

function message(text) {
  notice.textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 5500);
}

function localError() {
  if (localFailure) return;
  localFailure = true;
  message('Браузер не сохранил изменения. Скачайте набор, чтобы сохранить вопросы и фото.');
}

function setNetwork(connections) {
  currentNetwork = connections;
  network.hidden = false;
  network.classList.toggle('online', connections.length > 0);
  network.textContent = connections.includes('lan') ? 'Локальная сеть' :
    connections.length ? 'Сеть подключена' : 'Только этот браузер';
}

function keepAwake() {
  if (wakeLock || !navigator.wakeLock || document.visibilityState !== 'visible') return;
  navigator.wakeLock.request('screen').then(lock => {
    wakeLock = lock;
    lock.addEventListener('release', () => { wakeLock = null; });
  }).catch(() => {});
}

function stayAwake() {
  keepAwake();
  document.addEventListener('visibilitychange', keepAwake);
  document.addEventListener('pointerdown', keepAwake);
}

function unlockSound() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  sound ||= new Audio();
  sound.resume().catch(() => {});
}

function playSignal() {
  if (sound?.state !== 'running') return;
  const oscillator = sound.createOscillator();
  const level = sound.createGain();
  const time = sound.currentTime;
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(660, time);
  oscillator.frequency.setValueAtTime(880, time + .055);
  level.gain.setValueAtTime(.09, time);
  level.gain.exponentialRampToValueAtTime(.001, time + .16);
  oscillator.connect(level).connect(sound.destination);
  oscillator.start();
  oscillator.stop(time + .17);
}

// Short synthesized cues: [frequency, start, length, wave], in seconds.
const cues = {
  pick: [[520, 0, .09], [780, .08, .14]],
  open: [[880, 0, .1], [1175, .1, .2]],
  buzz: [[330, 0, .18, 'square']],
  right: [[523, 0, .12], [659, .11, .12], [784, .22, .12], [1047, .33, .32]],
  wrong: [[196, 0, .22, 'sawtooth'], [147, .2, .4, 'sawtooth']],
  silent: [[392, 0, .18], [330, .18, .34]],
  tick: [[1000, 0, .05, 'square']],
  timeup: [[440, 0, .14, 'square'], [440, .2, .14, 'square'], [330, .4, .42, 'square']],
  round: [[392, 0, .16], [523, .16, .16], [659, .32, .16], [784, .48, .42]],
  cat: [[740, 0, .1], [988, .09, .1], [740, .18, .1], [988, .27, .3]],
  modifier: [[660, 0, .1], [554, .1, .1], [880, .2, .32]],
  final: [[262, 0, .3], [330, .3, .3], [392, .6, .3], [523, .9, .62]],
  results: [[523, 0, .15], [659, .15, .15], [784, .3, .15], [1047, .45, .2], [784, .65, .12], [1047, .78, .62]]
};

function playCue(name) {
  if (sound?.state !== 'running') return;
  const now = sound.currentTime;
  for (const [frequency, start, length, wave = 'triangle'] of cues[name] || []) {
    const oscillator = sound.createOscillator();
    const level = sound.createGain();
    oscillator.type = wave;
    oscillator.frequency.value = frequency;
    level.gain.setValueAtTime(.0001, now + start);
    level.gain.exponentialRampToValueAtTime(wave === 'triangle' ? .16 : .06, now + start + .015);
    level.gain.exponentialRampToValueAtTime(.0001, now + start + length);
    oscillator.connect(level).connect(sound.destination);
    oscillator.start(now + start);
    oscillator.stop(now + start + length + .02);
  }
}

// One countdown strip per page. It runs on this device's clock from the time left that the host reported.
const strip = { end: 0, kind: '', paused: false, ticks: [] };
function showTimer(timer, paused = false, ticking = false) {
  let bar = document.querySelector('#timer');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'timer';
    bar.innerHTML = '<i></i>';
    bar.hidden = true;
    document.body.append(bar);
  }
  if (timer) timer = { ...timer, left: Math.max(0, timer.left - (paused || !timer.at ? 0 : Date.now() - timer.at)) };
  const end = timer ? Date.now() + timer.left : 0;
  if (timer && !bar.hidden && timer.kind === strip.kind && paused === strip.paused &&
      (paused || Math.abs(end - strip.end) < 900 || (!timer.left && strip.end <= Date.now()))) return;
  strip.ticks.forEach(clearTimeout);
  Object.assign(strip, { end, kind: timer?.kind || '', paused, ticks: [] });
  bar.hidden = !timer;
  if (!timer) return;
  bar.dataset.kind = timer.kind;
  const fill = bar.firstChild;
  fill.style.animation = 'none';
  fill.style.transform = `scaleX(${timer.left / timer.total})`;
  if (paused) return;
  void fill.offsetWidth;
  fill.style.animation = `timer-run ${timer.left}ms linear forwards`;
  if (!ticking) return;
  for (const second of [3, 2, 1]) {
    if (timer.left > second * 1000) strip.ticks.push(setTimeout(() => playCue('tick'), timer.left - second * 1000));
  }
  if (timer.kind === 'answer') strip.ticks.push(setTimeout(() => playCue('timeup'), timer.left));
}

function pageLink(type, code = room) {
  const link = new URL('./', location.href);
  link.searchParams.set(type, code);
  return link;
}

function tvLink() {
  const link = pageLink('tv', tvRoom);
  if (invite) link.hostname = new URL(invite).hostname;
  return link;
}

function scoreList(players, editable = false) {
  return players.length
    ? `<ul class="scores${players.length > 6 ? ' scores-crowd' : ''}">${players.map(p => `<li><span title="${escape(p.name)}">${escape(p.name)}</span><strong>${p.score}</strong>${
      editable ? `<button class="score-edit" type="button" data-action="score" data-player="${escape(p.id)}" aria-label="Изменить счёт: ${escape(p.name)}">✎</button>` : ''}</li>`).join('')}</ul>`
    : `<p class="muted">Игроки ещё не подключились</p>`;
}

// Modifier cards («забери 1000 баллов», «плюс на минус») and disputes are settled by hand.
function askScore(name, score) {
  const dialog = document.createElement('dialog');
  dialog.className = 'score-dialog';
  dialog.innerHTML = `<form method="dialog"><h2></h2>
    <label><span>Новый счёт</span><input name="score" type="number" step="1" required></label>
    <div class="score-steps">${[-1000, -500, -100, 100, 500, 1000].map(step =>
      `<button type="button" data-step="${step}">${step > 0 ? '+' : '−'}${Math.abs(step)}</button>`).join('')}
      <button type="button" data-times="-1">Плюс на минус</button><button type="button" data-times="0.5">× 0.5</button></div>
    <div class="actions"><button class="button primary" value="ok">Сохранить</button><button class="button quiet" value="cancel" formnovalidate>Отмена</button></div></form>`;
  dialog.querySelector('h2').textContent = 'Счёт: ' + name;
  const input = dialog.querySelector('input');
  input.value = score;
  dialog.addEventListener('click', event => {
    const box = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close('cancel');
    const { step, times } = event.target.dataset || {};
    if (step || times) input.value = Math.round(step ? (Number(input.value) || 0) + Number(step) : (Number(input.value) || 0) * Number(times));
  });
  document.body.append(dialog);
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const value = Math.round(Number(input.value));
      dialog.remove();
      resolve(dialog.returnValue === 'ok' && input.value !== '' && Number.isSafeInteger(value) ? value : null);
    });
    dialog.showModal();
  });
}

function cardGrid(source, used = [], canPick = false, picked = '') {
  return `<div class="board">${source.categories.map(category => `
    <section class="topic"><h2>${escape(category.title)}</h2><div class="values">
      ${category.questions.map(q => {
        const spent = used.includes(q.id);
        const photo = q.image ? 'has-image' : '';
        return canPick
          ? action('pick', spent ? '✓' : String(q.value), `data-id="${q.id}" aria-label="${escape(category.title)} · ${q.value}${q.image ? ' · фото' : ''}" ${spent ? 'disabled' : ''}`, `value ${photo}`)
          : `<span class="value${spent ? ' spent' : ''}${q.id === picked ? ' picked' : ''}">${spent ? '' : q.value}</span>`;
      }).join('')}
    </div></section>`).join('')}</div>`;
}

function roundRail(source, session) {
  const current = roundIndex(session);
  const inFinal = ['themes', 'final', 'showdown', 'results'].includes(session.phase);
  return `<ol class="round-rail" aria-label="Этапы игры">${source.rounds.map((round, index) => {
    const status = inFinal || index < current ? 'done' : index === current ? 'current' : 'upcoming';
    return `<li data-stage="${index + 1}" class="${status}" ${status === 'current' ? 'aria-current="step"' : ''}>
      ${round.title === 'Раунд ' + (index + 1) ? '' : `<span>Раунд ${index + 1}</span>`}<strong>${escape(round.title)}</strong></li>`;
  }).join('')}${source.final ? `<li data-stage="final" class="${inFinal ? 'current' : 'upcoming'}" ${inFinal ? 'aria-current="step"' : ''}>
    <strong>Финал</strong></li>` : ''}</ol>`;
}

function intermission(source, session, isHost) {
  const next = activeRound(source, session);
  return `<section class="panel intermission" data-stage="${roundIndex(session) + 1}">
    <p class="eyebrow">${next.title === 'Раунд ' + (roundIndex(session) + 1) ? 'Перерыв' : 'Перерыв перед раундом ' + (roundIndex(session) + 1)}</p><h1>${escape(next.title)}</h1>
    ${next.note ? `<p class="intro">${escape(next.note)}</p>` : ''}
    ${isHost ? action('start-round', 'Начать раунд', '', 'primary') : '<p class="muted">Ждём сигнала ведущего</p>'}
  </section>`;
}

function questionPanel(question, session, picker = '') {
  if (!question) return '';
  const reveal = session.phase === 'reveal';
  const announcing = session.answering && session.players[session.answering]?.name;
  const photo = reveal && question.answerImage || question.image;
  const modifier = question.kind === 'modifier';
  const waiting = modifier ? (picker ? 'Модификатор получает ' + escape(picker) : 'Ведущий применяет модификатор') :
    question.kind === 'handoff' ? 'Ведущий выбирает игрока' :
    session.mode === 'turns' ? 'Ждём ведущего' : 'Слушаем вопрос. Кнопки пока закрыты';
  // Pack questions that are only a picture or a sound carry the theme name as their text: do not repeat it.
  const textless = !modifier && !reveal && question.prompt === question.category && Boolean(question.image || question.audio);
  const state = `<p class="question-state${session.opened && !announcing ? ' open' : ''}">${announcing ? (question.kind === 'handoff' ? 'Кот в мешке · отвечает ' : 'Отвечает ') + escape(announcing) : session.opened ? 'Жмите кнопку!' : waiting}</p>`;
  const asking = `${textless ? (photo ? '' : '<p class="listen"><span aria-hidden="true">♪</span> Слушайте</p>') : `<h1${question.prompt.length > 140 ? ' class="long"' : ''}>${escape(question.prompt)}</h1>`}
      ${question.audio && !textless ? '<p class="sound-note"><span aria-hidden="true">♪</span> Вопрос со звуком</p>' : ''}
      ${session.showHint && question.hint ? `<p class="hint">${escape(question.hint)}</p>` : ''}${state}`;
  const answered = `<div class="answer-reveal"><p class="answer-label">Ответ</p>
      <h1 class="revealed${question.answer.length > 70 ? ' long' : ''}">${escape(question.answer)}</h1></div>
      ${question.prompt === question.category ? '' : `<p class="asked">${escape(question.prompt)}</p>`}`;
  return `<article class="question panel${photo ? ' has-photo' : ''}${textless ? ' textless' : ''}${reveal ? ' answered' : ''}${modifier ? ' modifier' : ''}" data-stage="${roundIndex(session) + 1}">
    ${photo ? `<figure class="question-figure"><img class="question-image" src="${escape(photo)}" alt="${reveal && question.answerImage ? 'Фото с ответом' : 'Фото к вопросу'}"></figure>` : ''}
    <div class="question-copy">
      <p class="question-category">${escape(question.category)} <span>${modifier ? 'Модификатор' : points(question) + ' очков'}</span></p>
      ${reveal ? answered : asking}
    </div>
  </article>`;
}

function finalPanel(final, note) {
  return `<article class="question panel ${final.image ? 'has-photo' : ''}" data-stage="final">
    ${final.image ? `<figure class="question-figure"><img class="question-image" src="${escape(final.image)}" alt="Фото к финалу"></figure>` : ''}
    <div class="question-copy"><p class="eyebrow">Финал · ${escape(final.topic)}</p><h1>${escape(final.prompt)}</h1>
      ${final.audio ? '<p class="sound-note"><span aria-hidden="true">♪</span> Вопрос со звуком</p>' : ''}<p class="muted">${note}</p></div></article>`;
}

function modeSwitch() {
  const current = game.mode || 'buzz';
  return `<div class="mode-switch"><div class="actions" role="group" aria-label="Режим ответов">${Object.entries(modes).map(([id, label]) =>
    action('mode', label, `data-mode="${id}" aria-pressed="${id === current}"`, id === current ? 'primary' : '')).join('')}</div>
    <p class="muted">${modeNotes[current]}</p></div>`;
}

function paceSwitch() {
  const current = pace(game);
  return `<div class="mode-switch pace-switch"><div class="actions" role="group" aria-label="Таймер">${Object.entries(paces).map(([seconds, label]) =>
    action('pace', label, `data-seconds="${seconds}" aria-pressed="${Number(seconds) === current}"`, Number(seconds) === current ? 'primary' : '')).join('')}</div>
    <p class="muted">${current ? `На нажатие кнопки ${current} с, на ответ ${answerTime} с. Никто не нажал — ответ откроется сам.` :
      'Время не ограничено: ответ открывает ведущий.'}</p></div>`;
}

// The final: themes are struck out in turn until one is left.
function themesPanel(themes, removerName, isHost) {
  const left = themes.filter(theme => !theme.out).length;
  return `<section class="panel themes" data-stage="final"><p class="eyebrow">Финал · осталось тем: ${left}</p>
    <h1>${removerName ? 'Убирает тему: ' + escape(removerName) : 'Выбираем тему финала'}</h1>
    <ul class="theme-list">${themes.map((theme, index) => `<li class="${theme.out ? 'out' : ''}"><span>${escape(theme.topic)}</span>${isHost && !theme.out ?
      `<span class="actions">${action('strike', 'Убрать', `data-topic="${index}" aria-label="Убрать тему: ${escape(theme.topic)}"`)}${action('final-topic', 'Играть её', `data-topic="${index}" aria-label="Играть тему: ${escape(theme.topic)}"`, 'quiet')}</span>` : ''}</li>`).join('')}</ul>
    ${isHost ? '<p class="muted">Игрок называет тему, которую убирает, или убирает её на своём телефоне. Играет последняя оставшаяся.</p>' : ''}</section>`;
}

// The final: stakes are opened one by one, the lowest score first.
function showdownPanel(session, final, total) {
  const last = session.verdicts[session.verdicts.length - 1];
  return `<section class="panel showdown" data-stage="final"><p class="eyebrow">Финал${final?.topic ? ' · ' + escape(final.topic) : ''} · открыто ${session.verdicts.length} из ${total}</p>
    ${last ? `<h1>${escape(session.players[last.id]?.name)}</h1><p class="stake-answer">«${escape(last.answer)}»</p>
      <p class="stake ${last.correct ? 'up' : 'down'}">${last.correct ? 'Верно' : 'Неверно'} · ${last.wager ? (last.correct ? '+' : '−') + last.wager : 'без ставки'}</p>` : '<h1>Открываем ставки</h1><p class="muted">Начинаем с последнего места.</p>'}
    ${final?.answer ? `<div class="answer-reveal"><p class="answer-label">Правильный ответ</p><p class="revealed">${escape(final.answer)}</p></div>` : ''}
    ${session.verdicts.length > 1 ? `<ul class="verdicts">${session.verdicts.slice(0, -1).map(v =>
      `<li>${escape(session.players[v.id]?.name)} · ${v.correct ? '+' : '−'}${v.wager} · ${escape(v.answer)}</li>`).join('')}</ul>` : ''}
  </section>`;
}

function resultsPanel(session, source) {
  const final = source.finals ? activeFinal(source, session) : source.final;
  const ranking = standings(session);
  const leaders = ranking.filter(player => player.score === ranking[0]?.score);
  return `<section class="panel result">
    <p class="eyebrow">Результаты</p>
    <h1>${leaders.length > 3 ? 'Ничья' : leaders.length ? escape(leaders.map(p => p.name).join(' и ')) : 'Игра окончена'}</h1>
    ${leaders.length ? `<p>${leaders[0].score} очков</p>` : ''}
    ${scoreList(ranking)}
    ${final && session.verdicts.length ? `<p class="answer-label">Ответ в финале</p><p class="revealed">${escape(final.answer)}</p>
      ${final.answerImage ? `<img class="final-answer-image" src="${escape(final.answerImage)}" alt="Фото с ответом">` : ''}
      <ul class="verdicts">${session.verdicts.map(v => `<li>${escape(session.players[v.id]?.name)} · ${v.correct ? '+' : '−'}${v.wager} · ${escape(v.answer)}</li>`).join('')}</ul>` : ''}
  </section>`;
}

// After the results the host starts the next game in the same room: players and the TV stay.
function againPanel() {
  const cards = packCards();
  const current = cards.findIndex(card => card.title === pack.title);
  const next = cards[(current + 1) % cards.length].id;
  return `<section class="panel again"><h2>Сыграть ещё</h2>
    <p>Игроки и ТВ остаются в этой комнате, счёт начнётся с нуля.</p>
    <label><span>Набор вопросов</span><select id="again-pack">${cards.map(card =>
      `<option value="${escape(card.id)}"${card.id === next ? ' selected' : ''}>${escape(card.title)}</option>`).join('')}</select></label>
    <div class="actions">${action('again', 'Сыграть ещё', '', 'primary')}${action('close', 'Закончить вечер', '', 'quiet')}</div>
  </section>`;
}

async function loadPack(id) {
  const bundled = library.find(item => item.id === id);
  if (!bundled) return validPack(draft);
  const response = await fetch(`./packs/${bundled.id}.json`);
  if (!response.ok) throw new Error('Набор не загрузился. Проверьте связь и попробуйте ещё раз.');
  return validPack({ ...await response.json(), title: bundled.title });
}

// validPack reads `finals` when a draft has it, so the editor edits the same list.
const draftFinals = () => draft.finals || (draft.final ? [draft.final] : []);

function packCards() {
  const own = { id: 'draft', title: draft.title || 'Свой набор', description: 'Набор из редактора: вопросы можно менять.',
    questions: draft.rounds.reduce((total, round) => total + roundQuestions(round).length, 0),
    themes: draft.rounds.map(round => round.categories.map(category => category.title)), finals: draftFinals().length };
  return [own, ...library];
}

function renderHome() {
  document.body.classList.add('home');
  const cards = packCards();
  const chosen = cards.find(card => card.id === chosenPack) || cards[0];
  const count = chosen.questions;
  const photos = chosen.id === 'draft' ? draft.rounds.flatMap(roundQuestions).filter(question => question.image).length : 0;
  const menu = savedRoom
    ? `<p class="saved-room">Игра идёт${savedInfo ? ': ' + escape(savedInfo) : ''}</p><div class="actions">
        <a class="button primary" href="${escape(pageLink('host', savedRoom))}">Продолжить игру</a>${action('launch', 'Новая игра')}${action('edit', 'Редактор вопросов')}</div>`
    : `<div class="actions">${action('launch', 'Создать комнату', '', 'primary')}${action('edit', 'Редактор вопросов')}</div>`;
  const picked = `<p class="picked-pack">Набор: <strong>${escape(chosen.title)}</strong> · <a href="#packs">выбрать другой</a></p>`;
  app.innerHTML = `<section class="hero">
    <div class="hero-copy">
      <a class="menu-link" href="../"><span aria-hidden="true">←</span> Все игры</a>
      <p class="eyebrow">Квиз для компании</p>
      <h1>Вне очереди<span>.</span></h1>
      <p class="intro">Вопросы на ТВ. Кнопка на телефоне. Ответы вслух.</p>
      <div class="hero-facts"><strong>${questionLabel(count)}</strong>${photos ? `<span>${questionLabel(photos)} с фото</span>` : ''}${chosen.finals ? '<span>Финал со ставками</span>' : ''}</div>
      <nav class="home-menu" aria-label="Главное меню">${picked}${menu}</nav>
    </div>
    <figure class="hero-art"><img src="./media/auditorium.webp" alt="Зрительный зал, вид со сцены" fetchpriority="high"></figure>
  </section>
  <section class="pack-library" id="packs"><div class="deck-title"><h2>Выберите набор вопросов</h2><span>${cards.length} ${cards.length === 1 ? 'набор' : 'наборов'}</span></div>
    <div class="pack-list" role="radiogroup" aria-label="Набор вопросов">${cards.map(card => `<button type="button" class="pack-card" role="radio"
      aria-checked="${card.id === chosen.id}" data-action="choose-pack" data-id="${escape(card.id)}"><strong>${escape(card.title)}</strong>
      <span>${escape(card.description)}</span><small>${questionLabel(card.questions)}</small></button>`).join('')}</div>
    <div class="actions pack-go">${action('launch', savedRoom ? 'Новая игра с этим набором' : 'Создать комнату с этим набором', '', 'primary')}</div></section>
  <section class="home-deck"><div class="deck-title"><h2>${escape(chosen.title)}</h2><span>${chosen.themes.length} ${chosen.themes.length === 1 ? 'раунд' : 'раунда'}</span></div>
    <div class="deck-rounds">${chosen.themes.map((titles, index) => `<article class="deck-round" data-stage="${index + 1}">
      <p class="eyebrow">Раунд ${index + 1}</p>${chosen.id === 'draft' ? `<h3>${escape(draft.rounds[index].title)}</h3>` : ''}
      <ul>${titles.map(title => `<li>${escape(title)}</li>`).join('')}</ul>
    </article>`).join('')}</div></section>
  <footer class="home-footer"><a href="./credits.html">Фото и лицензии</a></footer>`;
}

function field(label, path, value, options = {}) {
  const attrs = `data-field="${path}"${options.max ? ` maxlength="${options.max}"` : ''}`;
  return `<label><span>${label}</span>${options.area ? `<textarea ${attrs} rows="2">${escape(value)}</textarea>` :
    `<input ${attrs} type="${options.type || 'text'}" ${options.type === 'number' ? 'min="1" max="9999" step="1"' : ''} value="${escape(value)}">`}</label>`;
}

function renderEditor() {
  document.body.classList.remove('home');
  const round = draft.rounds[editorRound];
  const finals = draft.finals = draftFinals();
  const final = draft.final = finals[0] || null;
  const path = `rounds.${editorRound}`;
  app.innerHTML = `<section class="editor">
    <div class="section-top"><div><p class="eyebrow">Подготовка</p><h1>Редактор вопросов</h1><p class="muted">Фото и ответы сохраняются в этом браузере. Скачайте набор, чтобы перенести его на другой компьютер.</p></div>
      <div class="actions">${action('home', 'На главную')}${action('launch', 'Создать комнату', '', 'primary')}</div></div>
    <div class="panel editor-tools">
      ${field('Название набора', 'title', draft.title, { max: 80 })}
      <div class="actions">${action('export', 'Скачать набор')}<label class="button file-button">Загрузить набор<input data-import type="file" accept=".json,application/json"></label>${action('starter', 'Стартовый набор', '', 'quiet')}</div>
    </div>
    <div class="actions editor-rounds" aria-label="Редактировать раунд">${draft.rounds.map((item, index) => action('edit-round', escape(item.title || `Раунд ${index + 1}`), `data-i="${index}" aria-pressed="${index === editorRound}"`, index === editorRound ? 'primary' : '')).join('')}
      ${draft.rounds.length < 3 ? action('add-round', '+ Раунд') : ''}</div>
    <section class="panel category-editor round-editor" data-stage="${editorRound + 1}">
      <div class="category-head">${field('Название раунда', path + '.title', round.title, { max: 48 })}
        ${draft.rounds.length > 1 ? action('delete-round', 'Удалить раунд', '', 'quiet') : ''}</div>
      ${field('Заметка для экрана ТВ', path + '.note', round.note, { max: 160 })}
    </section>
    ${round.categories.map((c, i) => `<section class="panel category-editor">
       <div class="category-head">${field('Тема', `${path}.categories.${i}.title`, c.title, { max: 60 })}
        ${action('delete-topic', 'Удалить тему', `data-i="${i}" ${round.categories.length === 1 ? 'disabled' : ''}`, 'quiet')}</div>
       ${c.title === 'Вика в кадре?' ? '<p class="muted">Для своей версии добавьте фото и решите, что угадывать: Вику, сам образ или деталь кадра.</p>' : ''}
       ${c.questions.map((q, j) => {
        const base = `${path}.categories.${i}.questions.${j}`;
        return `<details class="question-editor" ${!q.prompt ? 'open' : ''}>
          <summary><strong>${q.value || '—'}</strong><span>${escape(q.prompt || 'Новый вопрос')}</span>${q.image ? '<span aria-label="Есть фото">▧</span>' : ''}</summary>
          <div class="question-fields">
            ${field('Вопрос', base + '.prompt', q.prompt, { area: true, max: 1200 })}
            ${field('Ответ для ведущего', base + '.answer', q.answer, { area: true, max: 650 })}
            ${field('Подсказка по желанию', base + '.hint', q.hint, { area: true, max: 380 })}
            <div class="field-row">${field('Очки', base + '.value', q.value, { type: 'number' })}
              <label><span>Правило</span><select data-field="${base}.kind">${Object.entries(kinds).map(([id, label]) =>
                `<option value="${id}" ${(q.kind || 'normal') === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
            <div class="actions"><label class="button file-button">${q.image ? 'Заменить фото' : 'Добавить фото'}<input data-photo="${base}.image" type="file" accept="image/*"></label>
              ${q.image ? action('remove-photo', 'Убрать фото', `data-path="${base}.image"`, 'quiet') : ''}
              ${action('delete-question', 'Удалить вопрос', `data-i="${i}" data-j="${j}" ${c.questions.length === 1 ? 'disabled' : ''}`, 'quiet')}</div>
            ${q.image ? `<img class="editor-photo" src="${escape(q.image)}" alt="Фото к вопросу">` : ''}
          </div></details>`;
       }).join('')}
       ${action('add-question', '+ Вопрос', `data-i="${i}" ${c.questions.length >= 8 ? 'disabled' : ''}`)}
    </section>`).join('')}
    ${action('add-topic', '+ Добавить тему', round.categories.length >= 8 ? 'disabled' : '', 'primary')}
    <section class="panel category-editor final-editor"><div class="category-head"><h2>Финал${finals.length > 1 ? ` · тема 1 из ${finals.length}` : ''}</h2>
      ${final ? action('remove-final', finals.length > 1 ? 'Убрать тему' : 'Убрать финал', '', 'quiet') : action('add-final', 'Добавить финал')}</div>
      ${final ? field('Тема финала', 'finals.0.topic', final.topic, { max: 60 }) +
        field('Вопрос', 'finals.0.prompt', final.prompt, { area: true, max: 1200 }) +
        field('Ответ', 'finals.0.answer', final.answer, { area: true, max: 650 }) : ''}</section>
  </section>`;
}

function lobbySteps() {
  const attached = pair?.state() === 'attached';
  const count = Object.keys(game.players).length;
  return `<ol class="steps">
    <li${attached ? ' class="done"' : ''}><strong>Экран</strong><span>${attached ? 'ТВ подключён и показывает комнату.'
      : 'На ТВ или ноутбуке с проектором откройте этот сайт и выберите «Это экран ТВ». Потом нажмите «Подключить ТВ» вверху и введите код с экрана.'}</span></li>
    <li${count ? ' class="done"' : ''}><strong>Игроки</strong><span>${count ? 'В комнате ' + playersLabel(count) + '. Остальные могут войти и после старта.'
      : 'Игроки сканируют QR-код с экрана или открывают ссылку, которую вы им отправите.'}</span></li>
    <li><strong>Старт</strong><span>Выберите режим ответов и нажмите «Начать игру».</span></li>
  </ol>`;
}

function lobby() {
  return `<div class="dashboard">
    <section class="panel lobby-copy"><p class="eyebrow">Комната открыта</p><h1>${escape(pack.title)}</h1>
      ${lobbySteps()}
      <div class="actions">${action('start', 'Начать игру', '', 'primary')}${action('copy', 'Скопировать ссылку')}</div>
      <h2>Режим ответов</h2>${modeSwitch()}
      <h2>Таймер</h2>${paceSwitch()}
      <h2>Игроки <span class="count">${Object.keys(game.players).length}/12</span></h2>${scoreList(standings(game))}
      <a class="text-link" href="${escape(pageLink('play'))}" target="_blank" rel="noopener">Открыть игрока в новой вкладке ↗</a>
    </section>
    <section class="panel invite"><div id="join-qr"></div><a href="${escape(invite)}" target="_blank" rel="noopener">Ссылка для входа ↗</a></section>
  </div>`;
}

function renderHost() {
  const phase = game.phase;
  const current = findQuestion(pack, game.current);
  const round = activeRound(pack, game);
  const stage = roundIndex(game) + 1;
  const remaining = remainingQuestions(pack, game);
  const isLastRound = stage === pack.rounds.length;
  const picker = game.players[chooser(game)]?.name || '';
  let content;
  if (phase === 'lobby') content = lobby();
  if (phase === 'board') content = `<section class="panel round-board" data-stage="${stage}">
    <div class="section-top"><div><p class="eyebrow">${round.title === 'Раунд ' + stage ? 'Осталось' : `Раунд ${stage} · осталось`} ${remaining} из ${roundQuestions(round).length}</p><h1>${escape(round.title)}</h1></div>
    <div class="actions">${isLastRound ? action('final', pack.final ? 'Перейти в финал' : 'Завершить игру', '', remaining ? '' : 'primary') :
      action('next-round', `К раунду ${stage + 1}`, '', remaining ? '' : 'primary')}</div></div>
    ${picker ? `<p class="turn-note">${game.mode === 'turns' ? 'Выбирает и отвечает первым' : 'Выбирает вопрос'}: <strong>${escape(picker)}</strong></p>` : ''}
    ${cardGrid(round, game.used, true)}${modeSwitch()}${paceSwitch()}</section>`;
  if (phase === 'intermission') content = intermission(pack, game, true);
  if (phase === 'question' || phase === 'reveal') {
    const queue = game.queue.map(id => game.players[id].name);
    const turns = game.mode === 'turns';
    const idle = phase === 'question' && !game.opened && !game.answering;
    const handoff = awaitingHandoff(game, pack);
    // «Кот в мешке» goes to somebody else, as in «Своя игра»; with a single player there is nobody else.
    const heirs = standings(game).filter(p => p.id !== chooser(game) || Object.keys(game.players).length === 1);
    const track = phase === 'reveal' ? current?.answerAudio : current?.audio;
    const status = game.race?.length ? 'Фиксируем, кто первый…' : game.opened && !game.answering ? 'Кнопки открыты. Ждём нажатия' :
      idle && turns && !handoff ? 'Все игроки ответили' : '';
    content = `<div class="question-layout">${questionPanel(current, game, picker)}
      <aside class="panel host-actions"><h2>Пульт ведущего</h2>
        ${track ? `<div class="host-sound"><audio controls preload="none" src="${escape(track)}"></audio>${action('replay', 'Повторить звук на ТВ')}</div>` : ''}
        ${phase === 'reveal' ? `<div class="dock">${action('board', 'К табло', '', 'primary')}</div>` : current?.kind === 'modifier' ? `
        <p class="muted">Модификатор достаётся тому, кто выбрал вопрос${picker ? ': <strong>' + escape(picker) + '</strong>' : ''}. Прочитайте карточку и поправьте счёт кнопкой ✎ в блоке «Счёт».</p>
        <div class="dock">${action('reveal', 'К табло', '', 'primary')}</div>` : `
        <p class="host-answer"><span>Ответ</span>${escape(current?.answer)}</p>
        ${idle && !turns && !handoff ? `<div class="dock">${action('open', 'Принимать ответы', '', 'primary')}</div><p class="muted">Прочитайте вопрос и откройте кнопки. Кто нажмёт раньше, получит блокировку на секунду.</p>` : ''}
        ${status ? `<p class="answering">${status}</p>` : ''}
        ${handoff ? `<p class="answering">Кот в мешке${picker ? ': ' + escape(picker) + ' отдаёт вопрос' : ''}</p>
          <div class="heirs" role="group" aria-label="Кому отдать вопрос">${heirs.map(p => action('assign', escape(p.name), `data-player="${p.id}"`)).join('')}</div>
          ${action('open', turns ? 'Отвечает тот, чей ход' : 'Дать ответить всем', '', 'quiet')}` : ''}
        ${game.answering ? `<p class="answering">${escape(game.players[game.answering].name)}</p>
          <div class="dock decisions">${action('judge', '+' + points(current) + ' · Верно', 'data-verdict="correct"', 'primary')}${action('judge', '−' + points(current) + ' · Неверно', 'data-verdict="wrong"')}${action('judge', '0 · Без штрафа', 'data-verdict="neutral"')}</div>` : ''}
        ${queue.length ? `<p class="muted">Следом: ${escape(queue.join(', '))}</p>` : ''}
        ${current?.hint && !game.showHint ? action('hint', 'Дать подсказку') : ''}
        ${action('reveal', 'Открыть ответ')}`}
      </aside></div>`;
  }
  const final = activeFinal(pack, game);
  if (phase === 'final') content = `<div class="question-layout">${finalPanel(final, 'Все отвечают на телефонах и ставят от нуля до своих очков.')}
    <aside class="panel host-actions"><h2>Принятые ответы <span class="count">${Object.keys(game.finalAnswers).length}/${Object.keys(game.players).length}</span></h2>
    ${final.audio ? `<div class="host-sound"><audio controls preload="none" src="${escape(final.audio)}"></audio>${action('replay', 'Повторить звук на ТВ')}</div>` : ''}
    <p class="host-answer"><span>Правильный ответ</span>${escape(final.answer)}</p>
    ${Object.entries(game.finalAnswers).map(([id, entry]) => `<label class="final-entry"><input type="checkbox" data-correct="${id}" ${correctFinal.has(id) ? 'checked' : ''}><span><strong>${escape(game.players[id].name)}</strong> · ставка ${entry.wager}<br>${escape(entry.answer)}</span></label>`).join('')}
    <p class="muted">Отметьте верные ответы. Ставки откроются по одной, с последнего места.</p><div class="dock">${action('finish', 'Открыть ставки', '', 'primary')}</div></aside></div>`;
  if (phase === 'themes') content = themesPanel(finalTopics(pack, game), game.players[remover(game)]?.name, true);
  if (phase === 'showdown') {
    const next = game.verdicts[game.revealed];
    const shown = { players: game.players, verdicts: game.verdicts.slice(0, game.revealed) };
    content = `<div class="question-layout">${showdownPanel(shown, final, game.verdicts.length)}
      <aside class="panel host-actions"><h2>Ставки</h2>
      <ol class="verdicts">${game.verdicts.map((v, index) => `<li class="${index < game.revealed ? '' : 'muted'}">${escape(game.players[v.id].name)} · ${escape(v.answer)} · ${v.correct ? '+' : '−'}${v.wager}</li>`).join('')}</ol>
      <div class="dock">${next ? action('unveil', 'Открыть: ' + escape(game.players[next.id].name), '', 'primary') + action('unveil', 'Сразу итоги', 'data-all="true"', 'quiet') :
        action('unveil', 'Показать итоги', '', 'primary')}</div></aside></div>`;
  }
  if (phase === 'results') content = resultsPanel(game, pack) + againPanel();
  const heard = app.querySelector('.host-sound audio');
  // During the game the phone is a remote: service buttons fold into a menu, the verdict buttons stay under the thumb.
  const running = !['lobby', 'results'].includes(phase);
  const menuOpen = app.querySelector('.room-menu')?.open;
  const service = `${action('pair', pairLabel(), '', pair?.state() === 'attached' ? '' : 'primary')}<a class="button quiet" href="${escape(tvLink())}" data-tv target="_blank" rel="noopener">Экран ТВ здесь ↗</a>${action('copy-tv', 'Ссылка ТВ', '', 'quiet')}${action('copy', 'Пригласить')}`;
  app.innerHTML = `<div class="room-bar"><div><a class="menu-link" href="./"><span aria-hidden="true">←</span> Главное меню</a><strong>${escape(pack.title)}</strong><small>${playersLabel(Object.keys(game.players).length)}</small></div>
    <div class="actions">${running ? `${action('undo', 'Отмена', game.previous ? '' : 'disabled', 'quiet')}${action('pause', game.paused ? 'Продолжить игру' : 'Пауза', `aria-pressed="${Boolean(game.paused)}"`, game.paused ? 'primary' : 'quiet')}
      <details class="room-menu" ${menuOpen ? 'open' : ''}><summary class="button quiet">Меню</summary><div class="actions">${service}${action('close', 'Закрыть комнату', '', 'quiet')}</div></details>` :
      `${service}${action('undo', 'Отмена', game.previous ? '' : 'disabled', 'quiet')}${action('close', 'Закрыть комнату', '', 'quiet')}`}</div></div>
    ${game.paused ? '<p class="paused-note" role="status">Пауза. Кнопки игроков и таймер остановлены.</p>' : ''}
    ${roundRail(pack, game)}${content}${!['lobby', 'results'].includes(phase) ? `<section class="panel score-panel"><h2>Счёт</h2>${scoreList(standings(game), !['final', 'showdown'].includes(phase))}</section>` : ''}`;
  document.body.classList.toggle('docked', Boolean(app.querySelector('.dock')));
  showTimer(timerView(), game.paused);
  // A redraw for a buzz or a hint must not cut off the track the host is listening to.
  const fresh = app.querySelector('.host-sound audio');
  if (heard && fresh?.getAttribute('src') === heard.getAttribute('src')) fresh.replaceWith(heard);
  if (phase === 'lobby' && window.QRCode) {
    try { new window.QRCode(document.querySelector('#join-qr'), { text: invite, width: 176, height: 176, correctLevel: window.QRCode.CorrectLevel.M }); } catch {}
  }
}

let lastPublicSend = 0;
// Players keep their seats on the TV, as on a game show: the one who answers or chooses is lit, a change of score pops up.
function playerCards(session, flash = {}) {
  const seats = Object.entries(session.players);
  const lit = session.phase === 'board' ? session.turn : session.phase === 'themes' ? session.remover : null;
  return seats.length ? `<section class="score-panel player-strip" aria-label="Счёт"><ul class="scores player-cards">${seats.map(([id, player]) =>
    `<li class="${id === session.answering ? 'answering' : id === lit ? 'choosing' : ''}"><span title="${escape(player.name)}">${escape(player.name)}</span><strong>${player.score}</strong>${
      flash[id] ? `<em class="delta ${flash[id] > 0 ? 'up' : 'down'}">${flash[id] > 0 ? '+' : '−'}${Math.abs(flash[id])}</em>` : ''}</li>`).join('')}</ul></section>` : '';
}

function roundSplash(source, session) {
  const round = activeRound(source, session);
  const number = 'Раунд ' + (roundIndex(session) + 1);
  return `<section class="panel round-splash" data-stage="${roundIndex(session) + 1}">${round.title === number ? '' : `<p class="eyebrow">${number}</p>`}
    <h1>${escape(round.title)}</h1>
    <ol class="splash-themes">${round.categories.map((category, index) => `<li style="animation-delay:${(.35 + index * .4).toFixed(2)}s">${escape(category.title)}</li>`).join('')}</ol></section>`;
}

function presentation(session, source, question, invite = '', show = {}) {
  const round = activeRound(source, session);
  const stage = roundIndex(session) + 1;
  const name = id => session.players[id]?.name || '';
  let content;
  if (session.phase === 'lobby') content = `<section class="panel tv-lobby">
    ${invite ? `<div class="invite"><div id="join-qr"></div><p class="join-link">${escape(invite.replace(/^https?:\/\//, ''))}</p></div>` : ''}
    <div class="center"><p class="eyebrow">Собираем игроков</p><h1>${escape(source.title)}</h1>
    ${invite ? '<p class="intro">Наведите камеру телефона на QR-код, чтобы войти в игру.</p>' : ''}${scoreList(standings(session))}</div></section>`;
  else if (session.phase === 'board' && show.splash) content = roundSplash(source, session);
  else if (session.phase === 'board') content = `<section class="panel round-board" data-stage="${stage}"><div class="section-top">
    <p class="turn-note">${session.turn ? `${session.mode === 'turns' ? 'Выбирает и отвечает первым' : 'Выбирает вопрос'}: <strong>${escape(name(session.turn))}</strong>` : escape(round.title)}</p>
    <p class="muted">Осталось ${remainingQuestions(source, session)} из ${roundQuestions(round).length}</p></div>
    ${cardGrid(round, session.used, false, show.picked)}</section>`;
  else if (session.phase === 'intermission') content = intermission(source, session, false);
  else if (session.phase === 'question' && session.handoff) content = `<section class="panel round-splash cat" data-stage="${stage}">
    <p class="eyebrow">${escape(question.category)} · ${points(question)} очков</p><h1>Кот в мешке</h1>
    <p class="intro">${session.turn ? `${escape(name(session.turn))} отдаёт вопрос другому игроку` : 'Ведущий выбирает, кто отвечает'}</p></section>`;
  else if (session.phase === 'question' || session.phase === 'reveal') content = questionPanel(question, session, name(session.turn));
  else if (session.phase === 'themes') content = themesPanel(source.themes, name(session.remover), false);
  else if (session.phase === 'final') content = finalPanel(source.final, 'Ответьте на телефоне.');
  else if (session.phase === 'showdown') content = showdownPanel(session, source.final, session.stakes);
  else content = resultsPanel(session, source);
  return `${roundRail(source, session)}${content}${session.phase !== 'lobby' && session.phase !== 'results' ? playerCards(session, show.flash) : ''}${
    session.paused ? '<div class="pause-veil" role="status"><strong>Пауза</strong></div>' : ''}`;
}

// The clocks belong to the host: «buzz» runs while the buttons are open, «answer» while somebody answers.
let clock = null;
let clockTimer;
function timerView() {
  return clock && { kind: clock.kind, total: clock.total,
    left: Math.max(0, Math.min(clock.total, Math.round(clock.left ?? clock.until - Date.now()))) };
}

function armClock() {
  const seconds = game ? pace(game) : 0;
  // The answer clock starts for whoever pressed the button or answers after a miss: they have heard the question already.
  const kind = !seconds || game.phase !== 'question' ? '' : game.answering ? (game.opened || game.buzzed.length > 1 ? 'answer' : '') :
    game.opened && !game.race?.length ? 'buzz' : '';
  // A player who joins the queue must not restart the clock of the one who is answering.
  const key = kind && [kind, game.ticket, game.answering || game.buzzed.length].join(':');
  if (!kind) clock = null;
  else if (clock?.key !== key) {
    const total = (kind === 'buzz' ? seconds : answerTime) * 1000;
    clock = { key, kind, total, until: Date.now() + total };
  }
  if (clock && game.paused && clock.left === undefined) clock.left = Math.max(0, clock.until - Date.now());
  if (clock && !game.paused && clock.left !== undefined) {
    clock.until = Date.now() + clock.left;
    delete clock.left;
  }
  clearTimeout(clockTimer);
  if (clock?.kind === 'buzz' && clock.left === undefined) clockTimer = setTimeout(() => {
    // Nobody pressed in time: the answer opens by itself, as it does in «Своя игра».
    if (!game || clock?.key !== key || game.paused || game.answering || game.race?.length || game.queue.length) return;
    if (command(game, pack, { type: 'reveal' }, true)) {
      message('Время вышло: никто не нажал, ответ открыт.');
      syncHost(true);
    }
  }, Math.max(0, clock.until - Date.now()) + 40);
}

function sendScreen() {
  screenConnection?.send({ type: 'screen', event: 'state', view: screenState(game, pack, invite, timerView()) });
}

function syncHost(changed = false, force = false) {
  if (!game) return;
  if (changed) armClock();
  if (changed || force || Date.now() - lastPublicSend > 320) {
    connection?.send({ type: 'state', state: { ...publicState(game, pack), timer: timerView() } });
    lastPublicSend = Date.now();
  }
  if (changed) {
    sendScreen();
    write('live', { room, game, tvRoom, title: pack.title, clock }).catch(localError);
    renderHost();
  }
}

// Buzzes that arrive close together are ranked by the reaction time each phone measured.
function armRace() {
  if (raceTimer || !game?.race?.length) return;
  raceTimer = setTimeout(() => {
    raceTimer = null;
    if (game && settle(game)) {
      playSignal();
      syncHost(true);
    }
  }, raceWindow);
}

function startHost() {
  document.body.classList.remove('home');
  stayAwake();
  armRace();
  armClock();
  invite = pageLink('play').href;
  screen = 'room';
  connection = connectRoom(room, frame => {
    if (frame.type !== 'player') return;
    const changed = command(game, pack, frame.action);
    if (changed) armRace();
    syncHost(changed);
  }, links => {
    setNetwork(links);
    syncHost(false, true);
  });
  const activeTvRoom = tvRoom;
  let lastScreenReply = 0;
  let lastPhotoReply = 0;
  screenConnection = connectRoom(activeTvRoom, frame => {
    if (!game || tvRoom !== activeTvRoom || frame.type !== 'screen') return;
    if (frame.event === 'request' && Date.now() - lastScreenReply > 120) {
      lastScreenReply = Date.now();
      sendScreen();
    } else if (frame.event === 'photo-request' && frame.id === game.current &&
        ['question', 'reveal'].includes(game.phase) && Array.isArray(frame.indexes) &&
        frame.indexes.length <= photoBatchSize && Date.now() - lastPhotoReply > 120) {
      lastPhotoReply = Date.now();
      const photo = findQuestion(pack, game.current)?.image;
      if (!photo?.startsWith('data:')) return;
      for (const index of new Set(frame.indexes)) {
        const chunk = screenPhotoChunk(photo, index);
        if (chunk) screenConnection.send({ type: 'screen', event: 'photo', id: frame.id, index, chunk });
      }
    }
  }, () => { if (tvRoom === activeTvRoom) sendScreen(); });
  setNetwork(currentNetwork);
  renderHost();
  pair.show();
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    const activeRoom = room;
    fetch('/api/info').then(r => r.json()).then(info => {
      if (room !== activeRoom || !info.lan || info.lan === '127.0.0.1') return;
      const link = pageLink('play');
      link.hostname = info.lan;
      invite = link.href;
      sendScreen();
      if (game.phase === 'lobby') renderHost();
      else app.querySelector('[data-tv]')?.setAttribute('href', tvLink().href);
    }).catch(() => {});
  }
}

// A room replaced by a new one: its players and its TV must not stay on a dead screen.
async function retire(code) {
  try {
    const live = await read('live');
    const source = validPack(await read('live-pack-' + code));
    if (live?.room !== code || !live.game) return;
    const old = restoreGame(live.game, source);
    announceClosed(code, validRoom(live.tvRoom) ? live.tvRoom : code,
      { ...publicState(old, source), revision: old.revision + 1, closed: true });
  } catch {}
}

// Repeats "room closed" for a few seconds, so it also arrives when a link was still connecting.
function announceClosed(code, screenCode, view) {
  const tell = () => {
    players.send({ type: 'state', state: view });
    screens.send({ type: 'screen', event: 'closed' });
  };
  const players = connectRoom(code, () => {}, tell);
  const screens = connectRoom(screenCode, () => {}, tell);
  const repeat = setInterval(tell, 1000);
  tell();
  setTimeout(() => { clearInterval(repeat); players.close(); screens.close(); }, 5000);
}

async function launch() {
  if (screen === 'launching') return;
  const previousRoom = savedRoom;
  if (previousRoom && !confirm('Начать новую игру вместо сохранённой? Счёт старой комнаты будет сброшен.')) return;
  const previous = screen;
  screen = 'launching';
  try {
    pack = await loadPack(previous === 'home' ? chosenPack : 'draft');
    if (previousRoom) await retire(previousRoom);
    room = token();
    tvRoom = token();
    game = createGame(stored('vne-ocheredi-mode'));
    if (Object.hasOwn(paces, stored('vne-ocheredi-pace') ?? '')) game.pace = Number(stored('vne-ocheredi-pace'));
    correctFinal.clear();
    await storeDraftNow();
    try {
      await write('live-pack-' + room, pack);
      await write('live', { room, game, tvRoom, title: pack.title });
      if (previousRoom) await write('live-pack-' + previousRoom, null);
    } catch { localError(); }
    savedRoom = room;
    savedInfo = describeSaved(pack.title, game);
    history.pushState(null, '', pageLink('host'));
    startHost();
  } catch (error) {
    screen = previous;
    message(error.message);
  }
}

async function leaveHost() {
  const oldRoom = room;
  pair.idle(tvRoom);
  const closedView = { ...publicState(game, pack), revision: game.revision + 1, closed: true };
  announceClosed(room, tvRoom, closedView);
  connection?.send({ type: 'state', state: closedView });
  const closingScreen = screenConnection;
  closingScreen?.send({ type: 'screen', event: 'closed' });
  connection?.close();
  screenConnection = null;
  setTimeout(() => closingScreen?.close(), 300);
  clearTimeout(raceTimer);
  raceTimer = null;
  clearTimeout(clockTimer);
  clock = null;
  showTimer(null);
  document.body.classList.remove('docked');
  screen = 'closing';
  game = pack = room = tvRoom = savedRoom = null;
  // Release the room pack while preserving the independent editor draft.
  await Promise.all([write('live', null), write('live-pack-' + oldRoom, null)]).catch(localError);
  setNetwork([]);
  network.hidden = true;
  history.replaceState(null, '', './');
  screen = 'home';
  renderHome();
}

function saveDraft() {
  clearTimeout(storeTimer);
  storeTimer = setTimeout(storeDraftNow, 180);
}

function storeDraftNow() {
  clearTimeout(storeTimer);
  storeTimer = null;
  return write('draft', draft).catch(localError);
}

function setField(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let obj = draft;
  for (const key of keys) obj = obj[key];
  obj[last] = value;
  saveDraft();
}

async function downloadDeck() {
  const data = validPack(draft);
  await storeDraftNow();
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'vne-ocheredi-questions.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function hostButton(button) {
  const { action: type, i, j, id, verdict, path } = button.dataset;
  try {
    if (type === 'launch') return await launch();
    if (type === 'choose-pack') {
      chosenPack = id;
      remember('vne-ocheredi-pack', id);
      const top = scrollY;
      renderHome();
      scrollTo(0, top);
      return;
    }
    if (type === 'edit' || type === 'home') {
      if (screen === 'editor') await storeDraftNow();
      screen = type === 'edit' ? 'editor' : 'home';
      if (screen === 'editor') renderEditor(); else renderHome();
      return;
    }
    if (type === 'export') return await downloadDeck();
    if (screen === 'editor') {
      const categories = draft.rounds[editorRound].categories;
      const unit = (editorRound + 1) * 100;
      const blank = { value: unit, prompt: '', answer: '' };
      if (type === 'edit-round') {
        editorRound = Number(i);
        renderEditor();
        return;
      }
      if (type === 'starter') {
        if (!confirm('Заменить текущий черновик стартовым набором на три раунда?')) return;
        draft = structuredClone(demoPack);
        editorRound = 0;
      }
      if (type === 'add-round' && draft.rounds.length < 3) {
        editorRound = draft.rounds.length;
        draft.rounds.push({ title: `Раунд ${editorRound + 1}`, note: '', categories: [
          { title: 'Новая тема', questions: [{ ...blank, value: (editorRound + 1) * 100 }] }
        ] });
      }
      if (type === 'delete-round' && draft.rounds.length > 1) {
        if (!confirm('Удалить раунд со всеми темами и вопросами?')) return;
        draft.rounds.splice(editorRound, 1);
        editorRound = Math.min(editorRound, draft.rounds.length - 1);
      }
      if (type === 'add-topic' && categories.length < 8) categories.push({ title: 'Новая тема', questions: [blank] });
      if (type === 'delete-topic' && categories.length > 1 && confirm('Удалить тему со всеми вопросами?')) categories.splice(Number(i), 1);
      if (type === 'add-question' && categories[i].questions.length < 8) categories[i].questions.push({ ...blank, value: (categories[i].questions.length + 1) * unit });
      if (type === 'delete-question' && categories[i].questions.length > 1 && confirm('Удалить вопрос?')) categories[i].questions.splice(Number(j), 1);
      if (type === 'remove-photo') setField(path, '');
      if (type === 'add-final') draft.finals = [{ topic: '', prompt: '', answer: '' }];
      if (type === 'remove-final') draft.finals = draftFinals().slice(1);
      saveDraft();
      renderEditor();
      return;
    }
    if (screen !== 'room') return;
    if (type === 'copy' || type === 'copy-tv') {
      const link = type === 'copy-tv' ? tvLink().href : invite;
      try { await navigator.clipboard.writeText(link); message('Ссылка скопирована.'); }
      catch { window.prompt(type === 'copy-tv' ? 'Ссылка для экрана ТВ' : 'Ссылка для игроков', link); }
      return;
    }
    if (type === 'pair') {
      const pin = await askPin(pair.pin());
      if (pin === null) return;
      pair.connect(pin);
      message(pin ? 'Ищем экран с кодом ' + pin + '…' : 'ТВ отключён.');
      return;
    }
    if (type === 'replay') {
      screenConnection?.send({ type: 'screen', event: 'replay' });
      message('Звук запущен на ТВ.');
      return;
    }
    if (type === 'again') {
      if (button.disabled) return;
      button.disabled = true;
      let next;
      try { next = await loadPack(document.querySelector('#again-pack')?.value); }
      catch (error) { button.disabled = false; throw error; }
      if (!command(game, next, { type }, true)) return;
      pack = next;
      correctFinal.clear();
      await write('live-pack-' + room, pack).catch(localError);
      savedInfo = describeSaved(pack.title, game);
      syncHost(true);
      message('Новая игра: ' + pack.title + '. Игроки уже в комнате.');
      return;
    }
    if (type === 'score') {
      const player = button.dataset.player;
      const score = await askScore(game.players[player].name, game.players[player].score);
      if (score !== null && command(game, pack, { type, player, score }, true)) syncHost(true);
      return;
    }
    if (type === 'mode') remember('vne-ocheredi-mode', button.dataset.mode);
    if (type === 'pace') remember('vne-ocheredi-pace', Number(button.dataset.seconds));
    if (type === 'close') {
      if (confirm('Закрыть эту комнату? Счёт текущей игры будет сброшен.')) await leaveHost();
      return;
    }
    const skip = ['next-round', 'final'].includes(type) && remainingQuestions(pack, game) > 0;
    if (skip && !confirm(`В этом раунде есть несыгранные вопросы (${remainingQuestions(pack, game)}). Пропустить их?`)) return;
    if (type === 'finish' && Object.keys(game.finalAnswers).length < Object.keys(game.players).length &&
        !confirm('Ответили не все игроки. Подвести итоги?')) return;
    if (type === 'final') correctFinal.clear();
    if (type === 'start' || type === 'pick' || type === 'open') unlockSound();
    const { topic, player, seconds, all } = button.dataset;
    if (command(game, pack, { type, question: id, verdict, skip, mode: button.dataset.mode, topic: topic === undefined ? undefined : Number(topic),
      player, seconds: Number(seconds), all: all === 'true', correct: [...correctFinal] }, true)) {
      syncHost(true);
    }
  } catch (error) { message(error.message); }
}

function initHost() {
  pair = pairHost(() => game && tvRoom && screen === 'room' ? { game: 'quiz', code: tvRoom } : null, state => {
    const button = app.querySelector('[data-action="pair"]');
    if (!button) return;
    button.textContent = pairLabel();
    button.classList.toggle('primary', state !== 'attached');
    const steps = app.querySelector('.steps');
    if (steps && game?.phase === 'lobby') steps.outerHTML = lobbySteps();
    if (state === 'attached') message('ТВ подключён.');
  });
  app.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (button && !button.disabled) hostButton(button);
  });
  app.addEventListener('input', event => {
    const { field, correct } = event.target.dataset;
    if (field) {
      setField(field, event.target.type === 'number' ? event.target.valueAsNumber || '' : event.target.value);
      const summary = event.target.closest('details')?.querySelector('summary');
      if (summary && field.endsWith('.prompt')) summary.querySelector('span').textContent = event.target.value || 'Новый вопрос';
      if (summary && field.endsWith('.value')) summary.querySelector('strong').textContent = event.target.value || '—';
      if (field === `rounds.${editorRound}.title`) {
        const current = app.querySelector('.editor-rounds button[aria-pressed="true"]');
        if (current) current.textContent = event.target.value || `Раунд ${editorRound + 1}`;
      }
    }
    if (correct) {
      if (event.target.checked) correctFinal.add(correct); else correctFinal.delete(correct);
    }
  });
  app.addEventListener('change', async event => {
    const input = event.target;
    if (input.dataset.field) { await storeDraftNow(); return; }
    const file = input.files?.[0];
    if (!file) return;
    const openDetails = input.closest('details');
    const openIndex = [...app.querySelectorAll('.question-editor')].indexOf(openDetails);
    try {
      if (input.hasAttribute('data-import')) {
        if (file.size > 28_000_000) throw new Error('Пакет слишком большой. Предел файла — 28 МБ.');
        const next = validPack(JSON.parse(await file.text()));
        if (!confirm('Заменить текущий черновик набором из файла?')) return;
        draft = next;
        editorRound = 0;
      } else if (input.dataset.photo) {
        const image = await photoData(file);
        if (!input.isConnected) return;
        setField(input.dataset.photo, image);
      }
      await storeDraftNow();
      if (screen === 'editor') {
        renderEditor();
        const details = app.querySelectorAll('.question-editor')[openIndex];
        if (details) details.open = true;
      }
    } catch (error) {
      message(error instanceof SyntaxError ? 'Этот файл не удалось прочитать. Выберите файл набора вопросов.' : error.message || 'Фото не открылось.');
      input.value = '';
    }
  });
  window.addEventListener('pagehide', () => { if (storeTimer) storeDraftNow(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  window.addEventListener('popstate', () => location.reload());
  (async () => {
    try {
      const storedDraft = await read('draft');
      draft = restoreDraft(storedDraft);
      const live = await read('live');
      if (validRoom(live?.room) && live.game) {
        const savedPack = await read('live-pack-' + live.room);
        if (savedPack) {
          savedRoom = live.room;
          savedInfo = describeSaved(savedPack.title || 'Квиз', live.game);
          if (params.get('host') === savedRoom) {
            pack = validPack(savedPack);
            room = savedRoom;
            tvRoom = validRoom(live.tvRoom) ? live.tvRoom : room;
            game = restoreGame(live.game, pack);
            // A reload keeps the deadline: the strip on the TV is still running towards it.
            const saved = live.clock;
            clock = saved && typeof saved.key === 'string' && ['buzz', 'answer'].includes(saved.kind) && Number.isFinite(saved.total) &&
              (Number.isFinite(saved.left) || saved.until > Date.now() - 30_000) ? saved : null;
            if (game !== live.game) await write('live', { room, game, tvRoom, title: pack.title }).catch(localError);
            startHost();
            return;
          }
        }
      }
    } catch { localError(); }
    if (params.has('host')) history.replaceState(null, '', './');
    renderHome();
  })();
  fetch('./packs/index.json').then(response => response.json()).then(list => {
    library = list.filter(item => /^[a-z0-9-]{1,24}$/.test(item?.id) && typeof item.title === 'string' && Array.isArray(item.themes));
    if (screen === 'home' && app.querySelector('.pack-library')) renderHome();
    if (screen === 'room' && game?.phase === 'results') renderHost();
  }).catch(() => {});
}

function initPlayer() {
  room = params.get('play');
  if (!validRoom(room)) {
    app.innerHTML = '<section class="panel center"><h1>Нужна ссылка комнаты</h1><p>Отсканируйте QR-код с экрана ведущего.</p><a class="button" href="./">На главную</a></section>';
    return;
  }
  document.body.classList.add('player');
  const storageKey = 'vne-ocheredi-player-' + room;
  let player = stored(storageKey);
  if (!player || typeof player.name !== 'string' || !/^p[a-f0-9]{24}$/.test(player.id || '')) player = null;
  let state, pending;
  let finalDraft = { answer: '', wager: '0' };
  let attempted = 0;
  let hostSeen = 0;
  let litAt = 0;
  let wasLit = false;
  let lockedUntil = 0;
  let lockTimer;
  let answeringSeen = '';
  const falseStart = 1000;
  stayAwake();

  // The reaction clock starts when this phone shows the open button, whatever the network delay was.
  function watchButton() {
    const lit = state.phase === 'question' && state.opened && !state.answering && state.mode !== 'turns' &&
      Boolean(player) && !state.buzzed.includes(player.id);
    if (lit && !wasLit) {
      litAt = performance.now();
      navigator.vibrate?.(60);
    }
    wasLit = lit;
  }

  function buzzer(me) {
    const sent = state.buzzed.includes(me.id);
    const turns = state.mode === 'turns';
    const speaker = state.players.find(person => person.id === state.answering)?.name;
    const early = !turns && !sent && !state.opened && !state.answering;
    const blocked = performance.now() < lockedUntil;
    const waiting = pending?.type === 'buzz';
    const label = state.paused ? 'Пауза' : state.answering === me.id ? 'Отвечай вслух' :
      sent ? (state.queue.includes(me.id) ? 'Ты в очереди' : state.racing && !state.answering ? 'Нажато!' : 'Ход прошёл') :
      waiting ? 'Нажато!' : turns ? (speaker ? `Отвечает ${speaker}` : 'Ждём ведущего') :
      blocked ? 'Рано! Подожди' : state.opened ? 'Ответить' : early ? 'Жди сигнала' : 'Отвечает другой игрок';
    const pressable = !state.paused && !sent && !waiting && !turns && (state.opened || early);
    return { label, disabled: !pressable, held: pressable && (early || blocked), early, mine: state.answering === me.id };
  }

  function paintBuzzer(button, view) {
    button.disabled = view.disabled;
    button.classList.toggle('held', view.held);
    button.classList.toggle('mine', view.mine);
    button.setAttribute('aria-disabled', String(view.disabled || view.held));
    button.querySelector('.buzzer-caption').textContent = view.label;
  }

  function press() {
    const me = player && state?.players.find(person => person.id === player.id);
    if (!me || state.phase !== 'question') return;
    const view = buzzer(me);
    if (view.disabled) return;
    const now = performance.now();
    if (view.early) {
      lockedUntil = now + falseStart;
      clearTimeout(lockTimer);
      lockTimer = setTimeout(renderPlayer, falseStart + 20);
      renderPlayer();
      return;
    }
    if (now < lockedUntil) return;
    navigator.vibrate?.(35);
    reliable({ type: 'buzz', ms: Math.max(0, Math.round(now - litAt)) });
  }

  function renderPlayer() {
    const me = player && state?.players.find(person => person.id === player.id);
    const themes = Array.isArray(state?.themes) ? state.themes : [];
    if (state?.closed) {
      app.innerHTML = '<section class="panel center"><h1>Комната закрыта</h1><p>Попросите ведущего прислать новую ссылку.</p><a class="button" href="./">На главную</a></section>';
      return;
    }
    if (!player) {
      app.innerHTML = '<form id="join-form" class="panel player-panel"><p class="eyebrow">Войти в игру</p><h1>Как вас зовут?</h1><label><span>Имя на табло</span><input name="name" maxlength="24" required autocomplete="nickname"></label><button class="button primary" type="submit">Войти</button></form>';
      return;
    }
    if (!me) {
      app.innerHTML = `<section class="panel player-panel"><p class="eyebrow">Подключение</p><h1>Привет, ${escape(player.name)}</h1><p>${state?.phase === 'results' ?
        'Эта игра уже закончилась. Вы войдёте, как только ведущий начнёт следующую.' : 'Ждём комнату ведущего.'}</p><p id="join-note" class="muted"></p>${action('change-name', 'Сменить имя')}</section>`;
      return;
    }
    const previousPanel = app.querySelector('.player-panel');
    // A pause, a handed-over «кот в мешке» and a struck theme redraw the step; a buzz only repaints the button.
    const step = [state.handoff, state.paused, themes.filter(theme => theme.out).length, state.remover].join('|');
    const asked = `${state.image ? `<img class="player-photo" src="${escape(state.image)}" alt="Фото к вопросу">` : ''}${
      state.prompt ? `<p class="player-prompt">${escape(state.prompt)}</p>` : ''}${
      state.sound ? '<p class="sound-note"><span aria-hidden="true">♪</span> Звук играет на ТВ</p>' : ''}`;
    const sameStep = previousPanel?.dataset.phase === state.phase && previousPanel.dataset.ticket === state.ticket &&
      previousPanel.dataset.step === step;
    showTimer(state.phase === 'question' ? state.timer : null, state.paused);
    let content;
    if (state.phase === 'question') {
      const view = buzzer(me);
      if (state.answering === me.id && answeringSeen !== state.ticket) {
        answeringSeen = state.ticket;
        navigator.vibrate?.([70, 50, 70]);
      }
      if (sameStep && !state.modifier && !state.handoff) {
        // Another player's buzz can arrive while a finger is still pressing this button.
        paintBuzzer(previousPanel.querySelector('.buzzer'), view);
        previousPanel.querySelector('.player-seat span').textContent = `${me.score} очков`;
        return;
      }
      const picker = state.players.find(person => person.id === state.chooser);
      content = state.modifier ? `<p class="eyebrow">${escape(state.category)}</p><h1>Модификатор</h1>${asked}
        <p>${picker ? (picker.id === me.id ? 'Карточка достаётся тебе.' : `Карточка достаётся игроку ${escape(picker.name)}.`) : 'Ведущий читает карточку.'} Отвечать не нужно.</p>` :
        state.handoff ? `<p class="eyebrow">${escape(state.category)} · ${escape(state.value)} очков</p><h1>Кот в мешке</h1>
        <p>${picker ? (picker.id === me.id ? 'Назови вслух, кому отдаёшь вопрос.' : `${escape(picker.name)} отдаёт вопрос другому игроку.`) : 'Ведущий выбирает, кто отвечает.'}</p>` :
        `<p class="eyebrow">${escape(state.category)} · ${escape(state.value)} очков</p>${asked}
        <button type="button" data-action="buzz" class="buzzer${asked ? ' compact' : ''}"><span aria-hidden="true">↯</span><strong class="buzzer-caption"></strong></button>
        <p class="muted">${state.mode === 'turns' ? 'Игра по очереди: отвечайте вслух, когда назовут ваше имя.' :
          'Жмите после сигнала ведущего. Нажмёте раньше — кнопка заблокируется на секунду.'}</p>`;
    } else if (state.phase === 'final') {
      const submitted = state.submitted.includes(me.id);
      const sending = pending?.type === 'final-answer';
      const submitLabel = sending ? 'Отправляем…' : 'Зафиксировать ответ';
      const form = sameStep && !submitted && previousPanel.querySelector('#final-form');
      if (form) {
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = sending;
        submit.textContent = submitLabel;
        app.querySelector('.score-panel').innerHTML = `<h2>Счёт</h2>${scoreList(state.players)}`;
        return;
      }
      content = submitted
        ? '<h1>Ответ принят</h1><p>Ждём, пока ведущий откроет финал.</p>'
        : `<form id="final-form"><p class="eyebrow">Финал</p><h1>${escape(state.finalTopic)}</h1>${asked}
          <label><span>Твой ответ</span><input name="answer" required maxlength="180" value="${escape(finalDraft.answer)}"></label>
          <label><span>Ставка (до ${Math.max(0, me.score)} очков)</span><input name="wager" type="number" min="0" max="${Math.max(0, me.score)}" step="1" required value="${escape(finalDraft.wager)}"></label>
          <button class="button primary" type="submit" ${sending ? 'disabled' : ''}>${submitLabel}</button>
        </form>`;
    } else if (state.phase === 'themes') {
      const mine = state.remover === me.id;
      const remover = state.players.find(person => person.id === state.remover);
      content = `<p class="eyebrow">Финал · выбор темы</p><h1>${mine ? 'Убери одну тему' : remover ? `Тему убирает ${escape(remover.name)}` : 'Выбираем тему'}</h1>
        <ul class="theme-list">${themes.map((theme, index) => `<li class="${theme.out ? 'out' : ''}">${mine && !theme.out ?
          `<button class="button" type="button" data-action="strike" data-topic="${index}" ${pending ? 'disabled' : ''}>${escape(theme.topic)}</button>` :
          `<span>${escape(theme.topic)}</span>`}</li>`).join('')}</ul>
        <p class="muted">Играет последняя оставшаяся тема.</p>`;
    } else {
      const turn = state.players.find(person => person.id === (state.chooser || state.turn));
      const turns = state.mode === 'turns';
      const copy = {
        lobby: ['Ты в игре', 'Ведущий скоро начнёт.'],
        board: turn ? [turn.id === me.id ? 'Твой ход' : `${turns ? 'Ход' : 'Выбирает'}: ${turn.name}`,
          turn.id === me.id ? (turns ? 'Выбери вопрос вслух и отвечай первым.' : 'Выбери вопрос вслух.') : 'Следи за табло.'] :
          ['Выбирают вопрос', 'Следи за табло.'],
        showdown: ['Открываем ставки', 'Смотри на экран: ставки открываются по одной.'],
        intermission: ['Перерыв', state.roundTitle ? `Дальше — ${state.roundTitle}` : 'Ведущий скоро начнёт следующий раунд.'],
        reveal: [state.answer ? 'Ответ' : 'Ответ на ТВ', state.answer || 'Скоро следующий вопрос.'],
        results: ['Игра окончена', 'Итоговый счёт ниже.']
      };
      const [heading, sub] = copy[state.phase];
      content = `${state.phase !== 'lobby' && state.roundNumber && state.roundTotal ? `<p class="eyebrow">Раунд ${escape(state.roundNumber)} из ${escape(state.roundTotal)}</p>` : ''}
        <h1>${escape(heading)}</h1><p>${escape(sub)}</p>`;
    }
    app.innerHTML = `<section class="panel player-panel" data-phase="${state.phase}" data-ticket="${escape(state.ticket)}" data-step="${escape(step)}"><div class="player-seat"><strong>${escape(me.name)}</strong><span>${me.score} очков</span></div>
      ${state.paused ? '<p class="paused-note" role="status">Пауза. Ждём ведущего.</p>' : ''}${content}</section>
      ${state.phase !== 'question' ? `<section class="panel score-panel"><h2>Счёт</h2>${scoreList(state.players)}</section>` : ''}`;
    if (state.phase === 'question' && !state.modifier && !state.handoff) paintBuzzer(app.querySelector('.buzzer'), buzzer(me));
  }

  function sendPlayer(body) {
    if (player) connection?.send({ type: 'player', action: { ...body, ...player } });
  }

  function ping() {
    if (!player || state?.closed) return;
    sendPlayer({ type: 'join' });
    const note = document.querySelector('#join-note');
    if (note && Date.now() - attempted > 6500) {
      note.textContent = state?.phase === 'results' ? '' : currentNetwork.length ?
        'Ведущий не отвечает. Проверьте, что его вкладка открыта. Если игра уже завершена, попросите новый QR-код.' :
        'Связь пока не появилась. Если вы в одном Wi‑Fi, ведущий может запустить локальную версию.';
    }
    if (hostSeen && Date.now() - hostSeen > 14000) network.textContent = 'Ждём ведущего';
  }

  function reliable(body) {
    if (!state?.ticket || pending) return;
    pending = { ...body, ticket: state.ticket };
    sendPlayer(pending);
    renderPlayer();
    const request = pending;
    const timer = setInterval(() => {
      if (pending !== request) { clearInterval(timer); pendingPlayerTimers.delete(timer); return; }
      if (Date.now() - started > 6500) {
        pending = null;
        renderPlayer();
        message('Ведущий не подтвердил действие. Попробуйте ещё раз.');
        return;
      }
      sendPlayer(request);
    }, 650);
    const started = Date.now();
    pendingPlayerTimers.add(timer);
  }

  const phases = ['lobby', 'board', 'question', 'reveal', 'intermission', 'themes', 'final', 'showdown', 'results'];
  function receive(frame) {
    const next = frame.state;
    if (frame.type !== 'state' || !next || !phases.includes(next.phase) || !Number.isSafeInteger(next.revision) ||
        !Array.isArray(next.players) || next.players.length > 12 || !next.players.every(p => p && typeof p.name === 'string' &&
        /^p[a-zA-Z0-9_-]{1,48}$/.test(p.id || '') && Number.isSafeInteger(p.score)) ||
        ![next.buzzed, next.queue, next.submitted].every(Array.isArray)) return;
    hostSeen = Date.now();
    setNetwork(currentNetwork);
    if (state && next.revision <= state.revision) return;
    if (pending && (next.ticket !== pending.ticket ||
      (pending.type === 'buzz' && (next.buzzed.includes(player.id) || next.phase !== 'question')) ||
      (pending.type === 'strike' && (next.phase !== 'themes' || next.themes?.[pending.topic]?.out !== false)) ||
      (pending.type === 'final-answer' && (next.submitted.includes(player.id) || next.phase !== 'final')))) pending = null;
    if (next.timer && typeof next.timer === 'object') next.timer.at = Date.now(); else next.timer = null;
    if (next.ticket !== state?.ticket) finalDraft = { answer: '', wager: '0' };
    state = next;
    watchButton();
    if (player) renderPlayer();
  }

  connection = connectRoom(room, receive, active => { setNetwork(active); ping(); });
  setNetwork(currentNetwork);
  // A touch counts the moment the finger lands; a click event arrives only after it lifts.
  app.addEventListener('pointerdown', event => {
    if (event.target.closest('.buzzer')) press();
  });
  app.addEventListener('click', event => {
    const type = event.target.closest('[data-action]')?.dataset.action;
    if (type === 'buzz' && event.detail === 0) press();
    if (type === 'strike') reliable({ type: 'strike', topic: Number(event.target.closest('[data-action]').dataset.topic) });
    if (type === 'change-name') {
      player = null;
      remember(storageKey, null);
      renderPlayer();
    }
  });
  app.addEventListener('input', event => {
    if (event.target.form?.id === 'final-form') finalDraft[event.target.name] = event.target.value;
  });
  app.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(event.target);
    if (event.target.id === 'join-form') {
      const name = data.get('name').trim().slice(0, 24);
      if (!name) return;
      player = { id: 'p' + token(), name };
      remember(storageKey, player);
      attempted = Date.now();
      renderPlayer();
      ping();
    } else if (event.target.id === 'final-form') {
      const answer = data.get('answer').trim();
      const wager = Number(data.get('wager'));
      if (answer) reliable({ type: 'final-answer', answer, wager });
    }
  });
  attempted = Date.now();
  renderPlayer();
  ping();
  setInterval(() => {
    const joined = player && state?.players.some(p => p.id === player.id);
    if (!joined || Date.now() - hostSeen >= 5000) ping();
  }, 1250);
}

function initTv() {
  document.body.classList.add('tv');
  const code = params.get('tv');
  const waiting = text => { app.innerHTML = `<section class="panel center"><h1>Экран ТВ</h1><p>${text}</p></section>`; };
  if (!validRoom(code)) {
    waiting('Откройте ссылку «Экран ТВ» из комнаты ведущего.');
    return;
  }
  waiting('Ждём ведущего. Оставьте пульт открытым на устройстве ведущего.');
  let snapshot, photo, lastHtml;
  // What the TV adds on its own between two states: a blinking cell, the round titles, a change of score.
  let hold = null;
  let holdTimer;
  let flash = {};
  let flashTimer;
  let lastSeen = 0;
  let lastRequest = 0;
  let ended = false;
  let tv;
  let playing = '';
  const speaker = new Audio();
  const unlock = document.createElement('button');
  unlock.className = 'button primary sound-unlock';
  unlock.type = 'button';
  unlock.textContent = 'Включить звук';
  unlock.hidden = true;
  unlock.addEventListener('click', () => {
    unlockSound();
    if (playing && !hold) startTrack(); else unlock.hidden = true;
  });
  document.body.append(unlock);
  // Browsers keep sound off until somebody touches the page: offer the button once instead of staying silent.
  unlockSound();
  setTimeout(() => { if (sound && sound.state !== 'running' && !ended) unlock.hidden = false; }, 600);
  stayAwake();
  tv = connectRoom(code, receive, request);
  listenForHost(params.get('pair'), code);

  function startTrack() {
    speaker.currentTime = 0;
    speaker.play().then(() => { unlock.hidden = !sound || sound.state === 'running'; }, () => { unlock.hidden = !playing; });
  }

  function keep(view, ms) {
    hold = view;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      hold = null;
      render();
      tune();
    }, ms);
  }

  function stage(before, now) {
    const was = before?.session;
    const is = now.session;
    const entered = phase => is.phase === phase && was?.phase !== phase;
    clearTimeout(holdTimer);
    hold = null;
    if (was?.phase === 'board' && is.phase === 'question' && before.source.rounds[is.roundIndex]?.categories.length) {
      keep({ snapshot: before, picked: now.question.id }, 900);
      playCue('pick');
    } else if (is.phase === 'board' && ['lobby', 'intermission'].includes(was?.phase)) {
      keep({ snapshot: now, splash: true }, 1500 + 400 * now.source.rounds[is.roundIndex].categories.length);
      playCue('round');
    }
    if (!was) return;
    const changes = Object.entries(is.players).map(([id, player]) => [id, player.score - (was.players[id]?.score ?? player.score)])
      .filter(([, delta]) => delta);
    if (changes.length && is.phase !== 'lobby' && was.phase !== 'results') {
      flash = Object.fromEntries(changes);
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flash = {}; render(); }, 2600);
      playCue(changes.some(([, delta]) => delta > 0) ? 'right' : 'wrong');
    } else if (entered('reveal')) playCue('silent');
    if (is.handoff && !was.handoff) playCue('cat');
    else if (entered('question') && now.question?.kind === 'modifier') playCue('modifier');
    if (is.opened && !was.opened && !is.answering) playCue('open');
    if (is.answering && is.answering !== was.answering && is.mode !== 'turns') playCue('buzz');
    if (entered('themes') || (entered('final') && was.phase !== 'themes')) playCue('final');
    if (entered('results')) playCue('results');
  }

  function tune() {
    const { session, question, source } = snapshot;
    // The sound waits for the blinking cell and for a «кот в мешке» to be handed over.
    if (hold) return;
    const track = session.handoff ? '' : session.phase === 'question' ? question?.audio : session.phase === 'reveal' ? question?.answerAudio :
      session.phase === 'final' ? source.final?.audio : '';
    if ((track || '') !== playing) {
      playing = track || '';
      speaker.pause();
      unlock.hidden = !sound || sound.state === 'running';
      if (playing) {
        speaker.src = playing;
        startTrack();
      }
    } else if (playing && session.phase === 'question' && session.mode === 'buzz' && session.answering) speaker.pause();
  }

  function render() {
    const view = hold?.snapshot || snapshot;
    const question = view.question;
    const shown = photo?.url && question ? { ...question, image: photo.url } : question;
    const html = presentation(view.session, view.source, shown, view.invite, { picked: hold?.picked, splash: hold?.splash, flash });
    showTimer(hold ? null : snapshot.session.timer, snapshot.session.paused, true);
    if (html !== lastHtml) {
      lastHtml = html;
      app.innerHTML = html;
      const qr = app.querySelector('#join-qr');
      if (qr && window.QRCode) {
        try { new window.QRCode(qr, { text: snapshot.invite, width: 320, height: 320, correctLevel: window.QRCode.CorrectLevel.M }); } catch {}
      }
    }
  }

  function receive(frame) {
    if (ended || frame.type !== 'screen') return;
    if (frame.event === 'closed') {
      ended = true;
      clearInterval(poll);
      clearTimeout(holdTimer);
      clearTimeout(flashTimer);
      showTimer(null);
      tv.close();
      speaker.pause();
      unlock.hidden = true;
      network.hidden = true;
      waiting('Комната закрыта.');
      // A paired TV goes back to its code and waits for the next game.
      if (validPin(params.get('pair'))) setTimeout(() => location.replace(waitingUrl(params.get('pair'))), 1500);
    } else if (frame.event === 'state' && validScreenState(frame.view)) {
      lastSeen = Date.now();
      network.hidden = false;
      network.classList.add('online');
      network.textContent = 'Связь с ведущим';
      if (snapshot && (frame.view.revision < snapshot.revision ||
          (frame.view.revision === snapshot.revision && frame.view.invite === snapshot.invite))) return;
      const before = snapshot;
      snapshot = frame.view;
      if (snapshot.session.timer) snapshot.session.timer.at = Date.now();
      stage(before, snapshot);
      const id = snapshot.question?.id;
      const length = snapshot.photoLength;
      if (!length) photo = null;
      else if (photo?.id !== id || photo.length !== length) {
        photo = { id, length, chunks: Array(Math.ceil(length / photoChunkSize)).fill(''), received: 0, url: '' };
      }
      render();
      tune();
    } else if (frame.event === 'replay' && playing) {
      startTrack();
    } else if (frame.event === 'photo' && photo && frame.id === photo.id && !photo.url) {
      const { index, chunk } = frame;
      if (!Number.isInteger(index) || index < 0 || index >= photo.chunks.length || photo.chunks[index] ||
          typeof chunk !== 'string' || chunk.length !== Math.min(photoChunkSize, photo.length - index * photoChunkSize)) return;
      photo.chunks[index] = chunk;
      if (++photo.received !== photo.chunks.length) return;
      const url = photo.chunks.join('');
      if (validScreenPhoto(url)) {
        photo.url = url;
        render();
      } else {
        photo.chunks.fill('');
        photo.received = 0;
      }
    }
  }

  function request() {
    tv?.send({ type: 'screen', event: 'request' });
    lastRequest = Date.now();
  }

  const poll = setInterval(() => {
    const now = Date.now();
    if (now - lastRequest >= 2400) request();
    if (lastSeen && now - lastSeen > 9000) {
      network.classList.remove('online');
      network.textContent = 'Ждём ведущего';
    }
    if (photo && !photo.url) {
      const indexes = [];
      for (let index = 0; index < photo.chunks.length && indexes.length < photoBatchSize; index++) {
        if (!photo.chunks[index]) indexes.push(index);
      }
      if (indexes.length) tv.send({ type: 'screen', event: 'photo-request', id: photo.id, indexes });
    }
  }, 350);
  request();
}

if (mode === 'player') initPlayer();
else if (mode === 'tv') initTv();
else initHost();
