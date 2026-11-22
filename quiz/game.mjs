import { demoPack, bundledImages, legacyZodiacImages, zodiacPrompt } from './starter.mjs?v=17';
export { demoPack };

export const kinds = { normal: 'Обычный вопрос', handoff: 'Кот в мешке', double: 'Двойная цена', modifier: 'Модификатор' };
const own = (object, key) => Object.hasOwn(object, key);
const clean = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const packMedia = /^packs\/media\/[a-f0-9]{12}\.(webp|mp3)$/;
export const packImage = value => typeof value === 'string' && packMedia.test(value) && value.endsWith('.webp');
export const packSound = value => typeof value === 'string' && packMedia.test(value) && value.endsWith('.mp3');
const sound = value => packSound(value) ? value : '';
const image = value => {
  if (!value) return '';
  if (bundledImages.has(value) || packImage(value)) return value;
  if (typeof value !== 'string' || value.length > 1_250_000 ||
      !/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) throw new Error('Фото в пакете имеет неподдерживаемый формат.');
  return value;
};

// Answer and final pictures reach the TV inside the state frame, which carries paths only.
const stock = value => {
  if (!value) return '';
  if (bundledImages.has(value) || packImage(value)) return value;
  throw new Error('Фото ответа и фото финала можно брать только из готовых наборов.');
};

export function validPack(input) {
  const title = clean(input?.title, 80);
  if (!title) throw new Error('Дайте набору название.');
  const source = roundList(input);
  if (source.length < 1 || source.length > 3) throw new Error('В наборе должно быть от одного до трёх раундов.');
  let photoSize = 0;
  const rounds = source.map((round, r) => {
    const name = clean(round?.title, 48);
    if (!name || !Array.isArray(round.categories) || !round.categories.length || round.categories.length > 8) {
      throw new Error(`Раунду ${r + 1} нужны название и 1–8 тем.`);
    }
    const categories = round.categories.map((category, i) => {
      const title = clean(category?.title, 60);
      if (!title || !Array.isArray(category.questions) || !category.questions.length || category.questions.length > 8) {
        throw new Error(`Теме ${i + 1} нужны название и 1–8 вопросов.`);
      }
      return { title, questions: category.questions.map((question, j) => {
        const prompt = clean(question?.prompt, 1200);
        const answer = clean(question?.answer, 650);
        const value = Number(question?.value);
        if (!prompt || !answer || !Number.isInteger(value) || value < 1 || value > 9999) {
          throw new Error(`«${title}», вопрос ${j + 1}. Нужны вопрос, ответ и цена от 1 до 9999.`);
        }
        const legacyZodiac = question.image ? '' : legacyZodiacImages.get(prompt);
        const photo = image(question.image || legacyZodiac);
        photoSize += photo.length;
        if (photoSize > 25_000_000) throw new Error('Фото в наборе занимают больше 25 МБ. Уменьшите снимки или разделите набор.');
        return {
          id: `${r === 0 ? '' : 'r' + r}c${i}q${j}`, prompt: legacyZodiac ? zodiacPrompt : prompt, answer, value,
          hint: clean(question.hint, 380),
          image: photo, answerImage: stock(question.answerImage),
          audio: sound(question.audio), answerAudio: sound(question.answerAudio),
          kind: own(kinds, question.kind) ? question.kind : 'normal'
        };
      }) };
    });
    return { title: name, note: clean(round.note, 160), categories };
  });
  const finalSource = Array.isArray(input.finals) ? input.finals : input.final ? [input.final] : [];
  if (finalSource.length > 16) throw new Error('В наборе может быть не больше 16 тем финала.');
  const finals = finalSource.map(item => {
    const topic = clean(item?.topic, 60);
    const prompt = clean(item?.prompt, 1200);
    const answer = clean(item?.answer, 650);
    if (!topic || !prompt || !answer) throw new Error('У финала должны быть тема, вопрос и ответ.');
    return { topic, prompt, answer, image: stock(item.image), answerImage: stock(item.answerImage), audio: sound(item.audio) };
  });
  return { title, rounds, final: finals[0] || null, finals };
}

export const activeFinal = (pack, game) => pack.finals?.[game.finalIndex || 0] || pack.final;

