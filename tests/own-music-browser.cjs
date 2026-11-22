// "Своя музыка" end to end in the browser: the owner uploads a pack from a phone, the host plays it with
// full recordings on a separate TV. The cloud is the real function code over an in-memory bucket.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');
const memoryBucket = require('./own-music-bucket.cjs');

const site = process.env.MUZLOTO_AUDIT_SITE || 'http://localhost:3000/';
const chrome = process.env.MUZLOTO_CHROME || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const password = 'пароль вечеринки 2026';
const cover = 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/cover.jpg/100x100bb.jpg';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

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

// ID3v2.3 header with the artist in Windows-1251 and the title in UTF-16, as old and new taggers write them.
function tagged(body) {
  const frame = (id, encoding, bytes) => {
    const head = Buffer.alloc(10);
    head.write(id);
    head.writeUInt32BE(bytes.length + 1, 4);
    return Buffer.concat([head, Buffer.from([encoding]), bytes]);
  };
  const frames = Buffer.concat([
    frame('TPE1', 0, Buffer.from([0xd2, 0xe8, 0xec, 0xe0, 0xf2, 0xe8])),
    frame('TIT2', 1, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Мага', 'utf16le')]))
  ]);
  const head = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, frames.length >> 7 & 127, frames.length & 127]);
  return Buffer.concat([head, frames, body]);
}

