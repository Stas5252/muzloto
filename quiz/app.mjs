import { demoPack, validPack, restoreDraft, createGame, restoreGame, command, publicState, findQuestion, kinds, points,
  standings, activeRound, roundIndex, roundQuestions, remainingQuestions } from './game.mjs?v=17';
import { connectRoom, token, validRoom } from './relay.mjs?v=2';
import { read, write, photoData } from './storage.mjs';

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
let draft = structuredClone(demoPack);
let editorRound = 0;
let savedRoom = null;
let game, pack, room, connection, tvChannel;
let invite = '';
let currentNetwork = [];
let noticeTimer;
let storeTimer;
let localFailure = false;
let sound;
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

function pageLink(type, code = room) {
  const link = new URL('./', location.href);
  link.searchParams.set(type, code);
  return link;
}

function scoreList(players) {
  return players.length
    ? `<ul class="scores${players.length > 6 ? ' scores-crowd' : ''}">${players.map(p => `<li><span title="${escape(p.name)}">${escape(p.name)}</span><strong>${p.score}</strong></li>`).join('')}</ul>`
    : `<p class="muted">Игроки ещё не подключились</p>`;
}

function cardGrid(source, used = [], canPick = false) {
  return `<div class="board">${source.categories.map(category => `
    <section class="topic"><h2>${escape(category.title)}</h2><div class="values">
      ${category.questions.map(q => {
        const spent = used.includes(q.id);
        const photo = q.image ? 'has-image' : '';
        return canPick
          ? action('pick', spent ? '✓' : String(q.value), `data-id="${q.id}" aria-label="${escape(category.title)} · ${q.value}${q.image ? ' · фото' : ''}" ${spent ? 'disabled' : ''}`, `value ${photo}`)
          : `<span class="value ${photo} ${spent ? 'spent' : ''}">${spent ? '✓' : q.value}</span>`;
      }).join('')}
    </div></section>`).join('')}</div>`;
}

function roundRail(source, session) {
  const current = roundIndex(session);
  const inFinal = ['final', 'results'].includes(session.phase);
  return `<ol class="round-rail" aria-label="Этапы игры">${source.rounds.map((round, index) => {
    const status = inFinal || index < current ? 'done' : index === current ? 'current' : 'upcoming';
    return `<li data-stage="${index + 1}" class="${status}" ${status === 'current' ? 'aria-current="step"' : ''}>
      <span>Раунд ${index + 1}</span><strong>${escape(round.title)}</strong></li>`;
  }).join('')}${source.final ? `<li data-stage="final" class="${inFinal ? 'current' : 'upcoming'}" ${inFinal ? 'aria-current="step"' : ''}>
    <span>Ставки</span><strong>Финал</strong></li>` : ''}</ol>`;
}

function intermission(source, session, isHost) {
  const next = activeRound(source, session);
  return `<section class="panel intermission" data-stage="${roundIndex(session) + 1}">
    <p class="eyebrow">Перерыв перед раундом ${roundIndex(session) + 1}</p><h1>${escape(next.title)}</h1>
    ${next.note ? `<p class="intro">${escape(next.note)}</p>` : ''}
    ${isHost ? action('start-round', 'Начать раунд', '', 'primary') : '<p class="muted">Ждём сигнала ведущего</p>'}
  </section>`;
}

function questionPanel(question, session) {
  if (!question) return '';
  const reveal = session.phase === 'reveal';
  const announcing = session.answering && session.players[session.answering]?.name;
  return `<article class="question panel ${question.image ? 'has-photo' : ''}" data-stage="${roundIndex(session) + 1}">
    ${question.image ? `<figure class="question-figure"><img class="question-image" src="${escape(question.image)}" alt="Фото к вопросу"></figure>` : ''}
    <div class="question-copy">
      <p class="question-category">${escape(question.category)} <span>${points(question)} очков</span></p>
      <h1>${escape(question.prompt)}</h1>
      ${session.showHint && question.hint ? `<p class="hint">${escape(question.hint)}</p>` : ''}
      ${reveal ? `<div class="answer-reveal"><p class="answer-label">Ответ</p><p class="revealed">${escape(question.answer)}</p></div>` :
        `<p class="question-state">${announcing ? 'Отвечает ' + escape(announcing) : session.opened ? 'Можно отвечать' : 'Ведущий выбирает игрока'}</p>`}
    </div>
  </article>`;
}