function roundList(input) {
  if (Array.isArray(input?.rounds)) return input.rounds;
  return Array.isArray(input?.categories) ? [{ title: 'Основной раунд', note: '', categories: input.categories }] : [];
}

export function restoreDraft(input) {
  const rounds = roundList(input);
  if (!rounds.length) return structuredClone(demoPack);
  // Upgrade untouched starter decks from prior releases. Edited decks retain their questions.
  const modern = Array.isArray(input.rounds);
  const saved = modern ? input : { title: input.title, rounds, final: input.final };
  if (rounds.some(round => round.categories.some(category =>
    category.questions.some(question => question.image && !bundledImages.has(question.image))))) return saved;
  const categories = source => source.map(c => [c.title, c.questions.map(q =>
    [q.value, q.prompt, q.answer, q.hint || '', q.image || '', q.kind || 'normal'])]);
  const canonical = [input.title, modern ? rounds.map(r => [r.title, r.note || '', categories(r.categories)]) : categories(input.categories),
    [input.final?.topic, input.final?.prompt, input.final?.answer]];
  let fingerprint = 2166136261;
  for (const character of JSON.stringify(canonical)) fingerprint = Math.imul(fingerprint ^ character.codePointAt(0), 16777619);
  const previousStarters = modern ? [366822770, 934521528, 1223642323, 1424932977, 1553481786, 1995171786, 2307851871, 2797217173, 3074735322, 3101850007, 3520321658, 3804754446] : [722339280];
  if (previousStarters.includes(fingerprint >>> 0)) return structuredClone(demoPack);
  return saved;
}

export const modes = { buzz: 'Кто быстрее', turns: 'По очереди' };
// Seconds to press the button once the host has opened it; the answer itself gets answerTime.
export const paces = { 0: 'Без таймера', 7: '7 секунд', 10: '10 секунд', 15: '15 секунд', 30: '30 секунд' };
export const answerTime = 20;
export const pace = game => own(paces, game.pace ?? 10) ? game.pace ?? 10 : 10;

export function createGame(mode = 'buzz') {
  return {
    mode: own(modes, mode) ? mode : 'buzz', turn: 0, finalIndex: 0, race: [],
    phase: 'lobby', roundIndex: 0, players: {}, used: [], current: null, revision: 0, ticket: '',
    answering: null, queue: [], buzzed: [], showHint: false, opened: false,
    chooser: null, pace: 10, paused: false, finalOut: [], revealed: 0,
    finalAnswers: {}, verdicts: [], previous: null
  };
}

export function findQuestion(pack, id) {
  for (const round of pack.rounds) {
    for (const category of round.categories) {
      const question = category.questions.find(q => q.id === id);
      if (question) return { ...question, category: category.title };
    }
  }
  return null;
}

export const roundIndex = game => game.roundIndex ?? 0;
export const activeRound = (pack, game) => pack.rounds[roundIndex(game)];
export const roundQuestions = round => round.categories.flatMap(category => category.questions);
export const remainingQuestions = (pack, game) => roundQuestions(activeRound(pack, game))
  .filter(question => !game.used.includes(question.id)).length;

export const points = question => question.value * (question.kind === 'double' ? 2 : 1);
export const standings = game => Object.entries(game.players)
  .map(([id, player]) => ({ id, name: player.name, score: player.score }))
  .sort((a, b) => b.score - a.score);
const getPlayer = (game, id) => own(game.players, id) ? game.players[id] : null;
const nextTicket = game => String(game.revision + 1);
const offersHandoff = (game, question) => question.kind === 'handoff' && Object.keys(game.players).length > 0;

const byTurns = game => game.mode === 'turns';
const order = game => Object.keys(game.players);
export const turnPlayer = game => byTurns(game) && order(game).length ? order(game)[(game.turn || 0) % order(game).length] : null;
// «Кто быстрее»: whoever answered right picks the next question; the first player opens the game.
export const chooser = game => byTurns(game) ? turnPlayer(game) :
  own(game.players, game.chooser || '') ? game.chooser : order(game)[0] || null;
// A «кот в мешке» nobody has been given yet: the screens keep the question closed until the host hands it over.
export const awaitingHandoff = (game, pack) => game.phase === 'question' && !game.opened && !game.answering &&
  !game.buzzed.length && order(game).length > 0 && findQuestion(pack, game.current)?.kind === 'handoff';

