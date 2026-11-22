import { activeRound, activeFinal, findQuestion, roundIndex, turnPlayer, packImage, packSound, modes } from './game.mjs?v=20';
import { bundledImages } from './starter.mjs?v=17';

export const photoChunkSize = 16_000;
export const photoBatchSize = 6;
const maxPhotoLength = 1_250_000;
const phases = ['lobby', 'board', 'question', 'reveal', 'intermission', 'final', 'results'];
const questionId = /^(?:r[12])?c[0-7]q[0-7]$/;
const roomCode = /^[a-f0-9]{24}$/;
const playerId = /^p[a-zA-Z0-9_-]{1,48}$/;
const validPhoto = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const own = (record, key) => Object.prototype.hasOwnProperty.call(record, key);
const text = (value, max) => typeof value === 'string' && value.length <= max;
const picture = value => value === '' || bundledImages.has(value) || packImage(value);
const track = value => value === '' || packSound(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

export function screenState(game, pack, invite = '') {
  const displayingQuestion = game.phase === 'question' || game.phase === 'reveal';
  const question = displayingQuestion ? findQuestion(pack, game.current) : null;
  const round = activeRound(pack, game);
  const board = game.phase === 'board';
  const finished = game.phase === 'results';
  const final = activeFinal(pack, game);
  const inFinal = game.phase === 'final';
  const reveal = game.phase === 'reveal';
  return {
    revision: game.revision,
    invite: game.phase === 'lobby' ? invite : '',
    session: {
      phase: game.phase, roundIndex: roundIndex(game), players: game.players, answering: game.answering,
      used: board ? game.used : [], showHint: game.showHint, opened: game.opened,
      verdicts: finished ? game.verdicts : [], mode: game.mode || 'buzz', turn: turnPlayer(game)
    },
    source: {
      title: pack.title,
      rounds: pack.rounds.map(({ title }, index) => index === roundIndex(game) ? {
        title, note: game.phase === 'intermission' ? round.note : '',
        categories: board ? round.categories.map(category => ({
          title: category.title, questions: category.questions.map(({ id, value, image }) => ({
            id, value, image: Boolean(image)
          }))
        })) : []
      } : { title, note: '', categories: [] }),
      final: final ? {
        topic: inFinal ? final.topic : '',
        prompt: inFinal ? final.prompt : '',
        answer: finished ? final.answer : '',
        image: inFinal && final.image || '',
        audio: inFinal && final.audio || '',
        answerImage: finished && final.answerImage || ''
      } : null
    },
    question: question && {
      ...question,
      image: bundledImages.has(question.image) || packImage(question.image) ? question.image : '',
      hint: game.showHint ? question.hint : '',
      answer: reveal ? question.answer : '',
      answerImage: reveal ? question.answerImage : '',
      answerAudio: reveal ? question.answerAudio : ''
    },
    photoLength: question?.image.startsWith('data:') ? question.image.length : 0
  };
}

function validInvite(invite) {
  if (invite === '') return true;
  if (!text(invite, 300)) return false;
  try {
    const link = new URL(invite);
    return ['http:', 'https:'].includes(link.protocol) && roomCode.test(link.searchParams.get('play') || '');
  } catch { return false; }
}

export function validScreenState(frame) {
  const { session, source, question, photoLength, revision, invite = '' } = frame || {};
  if (!integer(revision, 0, Number.MAX_SAFE_INTEGER) || !validInvite(invite) || !phases.includes(session?.phase) ||
      !text(source?.title, 80) || !Array.isArray(source.rounds) || !integer(source.rounds.length, 1, 3) ||
      !integer(session.roundIndex, 0, source.rounds.length - 1) ||
      !integer(photoLength, 0, maxPhotoLength)) return false;

  const players = session.players;
  if (!players || typeof players !== 'object' || Array.isArray(players) || Object.keys(players).length > 12 ||
      !Object.entries(players).every(([id, p]) => playerId.test(id) && text(p?.name, 25) &&
        Number.isSafeInteger(p.score))) return false;
  if (!Array.isArray(session.used) || session.used.length > 192 ||
      !session.used.every(id => typeof id === 'string' && questionId.test(id)) ||
      !Array.isArray(session.verdicts) || session.verdicts.length > 12 ||
      !session.verdicts.every(v => typeof v?.id === 'string' && own(players, v.id) &&
        text(v.answer, 180) && integer(v.wager, 0, Number.MAX_SAFE_INTEGER) && typeof v.correct === 'boolean') ||
      (session.answering !== null && (typeof session.answering !== 'string' || !own(players, session.answering))) ||
      typeof session.showHint !== 'boolean' || typeof session.opened !== 'boolean' ||
      !own(modes, session.mode) || (session.turn !== null && !own(players, session.turn))) return false;

  if (!source.rounds.every(round => text(round?.title, 48) && text(round.note, 160) &&
      Array.isArray(round.categories) && round.categories.length <= 8 &&
      round.categories.every(category => text(category?.title, 60) &&
        Array.isArray(category.questions) && category.questions.length <= 8 &&
        category.questions.every(q => typeof q?.id === 'string' && questionId.test(q.id) &&
          integer(q.value, 1, 9999) && typeof q.image === 'boolean')))) return false;
  if (source.final === null ? session.phase === 'final' :
      !text(source.final?.topic, 60) || !text(source.final.prompt, 1200) || !text(source.final.answer, 650) ||
      !picture(source.final.image) || !picture(source.final.answerImage) || !track(source.final.audio)) return false;
  if (!['question', 'reveal'].includes(session.phase)) return question === null && photoLength === 0;
  return typeof question?.id === 'string' && questionId.test(question.id) && text(question.category, 60) &&
    text(question.prompt, 1200) && text(question.answer, 650) && text(question.hint, 380) &&
    integer(question.value, 1, 9999) && ['normal', 'double', 'handoff', 'modifier'].includes(question.kind) &&
    picture(question.image) && picture(question.answerImage) && track(question.audio) && track(question.answerAudio) &&
    (photoLength === 0 || question.image === '');
}

export function screenPhotoChunk(photo, index) {
  if (!integer(index, 0, Math.ceil(photo.length / photoChunkSize) - 1)) return '';
  return photo.slice(index * photoChunkSize, (index + 1) * photoChunkSize);
}

export function validScreenPhoto(photo) {
  return photo.length <= maxPhotoLength && validPhoto.test(photo);
}