function resultsPanel(session, source) {
  const ranking = standings(session);
  const leaders = ranking.filter(player => player.score === ranking[0]?.score);
  return `<section class="panel result">
    <p class="eyebrow">Результаты</p>
    <h1>${leaders.length ? escape(leaders.map(p => p.name).join(' и ')) : 'Игра окончена'}</h1>
    ${leaders.length ? `<p>${leaders[0].score} очков</p>` : ''}
    ${scoreList(ranking)}
    ${source.final && session.verdicts.length ? `<p class="answer-label">Ответ в финале</p><p class="revealed">${escape(source.final.answer)}</p>
      <ul class="verdicts">${session.verdicts.map(v => `<li>${escape(session.players[v.id]?.name)} · ${escape(v.answer)} · ${v.correct ? '+' : '−'}${v.wager}</li>`).join('')}</ul>` : ''}
  </section>`;
}

function renderHome() {
  document.body.classList.add('home');
  const count = draft.rounds.reduce((total, round) => total + roundQuestions(round).length, 0);
  const photos = draft.rounds.flatMap(roundQuestions).filter(question => question.image).length;
  const menu = savedRoom
    ? `<p class="saved-room">Есть сохранённая игра</p><div class="actions">
        <a class="button primary" href="${escape(pageLink('host', savedRoom))}">Продолжить игру</a>${action('launch', 'Новая комната')}${action('edit', 'Редактор вопросов')}</div>`
    : `<div class="actions">${action('launch', 'Создать комнату', '', 'primary')}${action('edit', 'Редактор вопросов')}</div>`;
  app.innerHTML = `<section class="hero">
    <div class="hero-copy">
      <p class="eyebrow">Квиз для компании</p>
      <h1>Вне очереди<span>.</span></h1>
      <p class="intro">Вопросы на ТВ. Кнопка на телефоне. Ответы вслух.</p>
      <div class="hero-facts"><strong>${questionLabel(count)}</strong>${photos ? `<span>${questionLabel(photos)} с фото</span>` : ''}${draft.final ? '<span>Финал со ставками</span>' : ''}</div>
      <nav class="home-menu" aria-label="Главное меню">${menu}</nav>
    </div>
    <figure class="hero-art"><img src="./media/auditorium.webp" alt="Зрительный зал, вид со сцены" fetchpriority="high"></figure>
  </section>
  <section class="home-deck"><div class="deck-title"><h2>${escape(draft.title)}</h2><span>${draft.rounds.length} ${draft.rounds.length === 1 ? 'раунд' : 'раунда'}</span></div>
    <div class="deck-rounds">${draft.rounds.map((round, index) => `<article class="deck-round" data-stage="${index + 1}">
      <p class="eyebrow">Раунд ${index + 1}</p><h3>${escape(round.title)}</h3>
      <ul>${round.categories.map(c => `<li>${escape(c.title)}</li>`).join('')}</ul>
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
    <section class="panel category-editor final-editor"><div class="category-head"><h2>Финал</h2>
      ${draft.final ? action('remove-final', 'Убрать финал', '', 'quiet') : action('add-final', 'Добавить финал')}</div>
      ${draft.final ? field('Тема финала', 'final.topic', draft.final.topic, { max: 60 }) +
        field('Вопрос', 'final.prompt', draft.final.prompt, { area: true, max: 1200 }) +
        field('Ответ', 'final.answer', draft.final.answer, { area: true, max: 650 }) : ''}</section>
  </section>`;
}

function lobby() {
  return `<div class="dashboard">
    <section class="panel lobby-copy"><p class="eyebrow">Комната открыта</p><h1>${escape(pack.title)}</h1>
      <p class="intro">Попросите игроков отсканировать QR-код или отправьте им ссылку.</p>
      <div class="actions">${action('start', 'Начать игру', '', 'primary')}${action('copy', 'Скопировать ссылку')}</div>
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
  let content;
  if (phase === 'lobby') content = lobby();
  if (phase === 'board') content = `<section class="panel round-board" data-stage="${stage}">
    <div class="section-top"><div><p class="eyebrow">Раунд ${stage} · осталось ${remaining} из ${roundQuestions(round).length}</p><h1>${escape(round.title)}</h1></div>
    ${isLastRound ? action('final', pack.final ? 'Перейти в финал' : 'Завершить игру', '', remaining ? '' : 'primary') :
      action('next-round', `К раунду ${stage + 1}`, '', remaining ? '' : 'primary')}</div>
    ${cardGrid(round, game.used, true)}</section>`;
  if (phase === 'intermission') content = intermission(pack, game, true);
  if (phase === 'question' || phase === 'reveal') {
    const queue = game.queue.map(id => game.players[id].name);
    const handoff = current?.kind === 'handoff' && !game.opened && !game.answering && Object.keys(game.players).length;
    content = `<div class="question-layout">${questionPanel(current, game)}
      <aside class="panel host-actions"><h2>Пульт ведущего</h2>
        ${phase === 'reveal' ? action('board', 'К табло', '', 'primary') : `
        <details class="answer-detail"><summary>Посмотреть ответ</summary><p>${escape(current?.answer)}</p></details>
        ${handoff ? `<label><span>Передать вопрос</span><select id="handoff">${standings(game).map(p => `<option value="${p.id}">${escape(p.name)}</option>`).join('')}</select></label>${action('assign', 'Передать право ответа')}${action('open', 'Дать ответить всем')}` : ''}
        ${game.answering ? `<p class="answering">${escape(game.players[game.answering].name)}</p>
          <div class="decisions">${action('judge', '+' + points(current) + ' · Верно', 'data-verdict="correct"', 'primary')}${action('judge', '−' + points(current) + ' · Неверно', 'data-verdict="wrong"')}${action('judge', '0 · Без штрафа', 'data-verdict="neutral"')}</div>` : ''}
        ${queue.length ? `<p class="muted">Следом: ${escape(queue.join(', '))}</p>` : ''}
        ${current?.hint && !game.showHint ? action('hint', 'Дать подсказку') : ''}
        ${action('reveal', 'Открыть ответ')}`}
      </aside></div>`;
  }
  if (phase === 'final') content = `<div class="question-layout"><article class="question panel" data-stage="final"><p class="eyebrow">Финал · ${escape(pack.final.topic)}</p>
    <h1>${escape(pack.final.prompt)}</h1><p class="muted">Все отвечают на телефонах и ставят от нуля до своих очков.</p></article>
    <aside class="panel host-actions"><h2>Принятые ответы <span class="count">${Object.keys(game.finalAnswers).length}/${Object.keys(game.players).length}</span></h2>
    <details class="answer-detail"><summary>Посмотреть правильный ответ</summary><p>${escape(pack.final.answer)}</p></details>
    ${Object.entries(game.finalAnswers).map(([id, entry]) => `<label class="final-entry"><input type="checkbox" data-correct="${id}" ${correctFinal.has(id) ? 'checked' : ''}><span><strong>${escape(game.players[id].name)}</strong> · ставка ${entry.wager}<br>${escape(entry.answer)}</span></label>`).join('')}
    <p class="muted">Отметьте верные ответы, затем откройте результаты.</p>${action('finish', 'Подвести итоги', '', 'primary')}</aside></div>`;
  if (phase === 'results') content = resultsPanel(game, pack);
  app.innerHTML = `<div class="room-bar"><div><a class="menu-link" href="./"><span aria-hidden="true">←</span> Главное меню</a><strong>${escape(pack.title)}</strong><small>${Object.keys(game.players).length} игроков</small></div>
    <div class="actions"><a class="button" href="${escape(pageLink('tv'))}" target="_blank" rel="noopener">Экран ТВ ↗</a>${action('copy', 'Пригласить')}${action('undo', 'Отмена', game.previous ? '' : 'disabled', 'quiet')}${action('close', 'Закрыть комнату', '', 'quiet')}</div></div>
    ${roundRail(pack, game)}${content}${!['lobby', 'results'].includes(phase) ? `<section class="panel score-panel"><h2>Счёт</h2>${scoreList(standings(game))}</section>` : ''}`;
  if (phase === 'lobby' && window.QRCode) {
    try { new window.QRCode(document.querySelector('#join-qr'), { text: invite, width: 176, height: 176, correctLevel: window.QRCode.CorrectLevel.M }); } catch {}
  }
}