async function run() {
  const { handle } = await import('../supabase/functions/muzloto-own-music/music.ts');
  const bucket = memoryBucket();
  const browser = await chromium.launch({ executablePath: chrome, ignoreDefaultArgs: ['--hide-scrollbars'] });
  const errors = [];
  const body = testAudio();
  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  let failUploads = 0;
  let uploads = 0;

  async function open(options, url) {
    const context = await browser.newContext(options);
    await context.route('**/functions/v1/muzloto-game-audio', route =>
      route.fulfill({ json: { tracks: [], expiresIn: 7200 }, headers: cors }));
    await context.route('**/functions/v1/muzloto-own-music', async route => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const response = await handle(new Request(request.url(), {
        method: request.method(), headers: request.headers(), body: request.postDataBuffer() || undefined
      }), bucket, password);
      return route.fulfill({ status: response.status, body: await response.text(), contentType: 'application/json', headers: cors });
    });
    await context.route('https://storage.test/upload/**', route => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (failUploads-- > 0) return route.fulfill({ status: 500, headers: cors });
      assert.equal(request.method(), 'PUT');
      uploads++;
      bucket.files.set(new URL(request.url()).pathname.slice('/upload/'.length), request.postDataBuffer());
      return route.fulfill({ status: 200, json: { Key: 'ok' }, headers: cors });
    });
    await context.route('https://storage.test/sign/**', route => {
      const stored = bucket.files.get(new URL(route.request().url()).pathname.slice('/sign/'.length));
      if (!stored) return route.fulfill({ status: 404, headers: cors });
      const headers = { ...cors, 'Accept-Ranges': 'bytes' };
      const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
      if (!range) return route.fulfill({ body, contentType: 'audio/wav', headers });
      const start = Number(range[1]);
      const end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
      headers['Content-Range'] = `bytes ${start}-${end}/${body.length}`;
      return route.fulfill({ status: 206, body: body.subarray(start, end + 1), contentType: 'audio/wav', headers });
    });
    await context.route('https://itunes.apple.com/search**', route =>
      route.fulfill({ json: { results: [{ artworkUrl100: cover }] }, headers: cors }));
    await context.route('https://is1-ssl.mzstatic.com/**', route => route.fulfill({ body: pixel, contentType: 'image/png', headers: cors }));
    const page = await context.newPage();
    page.setDefaultTimeout(18000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    if (url) await page.goto(String(url), { waitUntil: 'domcontentloaded' });
    return page;
  }

  try {
    const owner = await open(mobile, new URL('own-music.html', site));
    await owner.locator('#login').waitFor();
    await owner.locator('#password').fill('wrong-password');
    await owner.getByRole('button', { name: 'Войти' }).click();
    await owner.getByText('Пароль не подошёл.').waitFor();
    assert.ok(await owner.locator('#library').isHidden());
    await owner.locator('#password').fill(password);
    await owner.getByRole('button', { name: 'Войти' }).click();
    await owner.getByText('Пока нет ни одного пака').waitFor();
    console.log('PASS a wrong password is refused, the right one opens the empty library');

    await owner.locator('#new-pack').click();
    const files = Array.from({ length: 16 }, (_, i) => ({
      name: i ? `${String(i).padStart(2, '0')}. Егор Крид - Песня ${i}.mp3` : 'track_final.mp3',
      mimeType: 'audio/mpeg', buffer: i ? body : tagged(body)
    }));
    await owner.locator('#files').setInputFiles([...files, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]);
    await owner.getByText('Треков: 16').waitFor();
    await owner.getByText('«notes.txt»: нужен MP3 или M4A').waitFor();
    const fields = owner.locator('#tracks li').first().locator('input');
    assert.deepEqual([await fields.nth(0).inputValue(), await fields.nth(1).inputValue()], ['Тимати', 'Мага'], 'Tags are read from the file');
    const named = owner.locator('#tracks li').nth(3).locator('input');
    assert.deepEqual([await named.nth(0).inputValue(), await named.nth(1).inputValue()], ['Егор Крид', 'Песня 3']);
    await owner.waitForFunction(() => document.querySelectorAll('#tracks img.own-cover').length === 16);
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth) <= 390, 'The editor fits a phone');
    await owner.locator('#tracks li').nth(1).getByLabel('Слушать').click();
    await owner.locator('#tracks li').nth(1).getByText('❚❚').waitFor();
    await owner.locator('#tracks li').nth(1).getByLabel('Слушать').click();
    console.log('PASS files are added with artist, title and cover; other files are refused');

    await owner.locator('#save').click();
    await owner.getByText('Дайте паку название.').waitFor();
    await owner.locator('#pack-title').fill('Мой плейлист: лето (2026)');
    failUploads = 2;
    await owner.locator('#save').click();
    await owner.getByText('Не загрузились треки: 2.').waitFor();
    assert.ok(!bucket.files.has('own/index.json'), 'A pack with missing recordings is not saved');
    await owner.locator('#save').click();
    await owner.getByText('Пак сохранён: 16 треков.').waitFor();
    assert.equal(uploads, 16, 'A retry uploads only the recordings that failed');
    const saved = JSON.parse(bucket.files.get('own/index.json')).packs[0];
    assert.equal(saved.tracks.length, 16);
    assert.equal(saved.tracks[0].art, cover.replace('100x100bb', '400x400bb'));
    console.log('PASS failed uploads are retried, then the pack is saved to the cloud');

    await owner.reload({ waitUntil: 'domcontentloaded' });
    await owner.getByText('Мой плейлист: лето (2026)').waitFor();
    const host = await open(mobile, new URL(await owner.getByRole('link', { name: 'Играть' }).getAttribute('href'), owner.url()));
    await host.locator('.pack-card.active strong').filter({ hasText: 'Мой плейлист: лето (2026)' }).waitFor();
    await host.waitForFunction(() => document.querySelector('#tracks-count').textContent === '16');
    await host.getByText('Музыка в облаке: 16/', { exact: false }).waitFor();
    await host.locator('#opt-size').selectOption('4');
    await host.locator('#opt-mode').selectOption('line');
    await host.locator('#btn-create-room').click();
    await host.locator('#sec-lobby').waitFor();
    const code = (await host.locator('#lobby-room-code').textContent()).trim();
    const tv = await open({ viewport: { width: 1280, height: 720 } }, await host.locator('#open-tv-screen').getAttribute('href'));
    await tv.waitForFunction(room => document.querySelector('#music-code').textContent === room, code);
    const player = await open(mobile, new URL('play.html?room=' + code, site));
    await player.locator('#input-name').fill('Игрок');
    await player.locator('#btn-join').click();
    await player.locator('#sec-play').waitFor();
    assert.equal(await player.locator('.bingo-cell').count(), 16);
    await tv.locator('#music-enable').click();
    await host.waitForFunction(() => document.querySelector('#tv-output-status').textContent === 'ТВ подключён');
    await host.locator('#btn-start-game').click();
    await host.locator('#chk-auto-next').uncheck();
    await tv.getByText('Ход 1', { exact: true }).waitFor();
    const plays = () => tv.waitForFunction(() => {
      const audio = document.querySelector('#music-audio');
      return !audio.paused && audio.currentTime > 0.2 && audio.src.startsWith('https://storage.test/sign/own/');
    });
    await plays();
    await host.locator('#btn-play-full-track').waitFor();
    assert.ok(await host.locator('#btn-play-full-track').isEnabled(), 'An own track is a full recording, not a preview');
    console.log('PASS the own pack is picked from the owner page, 4×4 cards, the TV plays the uploaded recording');

    await host.reload({ waitUntil: 'domcontentloaded' });
    await host.locator('#sec-game').waitFor();
    await host.waitForFunction(() => !document.querySelector('#btn-next-keg').disabled);
    await host.locator('#btn-next-keg').click();
    await tv.getByText('Ход 2', { exact: true }).waitFor();
    await plays();
    await tv.reload({ waitUntil: 'domcontentloaded' });
    await tv.getByText('Ход 2', { exact: true }).waitFor();
    await tv.locator('#music-enable').click();
    await plays();
    assert.ok(await player.evaluate(() => calledTrackIds.size) === 2);
    console.log('PASS the phone and the TV keep playing the own pack after a reload');

    await owner.getByRole('button', { name: 'Изменить' }).click();
    await owner.locator('#tracks li').first().getByLabel('Убрать трек').click();
    await owner.locator('#save').click();
    await owner.getByText('Пак сохранён: 15 треков.').waitFor();
    await owner.getByText('Для карточек 4×4 нужно 16 треков.').waitFor();
    assert.equal([...bucket.files.keys()].filter(name => name.endsWith('.mp3')).length, 15);
    await owner.getByRole('button', { name: 'Удалить' }).click();
    await owner.getByText('Пак удалён.').waitFor();
    assert.deepEqual([...bucket.files.keys()], ['own/index.json']);
    const later = await open(mobile, new URL('tv.html', site));
    await later.locator('.pack-card').first().waitFor();
    await later.getByText(/Музыка в облаке|В облаке нет записей/).waitFor();
    assert.equal(await later.getByText('Мой плейлист').count(), 0);
    await owner.locator('#logout').click();
    await owner.reload({ waitUntil: 'domcontentloaded' });
    await owner.locator('#login').waitFor();
    console.log('PASS a track is removed, the pack is deleted with its recordings, the owner logs out');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exit(1); });
