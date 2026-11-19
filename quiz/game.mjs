import { demoPack, bundledImages, legacyZodiacImages, zodiacPrompt } from './starter.mjs?v=12';
export { demoPack };

export const kinds = { normal: 'Обычный вопрос', handoff: 'Передача хода', double: 'Двойная цена' };
const own = (object, key) => Object.hasOwn(object, key);
const clean = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const image = value => {
  if (!value) return '';
  if (bundledImages.has(value)) return value;
  if (typeof value !== 'string' || value.length > 1_250_000 ||
      !/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) throw new Error('Фото в пакете имеет неподдерживаемый формат.');
  return value;
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
          image: photo,
          kind: own(kinds, question.kind) ? question.kind : 'normal'
        };
      }) };
    });
    return { title: name, note: clean(round.note, 160), categories };
  });
  let final = null;
  if (input.final) {
    const topic = clean(input.final.topic, 60);
    const prompt = clean(input.final.prompt, 1200);
    const answer = clean(input.final.answer, 650);
    if (!topic || !prompt || !answer) throw new Error('У финала должны быть тема, вопрос и ответ.');
    final = { topic, prompt, answer };
  }
  return { title, rounds, final };
}

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
  const previousStarters = modern ? [366822770, 1223642323, 1424932977, 1553481786, 1995171786, 2307851871, 2797217173, 3074735322, 3101850007, 3520321658] : [722339280];
  if (previousStarters.includes(fingerprint >>> 0)) return structuredClone(demoPack);
  return saved;
}

export function createGame() {
  return {
    phase: 'lobby', roundIndex: 0, players: {}, used: [], current: null, revision: 0, ticket: '',
    answering: null, queue: [], buzzed: [], showHint: false, opened: false,
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

function resolveQuestion(game) {
  game.phase = 'reveal';
  game.askedBy = game.answering;
  game.answering = null;
  game.opened = false;
  if (!game.used.includes(game.current)) game.used.push(game.current);
}

function applyHost(game, pack, action) {
  const phase = game.phase;
  switch (action.type) {
    case 'start':
      if (phase !== 'lobby') return false;
      game.phase = 'board';
      return true;
    case 'pick':
      if (phase !== 'board' || game.used.includes(action.question) ||
          !roundQuestions(activeRound(pack, game)).some(q => q.id === action.question)) return false;
      Object.assign(game, {
        current: action.question, ticket: nextTicket(game), phase: 'question',
        answering: null, queue: [], buzzed: [], opened: false, showHint: false, askedBy: null
      });
      return true;
    case 'open':
      if (phase !== 'question' || game.opened || game.answering) return false;
      game.opened = true;
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
        resolveQuestion(game);
      } else {
        if (action.verdict === 'wrong') player.score -= value;
        game.answering = game.queue.shift() || null;
        game.opened = true;
      }
      return true;
    }
    case 'reveal':
      if (phase !== 'question') return false;
      resolveQuestion(game);
      return true;
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
      game.phase = pack.final ? 'final' : 'results';
      game.ticket = nextTicket(game);
      game.finalAnswers = {};
      return true;
    case 'finish': {
      if (phase !== 'final' || !Array.isArray(action.correct)) return false;
      game.verdicts = Object.entries(game.finalAnswers).map(([id, entry]) => {
        const correct = action.correct.includes(id);
        getPlayer(game, id).score += correct ? entry.wager : -entry.wager;
        return { id, ...entry, correct };
      });
      game.phase = 'results';
      return true;
    }
    default:
      return false;
  }
}

function applyPlayer(game, action) {
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
  if (!player || action.ticket !== game.ticket) return false;
  if (action.type === 'buzz' && game.phase === 'question' && game.opened && !game.buzzed.includes(id)) {
    game.buzzed.push(id);
    if (game.answering) game.queue.push(id);
    else game.answering = id;
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
  if (host && action.type === 'undo') {
    if (!game.previous) return false;
    const revision = game.revision;
    const players = game.players;
    Object.assign(game, game.previous, { revision: revision + 1, previous: null });
    if (['question', 'final'].includes(game.phase)) game.ticket = nextTicket(game);
    for (const [id, player] of Object.entries(players)) {
      if (!getPlayer(game, id)) game.players[id] = player;
    }
    return true;
  }
  const before = host ? structuredClone({ ...game, previous: null }) : null;
  if (!(host ? applyHost(game, pack, action) : applyPlayer(game, action))) return false;
  if (host) game.previous = before;
  game.revision++;
  return true;
}

export function publicState(game, pack) {
  const question = findQuestion(pack, game.current);
  return {
    phase: game.phase, revision: game.revision, ticket: game.ticket, players: standings(game),
    roundNumber: roundIndex(game) + 1, roundTotal: pack.rounds.length, roundTitle: activeRound(pack, game).title,
    answering: game.answering, queue: [...game.queue], buzzed: [...game.buzzed], opened: game.opened,
    category: question?.category || '', value: question ? points(question) : null,
    title: pack.title, finalTopic: pack.final?.topic || '', submitted: Object.keys(game.finalAnswers)
  };
}
