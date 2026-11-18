export const demoPack = {
  title: 'Квиз для своих',
  categories: [
    { title: '🍿 Кино без названия', questions: [
      { value: 100, prompt: 'Мальчик остаётся один дома и превращает его в полосу препятствий для двух грабителей. Как называется фильм?', answer: 'Один дома' },
      { value: 200, prompt: 'В этом мультфильме повар прячется под колпаком другого повара. Кто он?', answer: 'Крыс Реми, «Рататуй»' },
      { value: 300, prompt: 'Какой предмет в «Начале» герой запускает на столе, чтобы проверить реальность?', answer: 'Волчок', kind: 'handoff' }
    ] },
    { title: '🎭 Вика в кадре?', questions: [
      { value: 100, prompt: 'Вика или другой человек? Перед игрой добавь в редактор первый кадр и свой ответ.', answer: 'Тестовая карточка. Замените фото и ответ.' },
      { value: 200, prompt: 'В каком образе здесь Вика? Добавь фото и замени эту подсказку.', answer: 'Тестовая карточка. Впиши название образа.' },
      { value: 300, prompt: 'Это Вика или кто-то повторил её образ? Выбери свой кадр для последнего вопроса темы.', answer: 'Тестовая карточка. Замените фото и ответ.' }
    ] },
    { title: '📱 Интернет помнит', questions: [
      { value: 100, prompt: 'Как в браузере называется режим, в котором после закрытия окна история этого окна не сохраняется?', answer: 'Инкогнито, приватный режим' },
      { value: 200, prompt: 'Как называется намеренная пауза с зависшим лицом, которую оставляют в монтаже ради шутки?', answer: 'Стоп-кадр', kind: 'double' },
      { value: 300, prompt: 'Из какой игры взялось выражение «Крипер, о нет»?', answer: 'Minecraft' }
    ] },
    { title: '🧠 Вроде очевидно', questions: [
      { value: 100, prompt: 'Сколько месяцев в году имеют хотя бы 28 дней?', answer: 'Все 12' },
      { value: 200, prompt: 'Ты обгоняешь бегуна, который шёл вторым. Какое теперь у тебя место?', answer: 'Второе' },
      { value: 300, prompt: 'Какое слово начинается с трёх букв «е» подряд: «длинношеее» или «змея»? А теперь найди подвох.', answer: 'Ни одно. В «длинношеее» три «е» стоят в конце.' }
    ] }
  ],
  final: { topic: 'Праздник на кухне', prompt: 'У меня есть основание и верхушка. Меня режут на всех, хотя сначала на мне что-то зажигают. Что это?', answer: 'Торт со свечами' }
};

export const kinds = { normal: 'Обычный вопрос', handoff: 'Передача хода', double: 'Двойная цена' };
const own = (object, key) => Object.hasOwn(object, key);
const clean = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const image = value => {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 1_250_000 ||
      !/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) throw new Error('Фото в пакете имеет неподдерживаемый формат.');
  return value;
};

export function validPack(input) {
  if (!Array.isArray(input?.categories) || input.categories.length < 1 || input.categories.length > 8) {
    throw new Error('Укажите от одной до восьми тем.');
  }
  const title = clean(input.title, 80);
  if (!title) throw new Error('Дайте набору название.');
  let photoSize = 0;
  const categories = input.categories.map((category, i) => {
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
      const photo = image(question.image);
      photoSize += photo.length;
      if (photoSize > 25_000_000) throw new Error('Фото в наборе занимают больше 25 МБ. Уменьшите снимки или разделите набор.');
      return {
        id: `c${i}q${j}`, prompt, answer, value,
        hint: clean(question.hint, 380),
        image: photo,
        kind: own(kinds, question.kind) ? question.kind : 'normal'
      };
    }) };
  });
  let final = null;
  if (input.final) {
    const topic = clean(input.final.topic, 60);
    const prompt = clean(input.final.prompt, 1200);
    const answer = clean(input.final.answer, 650);
    if (!topic || !prompt || !answer) throw new Error('У финала должны быть тема, вопрос и ответ.');
    final = { topic, prompt, answer };
  }
  return { title, categories, final };
}

export function createGame() {
  return {
    phase: 'lobby', players: {}, used: [], current: null, revision: 0, ticket: '',
    answering: null, queue: [], buzzed: [], showHint: false, opened: false,
    finalAnswers: {}, verdicts: [], previous: null
  };
}

export function findQuestion(pack, id) {
  for (const category of pack.categories) {
    const question = category.questions.find(q => q.id === id);
    if (question) return { ...question, category: category.title };
  }
  return null;
}

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
      if (phase !== 'board' || game.used.includes(action.question) || !findQuestion(pack, action.question)) return false;
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
    case 'final':
      if (phase !== 'board') return false;
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
    answering: game.answering, queue: [...game.queue], buzzed: [...game.buzzed], opened: game.opened,
    category: question?.category || '', value: question ? points(question) : null,
    title: pack.title, finalTopic: pack.final?.topic || '', submitted: Object.keys(game.finalAnswers)
  };
}
