const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const site = process.env.MUZLOTO_AUDIT_SITE || 'http://localhost:3000/';
const chrome = process.env.MUZLOTO_CHROME || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const fixture = 'https://audio.example.test/track-';
const sourcePattern = /^https:\/\/audio\.example\.test\/track-\d+\.wav$/;

function testAudio() {
  const samples = 8000 * 65;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  return wav;
}

async function run() {
  const browser = await chromium.launch({ executablePath: chrome });
  const errors = [];
  const body = testAudio();
  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

  async function open(options, url) {
    const context = await browser.newContext(options);
    await context.route(sourcePattern, route => {
      const headers = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' };
      const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
      if (!range) return route.fulfill({ body, contentType: 'audio/wav', headers });
      const start = Number(range[1]);
      const end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
      headers['Content-Range'] = `bytes ${start}-${end}/${body.length}`;
      return route.fulfill({ status: 206, body: body.subarray(start, end + 1), contentType: 'audio/wav', headers });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(18000);
    page.on('pageerror', error => errors.push(error.message));
    if (url) await page.goto(String(url), { waitUntil: 'domcontentloaded' });
    return page;
  }

  try {
    const host = await open(mobile, new URL('tv.html', site));
    await host.evaluate(source => {
      setTracks(Array.from({ length: 9 }, (_, i) => ({
        id: 'fixture_' + i, artist: 'Проверка', title: 'My Heart Will Go On (Love Theme from “Titanic”) ' + (i + 1), preview: source + i + '.wav'
      })));
    }, fixture);
    await host.locator('#opt-mode').selectOption('line');
    await host.locator('#btn-create-room').click();
    await host.locator('#sec-lobby').waitFor();
    const code = (await host.locator('#lobby-room-code').textContent()).trim();
    const link = await host.locator('#open-tv-screen').getAttribute('href');
    const tv = await open({ viewport: { width: 1280, height: 720 } }, link);
    await tv.waitForFunction(room => document.querySelector('#music-code').textContent === room, code);
    await tv.locator('#lobby-qr-container canvas').waitFor({ state: 'attached' });
    const player = await open(mobile, new URL('play.html?room=' + code, site));
    await player.locator('#input-name').fill('Игрок ТВ');
    await player.locator('#btn-join').click();
    await player.locator('#sec-play').waitFor();
    await tv.getByText('Игрок ТВ', { exact: true }).waitFor();
    assert.equal(await tv.getByRole('button', { name: 'Следующий бочонок' }).count(), 0);
    console.log('PASS separate TV connects to the phone and shows the lobby and the player');

    await host.waitForFunction(() => /Включить звук на ТВ/.test(document.querySelector('#tv-output-status').textContent));
    await tv.locator('#music-enable').click();
    await host.waitForFunction(() => document.querySelector('#tv-output-status').textContent === 'ТВ подключён');
    console.log('PASS the phone says that the sound on the TV is still off');
    await host.locator('#btn-start-game').click();
    await host.locator('#chk-auto-next').uncheck();
    await tv.getByText('Ход 1', { exact: true }).waitFor();
    await tv.waitForFunction(() => {
      const audio = document.querySelector('#music-audio');
      return !audio.paused && audio.currentTime > 0.2 && audio.src.includes('audio.example.test');
    });
    await host.waitForFunction(() => document.querySelector('#main-audio').muted);
    await host.locator('#btn-pause-keg').click();
    await tv.waitForFunction(() => document.querySelector('#music-audio').paused);
    await host.locator('#btn-seek-forward').click();
    await host.waitForFunction(() => document.querySelector('#main-audio').currentTime >= 10);
    await tv.waitForFunction(() => document.querySelector('#music-audio').currentTime >= 10);
    await host.locator('#btn-seek-back').click();
    await tv.waitForFunction(() => document.querySelector('#music-audio').currentTime < 3);
    await host.locator('#btn-pause-keg').click();
    await tv.waitForFunction(() => !document.querySelector('#music-audio').paused);
    await host.locator('#btn-replay-keg').click();
    await tv.waitForFunction(() => document.querySelector('#music-audio').currentTime < 2);
    console.log('PASS TV audio, phone mute, pause, replay, resume and seeking');

    await tv.reload({ waitUntil: 'domcontentloaded' });
    await tv.getByText('Ход 1', { exact: true }).waitFor();
    await tv.locator('#music-enable').click();
    await tv.waitForFunction(() => !document.querySelector('#music-audio').paused);
    await host.reload({ waitUntil: 'domcontentloaded' });
    await host.locator('#sec-game').waitFor();
    assert.equal(await host.locator('#open-tv-screen').getAttribute('href'), link);
    let won = false;
    for (let turn = 1; turn <= 9; turn++) {
      await player.waitForFunction(expected => calledTrackIds.size === expected, turn);
      await tv.getByText('Ход ' + turn, { exact: true }).waitFor();
      assert.equal(await tv.locator('#music-history .board-keg-item').count(), turn);
      assert.ok(await tv.evaluate(() => document.documentElement.scrollHeight) <= 720, 'A long title leaves the drawn kegs on a 720p TV');
      assert.equal(await tv.locator('#lotto-keg-number').textContent(), await host.locator('#lotto-keg-number').textContent());
      await player.locator('.bingo-cell').evaluateAll(cells => {
        for (const cell of cells) if (!cell.classList.contains('marked') && calledTrackIds.has(cell.dataset.id)) cell.click();
      });
      if (await player.locator('#btn-bingo').isEnabled()) {
        await player.locator('#btn-bingo').click();
        await tv.getByText('Победитель: Игрок ТВ', { exact: true }).waitFor();
        assert.ok(await tv.locator('#music-winning-card .win-highlight').count() >= 3);
        assert.ok(await tv.evaluate(() => document.documentElement.scrollHeight) <= 720, 'Bingo fits a 720p TV');
        await tv.waitForFunction(() => document.querySelector('#music-audio').paused);
        won = true;
        break;
      }
      await host.waitForFunction(() => document.querySelector('#main-audio').muted);
      const previous = await tv.evaluate(() => document.querySelector('#music-audio').src);
      await host.evaluate(() => {
        window.audibleOnPhone = 0;
        window.phoneProbe = setInterval(() => {
          const audio = document.querySelector('#main-audio');
          if (!audio.paused && !audio.muted) window.audibleOnPhone++;
        }, 20);
      });
      await host.locator('#btn-next-keg').click();
      await tv.waitForFunction(src => {
        const audio = document.querySelector('#music-audio');
        return audio.src !== src && !audio.paused && audio.currentTime > 0.2;
      }, previous);
      assert.equal(await host.evaluate(() => {
        clearInterval(window.phoneProbe);
        return window.audibleOnPhone;
      }), 0, 'The phone stays silent while the TV loads the next track');
    }
    assert.ok(won, 'The detached TV shows the confirmed winner');
    assert.deepEqual(errors, []);
    console.log('PASS TV and host reconnect, silent phone on track change, track history, Bingo and winning card');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