let lastPublicSend = 0;
function presentation(session, source) {
  const round = activeRound(source, session);
  const stage = roundIndex(session) + 1;
  let content;
  if (session.phase === 'lobby') content = `<section class="panel center"><p class="eyebrow">Собираем игроков</p><h1>${escape(source.title)}</h1>${scoreList(standings(session))}</section>`;
  else if (session.phase === 'board') content = `<section class="panel round-board" data-stage="${stage}"><div class="section-top"><div>
    <p class="eyebrow">Раунд ${stage}</p><h1>${escape(round.title)}</h1></div><p class="muted">Осталось ${remainingQuestions(source, session)} из ${roundQuestions(round).length}</p></div>
    ${cardGrid(round, session.used)}</section>`;
  else if (session.phase === 'intermission') content = intermission(source, session, false);
  else if (session.phase === 'question' || session.phase === 'reveal') content = questionPanel(findQuestion(source, session.current), session);
  else if (session.phase === 'final') content = `<article class="question panel" data-stage="final"><p class="eyebrow">Финал · ${escape(source.final.topic)}</p><h1>${escape(source.final.prompt)}</h1><p class="muted">Ответьте на телефоне.</p></article>`;
  else content = resultsPanel(session, source);
  return `${roundRail(source, session)}${content}${session.phase !== 'lobby' && session.phase !== 'results' ? `<section class="panel score-panel"><h2>Счёт</h2>${scoreList(standings(session))}</section>` : ''}`;
}

