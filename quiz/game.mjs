export const demoPack = {
  title: 'Квиз для своих',
  rounds: [
    { title: 'Разогрев', note: 'Кино, интернет и подвохи на скорость.', categories: [
      { title: 'Кино без названия', questions: [
        { value: 100, prompt: 'Мальчик остаётся один дома и превращает его в полосу препятствий для двух грабителей. Как называется фильм?', answer: 'Один дома' },
        { value: 200, prompt: 'В этом мультфильме повар прячется под колпаком другого повара. Кто он?', answer: 'Крыс Реми, «Рататуй»' },
        { value: 300, prompt: 'Какой предмет в «Начале» герой запускает на столе, чтобы проверить реальность?', answer: 'Волчок', kind: 'handoff' }
      ] },
      { title: 'Вроде очевидно', questions: [
        { value: 100, prompt: 'Сколько месяцев в году имеют хотя бы 28 дней?', answer: 'Все 12' },
        { value: 200, prompt: 'Ты обгоняешь бегуна, который шёл вторым. Какое теперь у тебя место?', answer: 'Второе' },
        { value: 300, prompt: 'Электронный таймер показывает 1:30. Ты добавляешь 45 секунд. Что будет на экране?', answer: '2:15' }
      ] },
      { title: 'Интернет помнит', questions: [
        { value: 100, prompt: 'Как называется режим браузера, в котором не сохраняется история посещений после закрытия окна?', answer: 'Инкогнито, приватный режим' },
        { value: 200, prompt: 'Как называется приём монтажа, когда видео на несколько секунд превращается в неподвижную картинку?', answer: 'Стоп-кадр', kind: 'double' },
        { value: 300, prompt: 'Из какой игры взялись криперы — зелёные существа, которые шипят и взрываются?', answer: 'Minecraft' }
      ] }
    ] },
    { title: 'Свои люди', note: 'Образы, чат и обычные вещи с необычной стороны.', categories: [
      { title: 'Вика в кадре?', questions: [
        { value: 200, prompt: 'Вика собирает образ на вечеринку: две косички, чёрное платье, белый воротничок. Какую героиню она изображает?', answer: 'Уэнсдэй Аддамс' },
        { value: 400, prompt: 'В кадре осталось только три предмета: тыква, часы, которые почти пробили полночь, и одна туфелька. Какой персонаж остался за кадром?', answer: 'Золушка' },
        { value: 600, prompt: 'Белые носки, одна блестящая перчатка. Вика скользит назад, хотя кажется, что шагает вперёд. Как называется движение?', answer: 'Лунная походка, moonwalk', hint: 'Движение прославил Майкл Джексон.' }
      ] },
      { title: 'В общем чате', questions: [
        { value: 200, prompt: 'Три друга написали «я уже выхожу» с разницей ровно в пять минут. Первый написал в 19:07. Во сколько написал третий?', answer: 'В 19:17' },
        { value: 400, prompt: 'В чате пятеро. Каждый ставит ровно одну реакцию на сообщение каждого из остальных. Сколько реакций?', answer: '20: у каждого по четыре реакции.' },
        { value: 600, prompt: 'После вечеринки 6 друзей хотят сфотографироваться всеми парами. По одному снимку на пару. Сколько будет фотографий?', answer: '15: 6 × 5 ÷ 2.', kind: 'handoff' }
      ] },
      { title: 'На кухне', questions: [
        { value: 200, prompt: 'Как называют итальянский десерт, в котором печенье пропитывают кофе и выкладывают слоями с кремом из маскарпоне?', answer: 'Тирамису' },
        { value: 400, prompt: 'На пачке гречки указано: две части воды на одну часть крупы. Сколько воды нужно на полтора стакана крупы?', answer: 'Три стакана' },
        { value: 600, prompt: 'У рассола и морской воды есть общий химический компонент, из-за которого оба солёные. Назовите бытовое название вещества.', answer: 'Поваренная соль, хлорид натрия' }
      ] }
    ] },
    { title: 'На риск', note: 'Дорогие вопросы, где стоит дослушать условие.', categories: [
      { title: 'Смотри внимательнее', questions: [
        { value: 300, prompt: 'В слове «длинношеее» три одинаковые буквы подряд. Какие и где они стоят?', answer: 'Три «е», в самом конце.' },
        { value: 600, prompt: 'На электронных часах 20:02. Цифры читаются одинаково в обе стороны. В какое время сегодня часы покажут следующий такой набор цифр?', answer: '21:12' },
        { value: 900, prompt: 'На обычных часах ровно 3:15. На сколько градусов часовая стрелка ушла от отметки «3»?', answer: '7,5 градуса: за 15 минут проходит четверть от 30°.', hint: 'Между соседними цифрами 30 градусов.' }
      ] },
      { title: 'По одному намёку', questions: [
        { value: 300, prompt: 'У этой европейской страны нет выхода к морю, есть Альпы, а флаг — белый крест на красном квадрате. Назовите страну.', answer: 'Швейцария' },
        { value: 600, prompt: 'Это одновременно единица измерения электрического сопротивления и фамилия немецкого физика. Что это?', answer: 'Ом' },
        { value: 900, prompt: 'Эта шахматная фигура по-английски называется bishop. В русском названии — крупное животное. Как называется фигура?', answer: 'Слон', hint: 'На доске ходит по диагонали.' }
      ] },
      { title: 'Последний расчёт', questions: [
        { value: 300, prompt: 'В коробке 12 жетонов, и четверть из них красные. Все остальные белые. Сколько белых?', answer: 'Девять' },
        { value: 600, prompt: 'У вас один нож и круглый пирог. Сколько максимум кусков получится за три прямых разреза сверху, если пирог не складывать и не перекладывать куски?', answer: 'Семь. Каждый новый разрез пересекает предыдущие в разных точках.' },
        { value: 900, prompt: 'Монету подбрасывают два раза. Какова вероятность, что орёл выпадет ровно один раз, если монета честная?', answer: 'Одна вторая: орёл–решка или решка–орёл, два случая из четырёх.', kind: 'double' }
      ] }
    ] }
  ],
  final: { topic: 'Перепутанные коробки', prompt: 'Приз в одной из трёх коробок. На А написано «Приз здесь», на Б — «Приза здесь нет», на В — «Приза нет в коробке А». Только одна надпись правдива. Где приз?', answer: 'В коробке Б. Тогда правдива только надпись на В. При любом другом варианте верны две надписи.' }
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
        const photo = image(question.image);
        photoSize += photo.length;
        if (photoSize > 25_000_000) throw new Error('Фото в наборе занимают больше 25 МБ. Уменьшите снимки или разделите набор.');
        return {
          id: `${r === 0 ? '' : 'r' + r}c${i}q${j}`, prompt, answer, value,
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
  if (Array.isArray(input?.rounds) && input.rounds.length) return input;
  if (!Array.isArray(input?.categories) || !input.categories.length) return structuredClone(demoPack);
  // Upgrade the original starter deck while preserving every edited or imported legacy draft.
  const canonical = [input.title, input.categories.map(c => [c.title, c.questions.map(q =>
    [q.value, q.prompt, q.answer, q.hint || '', q.image || '', q.kind || 'normal'])]),
    [input.final?.topic, input.final?.prompt, input.final?.answer]];
  let fingerprint = 2166136261;
  for (const character of JSON.stringify(canonical)) fingerprint = Math.imul(fingerprint ^ character.codePointAt(0), 16777619);
  if ((fingerprint >>> 0) === 722339280) return structuredClone(demoPack);
  return { title: input.title, rounds: roundList(input), final: input.final };
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