export const finalTopics = (pack, game) => (pack.finals || []).map((final, index) =>
  ({ topic: final.topic, out: (game.finalOut || []).includes(index) }));
// Final themes are struck out in turn, the lowest score first.
export const remover = game => {
  const seats = standings(game).reverse();
  return game.phase === 'themes' && seats.length ? seats[(game.finalOut || []).length % seats.length].id : null;
};

function strike(game, pack, topic) {
  const left = (pack.finals || []).map((_, index) => index).filter(index => !(game.finalOut || []).includes(index));
  if (game.phase !== 'themes' || !left.includes(topic) || left.length < 2) return false;
  game.finalOut = [...(game.finalOut || []), topic];
  if (left.length === 2) Object.assign(game, { phase: 'final', finalIndex: left.find(index => index !== topic), ticket: nextTicket(game) });
  return true;
}

// The button opens only when the host has read the question, so a restored game stays as it was saved.
export const restoreGame = game => game;

// Phones report their own reaction time, so a slow connection does not lose to a fast one.
export function settle(game) {
  if (!game.race?.length) return false;
  const ranked = [...game.race].sort((a, b) => a.ms - b.ms).map(entry => entry.id);
  game.race = [];
  if (!game.answering) game.answering = ranked.shift();
  game.queue.push(...ranked);
  game.revision++;
  return true;
}

function resolveQuestion(game) {
  game.phase = 'reveal';
  game.askedBy = game.answering;
  game.answering = null;
  game.opened = false;
  game.race = [];
  if (byTurns(game) && order(game).length) game.turn = ((game.turn || 0) + 1) % order(game).length;
  if (!game.used.includes(game.current)) game.used.push(game.current);
}