function syncHost(changed = false, force = false) {
  if (!game) return;
  if (changed || force || Date.now() - lastPublicSend > 320) {
    connection?.send({ type: 'state', state: publicState(game, pack) });
    lastPublicSend = Date.now();
  }
  if (changed) {
    tvChannel?.postMessage({ html: presentation(game, pack) });
    write('live', { room, game }).catch(localError);
    renderHost();
  }
}

function startHost() {
  document.body.classList.remove('home');
  invite = pageLink('play').href;
  screen = 'room';
  connection = connectRoom(room, frame => {
    if (frame.type !== 'player') return;
    const hadSpeaker = Boolean(game.answering);
    const changed = command(game, pack, frame.action);
    if (changed && frame.action.type === 'buzz' && !hadSpeaker && game.answering) playSignal();
    syncHost(changed);
  }, links => {
    setNetwork(links);
    syncHost(false, true);
  });
  if ('BroadcastChannel' in window) {
    tvChannel = new BroadcastChannel('vne-ocheredi-screen-' + room);
    tvChannel.onmessage = ({ data }) => { if (data === 'screen-ready') tvChannel.postMessage({ html: presentation(game, pack) }); };
  }
  setNetwork(currentNetwork);
  renderHost();
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    const activeRoom = room;
    fetch('/api/info').then(r => r.json()).then(info => {
      if (room !== activeRoom || !info.lan || info.lan === '127.0.0.1') return;
      const link = pageLink('play');
      link.hostname = info.lan;
      invite = link.href;
      if (game.phase === 'lobby') renderHost();
    }).catch(() => {});
  }
}

async function launch() {
  if (screen === 'launching') return;
  const previousRoom = savedRoom;
  if (previousRoom && !confirm('Начать новую игру вместо сохранённой? Счёт старой комнаты будет сброшен.')) return;
  const previous = screen;
  screen = 'launching';
  try {
    pack = validPack(draft);
    room = token();
    game = createGame();
    correctFinal.clear();
    await storeDraftNow();
    try {
      await write('live-pack-' + room, pack);
      await write('live', { room, game });
      if (previousRoom) await write('live-pack-' + previousRoom, null);
    } catch { localError(); }
    savedRoom = room;
    history.pushState(null, '', pageLink('host'));
    startHost();
  } catch (error) {
    screen = previous;
    message(error.message);
  }
}

