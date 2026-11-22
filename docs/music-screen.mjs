import { connectRoom, validRoom } from './quiz/relay.mjs?v=3';

const eventType = 'screen';
const handoverLimit = 4000;
const silence = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA';
const $ = id => document.getElementById(id);
const clip = (value, limit = 160) => String(value ?? '').slice(0, limit);
const finite = value => Number.isFinite(value) ? Math.max(0, value) : 0;

export function assetUrl(value, base = location.href) {
  if (!value || typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === new URL(base).origin)
      ? url.href : '';
  } catch { return ''; }
}

export function openMusicScreen(code, capture, setOutput) {
  let lastRequest = 0;
  let lastReply = 0;
  let lastReady = 0;
  let readyTrack = '';
  let tvSound = false;
  let waitingSince = 0;
  let lastLayout = '';
  let layoutRevision = 0;
  let sequence = Date.now() * 1000;
  const link = connectRoom(code, frame => {
    if (frame.type !== eventType) return;
    if (frame.event === 'music-request') {
      lastRequest = Date.now();
      if (lastRequest - lastReply > 100) {
        lastReply = lastRequest;
        send(frame.full === true);
      }
    } else if (frame.event === 'music-ready' && typeof frame.track === 'string') {
      readyTrack = frame.track;
      lastReady = Date.now();
    }
  }, () => send(true));

  function send(force = false) {
    const attached = Date.now() - lastRequest < 6500;
    if (!attached) {
      tvSound = false;
      waitingSince = 0;
      setOutput(false, false);
      return;
    }
    const { layout, playback } = capture();
    const now = Date.now();
    const onTv = playback.url && playback.key === readyTrack && now - lastReady < 2000;
    if (onTv) {
      tvSound = true;
      waitingSince = 0;
    } else if (!tvSound || !playback.url || !playback.playing) {
      waitingSince = 0;
    } else {
      // The TV had the sound: keep the phone silent while it loads the next track.
      waitingSince ||= now;
      if (now - waitingSince > handoverLimit) tvSound = false;
    }
    setOutput(Boolean(playback.url && tvSound), true);
    const serialized = JSON.stringify(layout);
    const changed = serialized !== lastLayout;
    if (changed) {
      lastLayout = serialized;
      layoutRevision++;
    }
    sequence = Math.max(sequence + 1, Date.now() * 1000);
    link.send({ type: eventType, event: 'music-state', sequence, layoutRevision,
      layout: changed || force ? layout : null, playback });
  }

  const timer = setInterval(send, 450);
  return {
    close() {
      clearInterval(timer);
      link.send({ type: eventType, event: 'music-closed' });
      setOutput(false, false);
      setTimeout(() => link.close(), 300);
    }
  };
}