function applyHost(game, pack, action) {
  const phase = game.phase;
  switch (action.type) {
    case 'again':
      // Same room and players, a fresh score: nobody has to scan the code again.
      if (phase !== 'results') return false;
      Object.assign(game, createGame(game.mode), { revision: game.revision, pace: pace(game),
        players: Object.fromEntries(Object.entries(game.players).map(([id, player]) => [id, { name: player.name, score: 0 }])) });
      return true;
    case 'start':
      if (phase !== 'lobby') return false;
      game.phase = 'board';
      return true;
    case 'pick': {
      if (phase !== 'board' || game.used.includes(action.question)) return false;
      const question = roundQuestions(activeRound(pack, game)).find(q => q.id === action.question);
      if (!question) return false;
      // A modifier is a card the host reads out and applies by hand: nobody answers it.
      const first = offersHandoff(game, question) || question.kind === 'modifier' ? null : turnPlayer(game);
      Object.assign(game, {
        current: question.id, ticket: nextTicket(game), phase: 'question', race: [],
        answering: first, queue: [], buzzed: first ? [first] : [], opened: false, showHint: false, askedBy: null
      });
      return true;
    }
    case 'mode':
      if (!['lobby', 'board', 'intermission'].includes(phase) || !own(modes, action.mode) || action.mode === game.mode) return false;
      game.mode = action.mode;
      return true;
    case 'pace':
      if (!['lobby', 'board', 'intermission'].includes(phase) || !Number.isInteger(action.seconds) || !own(paces, action.seconds) || action.seconds === pace(game)) return false;
      game.pace = action.seconds;
      return true;
    case 'open':
      if (phase !== 'question' || game.opened || game.answering || findQuestion(pack, game.current)?.kind === 'modifier') return false;
      if (byTurns(game)) {
        // A handoff the host decides not to hand over goes to the player whose turn it is.
        if (game.buzzed.length || !turnPlayer(game)) return false;
        game.answering = turnPlayer(game);
        game.buzzed.push(game.answering);
      } else game.opened = true;
      return true;
    case 'assign':
      if (phase !== 'question' || game.opened || game.answering || !getPlayer(game, action.player) ||
          findQuestion(pack, game.current)?.kind !== 'handoff') return false;
      game.answering = action.player;
      game.buzzed.push(action.player);
      return true;
    case 'hint':
      if (phase !== 'question' || game.showHint || !findQuestion(pack, game.current)?.hint) return false;
      game.showHint = true;
      return true;
    case 'judge': {
      if (phase !== 'question' || !game.answering || !['correct', 'wrong', 'neutral'].includes(action.verdict)) return false;
      const value = points(findQuestion(pack, game.current));
      const player = getPlayer(game, game.answering);
      if (!player) return false;
      if (action.verdict === 'correct') {
        player.score += value;
        game.chooser = game.answering;
        resolveQuestion(game);
      } else {
        if (action.verdict === 'wrong') player.score -= value;
        if (byTurns(game)) {
          // Everyone gets one try, in seating order, starting after the player who has just answered.
          const seats = order(game);
          const from = seats.indexOf(game.answering);
          game.answering = seats.map((_, i) => seats[(from + 1 + i) % seats.length]).find(id => !game.buzzed.includes(id)) || null;
          if (game.answering) game.buzzed.push(game.answering);
        } else {
          game.answering = game.queue.shift() || null;
          game.opened = true;
        }
      }
      return true;
    }
    case 'reveal':
      if (phase !== 'question') return false;
      resolveQuestion(game);
      if (findQuestion(pack, game.current)?.kind === 'modifier') Object.assign(game, { phase: 'board', current: null });
      return true;
    case 'score': {
      // Modifier cards and disputes: the host sets a player's score by hand. Not in the final: wagers are capped by the score.
      const player = getPlayer(game, action.player);
      if (!player || ['lobby', 'final', 'showdown', 'results'].includes(phase) || !Number.isSafeInteger(action.score) ||
          Math.abs(action.score) > 9_999_999 || action.score === player.score) return false;
      player.score = action.score;
      return true;
    }
    case 'board':
      if (phase !== 'reveal') return false;
      game.phase = 'board';
      game.current = null;
      return true;
    case 'next-round':
      if (phase !== 'board' || roundIndex(game) >= pack.rounds.length - 1 ||
          (remainingQuestions(pack, game) && action.skip !== true)) return false;
      Object.assign(game, {
        roundIndex: roundIndex(game) + 1, phase: 'intermission', ticket: nextTicket(game),
        answering: null, queue: [], buzzed: [], opened: false, showHint: false, askedBy: null
      });
      return true;
    case 'start-round':
      if (phase !== 'intermission') return false;
      game.phase = 'board';
      return true;
    case 'final':
      if (phase !== 'board' || roundIndex(game) !== pack.rounds.length - 1 ||
          (remainingQuestions(pack, game) && action.skip !== true)) return false;
      Object.assign(game, { ticket: nextTicket(game), finalAnswers: {}, finalOut: [], verdicts: [], revealed: 0, finalIndex: 0 });
      if (!pack.final) game.phase = 'results';
      else if (Number.isInteger(action.topic) && pack.finals?.[action.topic]) Object.assign(game, { phase: 'final', finalIndex: action.topic });
      // Several themes: the players strike them out one by one until a single theme is left.
      else game.phase = (pack.finals?.length || 0) > 1 && order(game).length ? 'themes' : 'final';
      return true;
    case 'strike':
      return strike(game, pack, action.topic);
    case 'final-topic':
      if (phase !== 'themes' || !pack.finals?.[action.topic]) return false;
      Object.assign(game, { phase: 'final', finalIndex: action.topic, ticket: nextTicket(game) });
      return true;
    case 'finish': {
      if (phase !== 'final' || !Array.isArray(action.correct)) return false;
      // The stakes are opened one by one, the lowest score first, so the leader is the last to know.
      game.verdicts = standings(game).reverse().filter(player => own(game.finalAnswers, player.id))
        .map(({ id }) => ({ id, ...game.finalAnswers[id], correct: action.correct.includes(id) }));
      game.revealed = 0;
      game.phase = game.verdicts.length ? 'showdown' : 'results';
      return true;
    }
    case 'unveil': {
      if (phase !== 'showdown') return false;
      const rest = game.verdicts.slice(game.revealed, action.all === true ? undefined : game.revealed + 1);
      for (const verdict of rest) getPlayer(game, verdict.id).score += verdict.correct ? verdict.wager : -verdict.wager;
      game.revealed += rest.length;
      if (!rest.length || action.all === true) game.phase = 'results';
      return true;
    }
    default:
      return false;
  }
}