async function leaveHost() {
  const oldRoom = room;
  connection?.send({ type: 'state', state: { ...publicState(game, pack), revision: game.revision + 1, closed: true } });
  tvChannel?.postMessage({ closed: true });
  connection?.close();
  tvChannel?.close();
  screen = 'closing';
  game = pack = room = savedRoom = null;
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
      if (type === 'add-final') draft.final = { topic: '', prompt: '', answer: '' };
      if (type === 'remove-final') draft.final = null;
      saveDraft();
      renderEditor();
      return;
    }
    if (screen !== 'room') return;
    if (type === 'copy') {
      try { await navigator.clipboard.writeText(invite); message('Ссылка скопирована.'); }
      catch { window.prompt('Ссылка для игроков', invite); }
      return;
    }
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
    if (command(game, pack, { type, question: id, verdict, skip, player: document.querySelector('#handoff')?.value, correct: [...correctFinal] }, true)) {
      syncHost(true);
    }
  } catch (error) { message(error.message); }
}

function initHost() {
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
          if (params.get('host') === savedRoom) {
            pack = validPack(savedPack);
            room = savedRoom;
            game = restoreGame(live.game, pack);
            if (game !== live.game) await write('live', { room, game }).catch(localError);
            startHost();
            return;
          }
        }
      }
    } catch { localError(); }
    if (params.has('host')) history.replaceState(null, '', './');
    renderHome();
  })();
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

  function renderPlayer() {
    const me = player && state?.players.find(person => person.id === player.id);
    if (state?.closed) {
      app.innerHTML = '<section class="panel center"><h1>Комната закрыта</h1><p>Попросите ведущего прислать новую ссылку.</p><a class="button" href="./">На главную</a></section>';
      return;
    }
    if (!player) {
      app.innerHTML = '<form id="join-form" class="panel player-panel"><p class="eyebrow">Войти в игру</p><h1>Как вас зовут?</h1><label><span>Имя на табло</span><input name="name" maxlength="24" required autocomplete="nickname"></label><button class="button primary" type="submit">Войти</button></form>';
      return;
    }
    if (!me) {
      app.innerHTML = `<section class="panel player-panel"><p class="eyebrow">Подключение</p><h1>Привет, ${escape(player.name)}</h1><p>Ждём комнату ведущего.</p><p id="join-note" class="muted"></p>${action('change-name', 'Сменить имя')}</section>`;
      return;
    }
    const previousPanel = app.querySelector('.player-panel');
    const sameStep = previousPanel?.dataset.phase === state.phase && previousPanel.dataset.ticket === state.ticket;
    let content;
    if (state.phase === 'question') {
      const sent = state.buzzed.includes(me.id);
      const locked = !state.opened || sent || pending?.type === 'buzz';
      const label = state.answering === me.id ? 'Отвечай вслух' : sent ? (state.queue.includes(me.id) ? 'Ты в очереди' : 'Ход прошёл') :
        pending?.type === 'buzz' ? 'Отправляем…' : state.opened ? 'Ответить' : state.answering ? 'Отвечает другой игрок' : 'Ведущий выбирает игрока';
      if (sameStep) {
        // Another player's buzz can arrive while a finger is still pressing this button.
        const buzzer = previousPanel.querySelector('.buzzer');
        buzzer.disabled = locked;
        buzzer.querySelector('.buzzer-caption').textContent = label;
        previousPanel.querySelector('.player-seat span').textContent = `${me.score} очков`;
        return;
      }
      content = `<p class="eyebrow">${escape(state.category)} · ${escape(state.value)} очков</p>
        <button type="button" data-action="buzz" class="buzzer" ${locked ? 'disabled' : ''}><span aria-hidden="true">↯</span><strong class="buzzer-caption">${label}</strong></button>
        <p class="muted">Вопрос и фото на экране ведущего.</p>`;
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
        : `<form id="final-form"><p class="eyebrow">Финал</p><h1>${escape(state.finalTopic)}</h1>
          <label><span>Твой ответ</span><input name="answer" required maxlength="180" value="${escape(finalDraft.answer)}"></label>
          <label><span>Ставка (до ${Math.max(0, me.score)} очков)</span><input name="wager" type="number" min="0" max="${Math.max(0, me.score)}" step="1" required value="${escape(finalDraft.wager)}"></label>
          <button class="button primary" type="submit" ${sending ? 'disabled' : ''}>${submitLabel}</button>
        </form>`;
    } else {
      const copy = {
        lobby: ['Ты в игре', 'Ведущий скоро начнёт.'],
        board: ['Выбирают вопрос', 'Следи за табло.'],
        intermission: ['Перерыв', state.roundTitle ? `Дальше — ${state.roundTitle}` : 'Ведущий скоро начнёт следующий раунд.'],
        reveal: ['Ответ на ТВ', 'Скоро следующий вопрос.'],
        results: ['Игра окончена', 'Итоговый счёт ниже.']
      };
      const [heading, sub] = copy[state.phase];
      content = `${state.phase !== 'lobby' && state.roundNumber && state.roundTotal ? `<p class="eyebrow">Раунд ${escape(state.roundNumber)} из ${escape(state.roundTotal)}</p>` : ''}
        <h1>${heading}</h1><p>${escape(sub)}</p>`;
    }
    app.innerHTML = `<section class="panel player-panel" data-phase="${state.phase}" data-ticket="${escape(state.ticket)}"><div class="player-seat"><strong>${escape(me.name)}</strong><span>${me.score} очков</span></div>${content}</section>
      ${state.phase !== 'question' ? `<section class="panel score-panel"><h2>Счёт</h2>${scoreList(state.players)}</section>` : ''}`;
  }

  function sendPlayer(body) {
    if (player) connection?.send({ type: 'player', action: { ...body, ...player } });
  }

  function ping() {
    if (!player || state?.closed) return;
    sendPlayer({ type: 'join' });
    const note = document.querySelector('#join-note');
    if (note && Date.now() - attempted > 6500) {
      note.textContent = currentNetwork.length ? 'Проверьте, что вкладка ведущего открыта.' :
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

  const phases = ['lobby', 'board', 'question', 'reveal', 'intermission', 'final', 'results'];
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
      (pending.type === 'final-answer' && (next.submitted.includes(player.id) || next.phase !== 'final')))) pending = null;
    if (next.ticket !== state?.ticket) finalDraft = { answer: '', wager: '0' };
    state = next;
    if (player) renderPlayer();
  }

  connection = connectRoom(room, receive, active => { setNetwork(active); ping(); });
  setNetwork(currentNetwork);
  app.addEventListener('click', event => {
    const type = event.target.closest('[data-action]')?.dataset.action;
    if (type === 'buzz') reliable({ type });
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
  room = params.get('tv');
  const waiting = text => { app.innerHTML = `<section class="panel center"><h1>Экран ТВ</h1><p>${text}</p></section>`; };
  if (!validRoom(room) || !('BroadcastChannel' in window)) {
    waiting('Откройте экран ТВ из комнаты на устройстве ведущего.');
    return;
  }
  waiting('Ждём вкладку ведущего в этом браузере…');
  const channel = new BroadcastChannel('vne-ocheredi-screen-' + room);
  const poll = setInterval(() => channel.postMessage('screen-ready'), 2400);
  let lastHtml = null;
  channel.onmessage = ({ data }) => {
    if (data === 'screen-ready') return;
    if (data?.closed) {
      clearInterval(poll);
      waiting('Комната закрыта.');
      return;
    }
    if (typeof data?.html === 'string' && data.html !== lastHtml) {
      lastHtml = data.html;
      app.innerHTML = data.html;
    }
  };
  channel.postMessage('screen-ready');
}

if (mode === 'player') initPlayer();
else if (mode === 'tv') initTv();
else initHost();