function node(tag, className, text = '') {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function album(url, className) {
  const img = node('img', className);
  img.alt = '';
  const src = assetUrl(url);
  if (src) img.src = src;
  return img;
}

function validTrack(track) {
  return track && Number.isSafeInteger(track.keg) && track.keg > 0 &&
    typeof track.title === 'string' && typeof track.artist === 'string';
}

function paint(layout) {
  const lobby = layout.phase === 'lobby';
  $('music-waiting').hidden = true;
  $('music-lobby').hidden = !lobby;
  $('music-stage').hidden = lobby;
  $('music-winner').style.display = layout.phase === 'winner' ? 'flex' : 'none';
  if (lobby) {
    $('music-code').textContent = clip(layout.code, 4);
    const qr = $('lobby-qr-container');
    const invite = assetUrl(layout.invite);
    if (invite && qr.dataset.link !== invite) {
      qr.replaceChildren();
      if (window.QRCode) new QRCode(qr, { text: invite, width: 224, height: 224 });
      qr.dataset.link = invite;
      $('music-join').textContent = invite.replace(/^https?:\/\//, '');
    }
    const players = (Array.isArray(layout.players) ? layout.players : []).slice(0, 200);
    $('music-player-count').textContent = players.length;
    $('music-players').replaceChildren(...players.map(name => {
      const pill = node('span', 'player-pill');
      pill.append(node('span', 'p-dot'), node('span', '', clip(name, 48)));
      return pill;
    }));
    return;
  }

  const track = validTrack(layout.track) ? layout.track : null;
  $('music-turn').textContent = 'Ход ' + finite(layout.turn);
  $('music-remaining').textContent = 'В мешке: ' + finite(layout.remaining) + ' бочонков';
  $('lotto-keg-number').textContent = track?.keg ?? '?';
  $('music-track-artist').textContent = track ? clip(track.artist) : '';
  $('music-track-title').textContent = track ? clip(track.title) :
    layout.phase === 'ended' ? 'Все бочонки раунда сыграли!' : 'Готовим следующий трек';
  const cover = $('tv-stage-cover');
  const src = assetUrl(track?.art);
  if (cover.getAttribute('src') !== (src || null)) {
    if (src) cover.src = src; else cover.removeAttribute('src');
  }
  cover.hidden = !src;
  $('music-placeholder').hidden = Boolean(src);

  const history = (Array.isArray(layout.history) ? layout.history : []).filter(validTrack);
  $('music-history-count').textContent = finite(layout.turn);
  $('music-history').replaceChildren(...history.map((item, index) => {
    const cell = node('div', 'board-keg-item' + (index === 0 ? ' fresh' : ''));
    const content = node('div', 'board-keg-left');
    const label = node('span', 'board-keg-number', '№' + item.keg);
    const info = node('div', 'board-keg-track-info');
    info.append(node('span', 'board-keg-artist', clip(item.artist)), node('span', 'board-keg-title', clip(item.title)));
    content.append(label);
    if (item.art) content.append(album(item.art, 'board-keg-cover'));
    content.append(info);
    cell.append(content);
    return cell;
  }));
  if (layout.phase !== 'winner') return;
  $('music-winner-name').textContent = 'Победитель: ' + clip(layout.winner, 48);
  const cards = (Array.isArray(layout.cards) ? layout.cards : []).slice(0, 16);
  const grid = $('music-winning-card');
  grid.className = 'card-showcase-grid size-' + (cards.length === 16 ? '4' : '3');
  grid.replaceChildren(...cards.filter(validTrack).map(card => {
    const cell = node('div', 'card-showcase-cell' + (card.winning === true ? ' win-highlight' : ''));
    const cover = node('div', 'showcase-cover-wrap');
    if (assetUrl(card.art)) cover.append(album(card.art, 'showcase-cover-img'));
    cover.append(node('div', 'showcase-cover-gradient'));
    const head = node('div', 'music-card-head');
    head.append(node('span', 'keg-number-badge', '№ ' + card.keg));
    if (card.winning === true) head.append(node('span', 'music-card-mark', '✓'));
    const text = node('div', 'music-card-text');
    text.append(node('span', 'music-card-artist', clip(card.artist)), node('strong', 'music-card-title', clip(card.title)));
    const info = node('div', 'showcase-content');
    info.append(head, text);
    cell.append(cover, info);
    return cell;
  }));
}

function startViewer(code) {
  const audio = $('music-audio');
  const enable = $('music-enable');
  const status = $('music-status');
  let source = '';
  let track = '';
  let playback;
  let enabled = false;
  let confirmedTrack = '';
  let mediaProblem = '';
  let attempt;
  let layoutRevision = -1;
  let sequence = 0;
  let lastSeen = 0;
  let stopped = false;
  let link;
  link = connectRoom(code, receive, () => request(true));

  function request(full = false) {
    link?.send({ type: eventType, event: 'music-request', full });
  }

  function ready() {
    if (!stopped && enabled && track && track === confirmedTrack && audio.readyState >= 2) {
      link.send({ type: eventType, event: 'music-ready', track });
    }
  }

  function time(value) {
    const seconds = Math.floor(finite(value));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }

  function play() {
    if (attempt || !audio.paused) return;
    const attemptTrack = track;
    attempt = audio.play().catch(error => {
      if (track !== attemptTrack || error.name === 'AbortError') return;
      enabled = false;
      enable.hidden = false;
      mediaProblem = error.name === 'NotAllowedError'
        ? 'Нажмите «Включить звук на ТВ»' : 'Не удалось загрузить трек на ТВ';
      status.textContent = mediaProblem;
    }).finally(() => { attempt = null; });
  }

  function syncAudio() {
    if (!playback) return;
    const url = assetUrl(playback.url);
    if (url !== source) {
      source = url;
      confirmedTrack = '';
      mediaProblem = '';
      if (url) audio.src = url;
      else {
        audio.removeAttribute('src');
        audio.load();
      }
    }
    track = clip(playback.key, 120);
    const position = finite(playback.position);
    const duration = finite(playback.duration);
    const progress = $('music-progress');
    progress.max = duration || 30;
    progress.value = position;
    progress.style.setProperty('--track-position', (duration ? Math.min(position / duration, 1) * 100 : 0) + '%');
    $('music-elapsed').textContent = time(position);
    $('music-duration').textContent = time(duration);
    $('equalizer-wave').classList.toggle('active', playback.playing === true);
    status.textContent = playback.local === true ? 'Звук этого трека играет с телефона ведущего' :
      mediaProblem || 'Связь с ведущим';

    if (url && audio.readyState >= 1 && Math.abs(audio.currentTime - position) > (playback.playing ? 0.75 : 0.08)) {
      audio.currentTime = Math.min(position, Number.isFinite(audio.duration) ? audio.duration : position);
    }
    if (url && playback.playing === true && enabled) play();
    else audio.pause();
  }

  function receive(frame) {
    if (stopped || frame.type !== eventType) return;
    if (frame.event === 'music-closed') {
      stopped = true;
      clearInterval(timer);
      audio.pause();
      link.close();
      status.textContent = 'Комната закрыта';
      $('music-winner').style.display = 'none';
      $('music-stage').hidden = $('music-lobby').hidden = true;
      $('music-waiting').hidden = false;
      $('music-waiting').textContent = 'Комната закрыта';
      enable.hidden = true;
      return;
    }
    if (frame.event !== 'music-state' || !Number.isSafeInteger(frame.sequence) || frame.sequence <= sequence ||
        !Number.isSafeInteger(frame.layoutRevision) || !frame.playback ||
        typeof frame.playback !== 'object') return;
    sequence = frame.sequence;
    lastSeen = Date.now();
    if (frame.layout && typeof frame.layout === 'object' && ['lobby', 'playing', 'winner', 'ended'].includes(frame.layout.phase)) {
      paint(frame.layout);
      layoutRevision = frame.layoutRevision;
    }
    if (!frame.layout && frame.layoutRevision !== layoutRevision) request(true);
    playback = frame.playback;
    syncAudio();
  }

  enable.onclick = () => {
    enabled = true;
    enable.hidden = true;
    mediaProblem = '';
    if (source && audio.error) audio.load();
    if (!source) {
      // Unlock the same media element during the TV button press, even from the lobby.
      audio.src = silence;
      audio.play().catch(() => {});
    } else if (playback?.playing === true) {
      syncAudio();
    } else {
      audio.play().then(() => { if (!playback?.playing) audio.pause(); }).catch(() => {});
    }
  };
  audio.addEventListener('loadedmetadata', syncAudio);
  audio.addEventListener('playing', () => {
    if (source && audio.getAttribute('src') === source) {
      confirmedTrack = track;
      mediaProblem = '';
      ready();
    }
  });
  audio.addEventListener('error', () => {
    if (!source) return;
    enable.hidden = false;
    mediaProblem = 'Не удалось загрузить трек на ТВ';
    status.textContent = mediaProblem;
  });
  const timer = setInterval(() => {
    request(layoutRevision < 0);
    if (lastSeen && Date.now() - lastSeen > 6000) {
      audio.pause();
      status.textContent = 'Ждём ведущего';
    } else ready();
  }, 1100);
  request(true);
}

const code = new URLSearchParams(location.search).get('screen');
if ($('music-waiting')) {
  if (validRoom(code)) startViewer(code);
  else {
    $('music-waiting').textContent = 'Откройте ссылку ТВ из комнаты ведущего.';
    $('music-enable').hidden = true;
  }
}