function applyPlayer(game, pack, action) {
  const id = typeof action.id === 'string' ? action.id : '';
  if (!/^p[a-zA-Z0-9_-]{1,48}$/.test(id)) return false;
  const player = getPlayer(game, id);
  if (action.type === 'join') {
    const name = clean(action.name, 24);
    if (!name || player || Object.keys(game.players).length >= 12 || game.phase === 'results') return false;
    const existing = new Set(Object.values(game.players).map(p => p.name.toLowerCase()));
    let display = name;
    for (let n = 2; existing.has(display.toLowerCase()); n++) display = name.slice(0, 20) + ' · ' + n;
    game.players[id] = { name: display, score: 0 };
    return true;
  }
  if (!player || game.paused || action.ticket !== game.ticket) return false;
  if (action.type === 'strike') return remover(game) === id && strike(game, pack, action.topic);
  if (action.type === 'buzz' && game.phase === 'question' && game.opened && !game.buzzed.includes(id)) {
    game.buzzed.push(id);
    if (game.answering) game.queue.push(id);
    else (game.race ||= []).push({ id, ms: Number.isInteger(action.ms) && action.ms >= 0 && action.ms < 60000 ? action.ms : 60000 });
    return true;
  }
  if (action.type === 'final-answer' && game.phase === 'final' && !own(game.finalAnswers, id)) {
    const answer = clean(action.answer, 180);
    const wager = action.wager;
    if (!answer || !Number.isInteger(wager) || wager < 0 || wager > Math.max(0, player.score)) return false;
    game.finalAnswers[id] = { answer, wager };
    return true;
  }
  return false;
}

export function command(game, pack, action, host = false) {
  if (!action || typeof action !== 'object') return false;
  if (host && action.type === 'pause') {
    // A pause is not a move: «Отмена» still takes back the last real action.
    if (['lobby', 'results'].includes(game.phase)) return false;
    game.paused = !game.paused;
    game.revision++;
    return true;
  }
  if (host && action.type === 'undo') {
    if (!game.previous) return false;
    const { revision, players, paused } = game;
    Object.assign(game, restoreGame(game.previous, pack), { revision: revision + 1, previous: null, paused });
    if (['question', 'final'].includes(game.phase)) game.ticket = nextTicket(game);
    for (const [id, player] of Object.entries(players)) {
      if (!getPlayer(game, id)) game.players[id] = player;
    }
    return true;
  }
  const before = host ? structuredClone({ ...game, previous: null }) : null;
  if (!(host ? applyHost(game, pack, action) : applyPlayer(game, pack, action))) return false;
  if (host) game.previous = action.type === 'again' ? null : before;
  game.revision++;
  return true;
}

export function publicState(game, pack) {
  const question = findQuestion(pack, game.current);
  const closed = awaitingHandoff(game, pack);
  // In the final the phones show the question next to the answer field.
  const shown = game.phase === 'final' ? activeFinal(pack, game) : question && !closed ? question : null;
  return {
    phase: game.phase, revision: game.revision, ticket: game.ticket, players: standings(game),
    roundNumber: roundIndex(game) + 1, roundTotal: pack.rounds.length, roundTitle: activeRound(pack, game).title,
    answering: game.answering, queue: [...game.queue], buzzed: [...game.buzzed], opened: game.opened,
    category: question?.category || '', value: question ? points(question) : null, modifier: question?.kind === 'modifier',
    // The phone repeats the TV for those who sit far from it: the text and a pack picture, never the answer before the reveal.
    prompt: shown && shown.prompt !== shown.category ? shown.prompt : '',
    sound: Boolean(shown?.audio),
    image: shown && (bundledImages.has(shown.image) || packImage(shown.image)) ? shown.image : '',
    answer: game.phase === 'reveal' && question ? question.answer : '',
    title: pack.title, finalTopic: activeFinal(pack, game)?.topic || '', submitted: Object.keys(game.finalAnswers),
    mode: game.mode || 'buzz', turn: turnPlayer(game), racing: (game.race || []).length > 0,
    chooser: chooser(game), handoff: closed, paused: Boolean(game.paused),
    themes: game.phase === 'themes' ? finalTopics(pack, game) : [], remover: remover(game)
  };
}
