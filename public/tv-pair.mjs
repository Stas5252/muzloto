import { connectRoom } from './quiz/relay.mjs?v=3';

// One TV for the whole evening: the TV shows a four-digit code, the host phone enters it once,
// and every game started from that phone tells the TV which screen to open.
const hostKey = 'party-tv-pin';
const site = new URL('./', import.meta.url);
const pages = { quiz: 'quiz/?tv=', music: 'music-screen.html?screen=' };
const validCode = code => /^[a-f0-9]{24}$/.test(code || '');
const pairRoom = pin => '7e1e' + pin.padStart(20, '0');

export const validPin = pin => /^\d{4}$/.test(pin || '');
export const siteLabel = () => (site.host + site.pathname).replace(/\/$/, '');
export const waitingUrl = pin => new URL('screen.html?pair=' + pin, site).href;

// TV side. `showing` is the game code on this screen, '' on the waiting page.
export function listenForHost(pin, showing = '') {
  if (!validPin(pin)) return null;
  const hello = () => link.send({ type: 'screen', event: 'pair-hello', showing });
  const link = connectRoom(pairRoom(pin), frame => {
    if (frame.type !== 'screen') return;
    if (frame.event === 'pair-show' && Object.hasOwn(pages, frame.game) && validCode(frame.code)) {
      if (frame.code === showing) hello();
      else location.replace(new URL(pages[frame.game] + frame.code + '&pair=' + pin, site));
    } else if (frame.event === 'pair-idle' && showing && frame.code === showing) location.replace(waitingUrl(pin));
    else if (frame.event === 'pair-ask') hello();
  }, hello);
  const timer = setInterval(hello, showing ? 12000 : 4000);
  hello();
  return { close() { clearInterval(timer); link.close(); } };
}

// Host side. `current()` returns { game, code } for the room on this page, or null.
// `changed(state, pin)` gets 'none', 'waiting' or 'attached'.
export function pairHost(current, changed = () => {}) {
  let pin = '';
  try { pin = localStorage.getItem(hostKey) || ''; } catch {}
  if (!validPin(pin)) pin = '';
  let link, seen = 0, state = '', announced = '', fresh = true;
  const report = () => {
    const next = !pin ? 'none' : Date.now() - seen < 30000 ? 'attached' : 'waiting';
    if (next !== state) changed(state = next, pin);
  };
  const send = event => {
    const target = current();
    if (link && target) link.send({ type: 'screen', event, game: target.game, code: target.code });
  };
  // A TV that already shows another room is taken over once per room, not on every reconnect.
  function offer() {
    const target = current();
    if (!link) return;
    if (target && announced !== target.code) {
      announced = target.code;
      send('pair-show');
    } else link.send({ type: 'screen', event: 'pair-ask' });
  }
  function open() {
    link?.close();
    link = null;
    seen = 0;
    announced = '';
    fresh = true;
    if (pin) {
      link = connectRoom(pairRoom(pin), frame => {
        if (frame.type !== 'screen' || frame.event !== 'pair-hello') return;
        const target = current();
        if (target && frame.showing === target.code) seen = Date.now();
        else if (target && !frame.showing) send('pair-show');
        else if (!target) seen = Date.now();
        report();
      }, links => {
        // The first offer may have left before any network link was up: repeat it once.
        if (links.length && fresh) {
          fresh = false;
          announced = '';
        }
        offer();
      });
      offer();
    }
    report();
  }
  const timer = setInterval(report, 5000);
  open();
  return {
    pin: () => pin,
    state: () => state,
    connect(next) {
      pin = validPin(next) ? next : '';
      try { pin ? localStorage.setItem(hostKey, pin) : localStorage.removeItem(hostKey); } catch {}
      open();
    },
    // Call when a room is created or reopened on this page.
    show() { announced = ''; seen = 0; offer(); report(); },
    // Call when the room with this TV code is closed.
    idle(code) { link?.send({ type: 'screen', event: 'pair-idle', code }); announced = ''; seen = 0; report(); },
    close() { clearInterval(timer); link?.close(); }
  };
}

export function rememberTv(pin) {
  try { localStorage.setItem(hostKey, pin); } catch {}
}

const sheet = `
.pair-dialog{border:0;border-radius:20px;padding:22px;width:min(92vw,380px);background:#16191c;color:#f4f6f3;font:inherit;box-shadow:0 30px 80px rgba(0,0,0,.6)}
.pair-dialog::backdrop{background:rgba(0,0,0,.72)}
.pair-dialog h2{margin:0 0 10px;font-size:1.35rem;line-height:1.15}
.pair-dialog ol{margin:0 0 14px;padding-left:20px;display:grid;gap:6px;font-size:.95rem;line-height:1.35;color:#c9cfc8}
.pair-dialog ol b{color:#f4f6f3;overflow-wrap:anywhere}
.pair-dialog input{width:100%;box-sizing:border-box;padding:12px;border-radius:14px;border:2px solid #3a4038;background:#0d0f10;color:#fff;
  font:800 2.2rem/1 ui-monospace,monospace;letter-spacing:.35em;text-align:center}
.pair-dialog input:focus{outline:0;border-color:#34e27a}
.pair-dialog p{min-height:1.3em;margin:8px 0 0;font-size:.88rem;color:#ffb4a8}
.pair-dialog div{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.pair-dialog button{flex:1 1 auto;min-height:46px;padding:10px 14px;border-radius:999px;border:1px solid #3a4038;background:transparent;color:inherit;font:700 .95rem/1 inherit;cursor:pointer}
.pair-dialog button[value=ok]{background:#34e27a;border-color:#34e27a;color:#08110b}`;

// Asks the host for the code shown on the TV. Resolves with the code, '' to forget the TV, or null.
export function askPin(currentPin = '') {
  if (!document.getElementById('pair-sheet')) {
    const style = document.createElement('style');
    style.id = 'pair-sheet';
    style.textContent = sheet;
    document.head.append(style);
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'pair-dialog';
  dialog.innerHTML = `<form method="dialog"><h2>Подключить ТВ</h2>
    <ol><li>На телевизоре или ноутбуке с проектором откройте <b></b></li><li>Нажмите «Это экран ТВ»</li><li>Введите код с экрана</li></ol>
    <input name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" aria-label="Код с экрана ТВ" placeholder="0000">
    <p role="alert"></p>
    <div><button value="ok">Подключить</button>${currentPin ? '<button value="forget" formnovalidate>Отключить ТВ</button>' : ''}<button value="cancel" formnovalidate>Отмена</button></div></form>`;
  dialog.querySelector('b').textContent = siteLabel();
  const input = dialog.querySelector('input');
  input.value = currentPin;
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); });
  document.body.append(dialog);
  return new Promise(resolve => {
    dialog.querySelector('form').addEventListener('submit', event => {
      if (event.submitter?.value === 'ok' && !validPin(input.value)) {
        event.preventDefault();
        dialog.querySelector('p').textContent = 'Код состоит из четырёх цифр.';
      }
    });
    dialog.addEventListener('close', () => {
      const answer = dialog.returnValue;
      dialog.remove();
      resolve(answer === 'ok' ? input.value : answer === 'forget' ? '' : null);
    });
    dialog.showModal();
    input.focus();
  });
}
