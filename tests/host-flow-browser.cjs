// One evening on one TV: the host phone creates, replays and ends both games; players use their own phones.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const site = process.env.MUZLOTO_AUDIT_SITE || 'http://localhost:3000/';
const chrome = process.env.MUZLOTO_CHROME || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const wide = { viewport: { width: 1280, height: 720 } };
const tracks = count => `setTracks(Array.from({ length: ${count} }, (_, i) => ({ id: 'fx_' + i, artist: 'Проверка',
  title: 'Трек ' + (i + 1), preview: 'https://audio.example.test/track-' + i + '.wav' })))`;
const cells = count => `document.querySelectorAll('#sec-play [data-id]').length === ${count}`;

async function run() {
  const browser = await chromium.launch({ executablePath: chrome });
  const errors = [];
  const watch = page => {
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    return page;
  };
  const open = async (url, options = mobile) => {
    const page = watch(await (await browser.newContext(options)).newPage());
    await page.goto(url);
    return page;
  };
  const enterCode = async (page, pin) => {
    await page.locator('.pair-dialog input').fill(pin);
    await page.locator('.pair-dialog button[value=ok]').click();
  };

  try {
    const tv = await open(site, wide);
    await tv.locator('a.tv-entry').click();
    await tv.locator('#pair-code', { hasText: /^\d{4}$/ }).waitFor();
    const pin = (await tv.locator('#pair-code').textContent()).trim();
    assert.match(pin, /^\d{4}$/);
    assert.ok(tv.url().endsWith('screen.html?pair=' + pin));
    await tv.locator('#pair-qr img, #pair-qr canvas').first().waitFor({ state: 'attached' });

    // Quiz: the pack is chosen before the room, the TV is attached by its code.
    const host = await open(site + 'quiz/');
    await host.locator('.pack-card').nth(3).click();
    const firstPack = await host.locator('.picked-pack strong').innerText();
    await host.locator('.pack-go button').click();
    await host.locator('.steps').waitFor();
    assert.equal(await host.locator('.room-bar strong').innerText(), firstPack);
    assert.equal(await host.locator('.steps li.done').count(), 0);
    await host.getByRole('button', { name: 'Подключить ТВ' }).click();
    await enterCode(host, pin);
    await tv.waitForURL(/quiz\/\?tv=[a-f0-9]{24}&pair=\d{4}/);
    await host.getByRole('button', { name: 'ТВ подключён ✓' }).waitFor();
    const quizTv = tv.url();
    const invite = await host.getByRole('link', { name: /Открыть игрока/ }).getAttribute('href');
    const enter = async name => {
      const page = await open(invite);
      await page.getByRole('textbox', { name: 'Имя на табло' }).fill(name);
      await page.getByRole('button', { name: 'Войти' }).click();
      return page;
    };
    const anya = await enter('Аня');
    const boris = await enter('Борис');
    await host.getByText('2/12', { exact: true }).waitFor();
    assert.equal(await host.locator('.steps li.done').count(), 2, 'The lobby ticks off the TV and the players');
    console.log('PASS quiz lobby: chosen pack, TV attached by code, steps ticked off');

    const answer = async player => {
      await host.locator('[data-action="pick"]').first().click();
      await host.getByRole('button', { name: /Принимать ответы/ }).click();
      await player.locator('.buzzer').tap();
      await host.locator('[data-verdict="correct"]').first().click();
    };
    await host.getByRole('button', { name: 'Начать игру' }).click();
    await answer(anya);
    await host.getByRole('button', { name: 'К табло' }).click();
    for (let step = 0; step < 7; step++) {
      // «Играть её» skips striking the final themes out one by one.
      const next = host.locator('[data-action="next-round"], [data-action="final"], [data-action="start-round"], [data-action="final-topic"], [data-action="finish"]').first();
      await next.waitFor();
      const type = await next.getAttribute('data-action');
      await next.click();
      if (type === 'finish') break;
      await host.waitForTimeout(250);
    }
    await host.locator('.again').waitFor();
    const late = await enter('Вика');
    await late.getByText('Эта игра уже закончилась').waitFor();
    const nextPack = await host.locator('#again-pack').evaluate(select => select.selectedOptions[0].textContent);
    assert.notEqual(nextPack, firstPack, 'Another pack is offered for the next game');
    await host.getByRole('button', { name: 'Сыграть ещё' }).click();
    await host.getByText('3/12', { exact: true }).waitFor();
    assert.equal(await host.locator('.room-bar strong').innerText(), nextPack);
    for (const page of [anya, boris, late]) await page.getByRole('heading', { name: 'Ты в игре' }).waitFor();
    assert.equal(tv.url(), quizTv, 'The TV stays on the same screen');
    await tv.getByText(nextPack).first().waitFor();
    await host.getByRole('button', { name: 'Начать игру' }).click();
    await answer(boris);
    const scores = (await host.locator('.score-panel').innerText()).replace(/\n+/g, ' ');
    assert.ok(/Борис\s*[1-9]/.test(scores) && !/Аня\s*[1-9]/.test(scores), 'The next game starts from zero: ' + scores);
    console.log('PASS quiz «Сыграть ещё»: same room and TV, players stayed, a late player joined, clean score');

    await host.reload();
    await host.locator('.room-bar').waitFor();
    assert.equal(await host.locator('.room-bar strong').innerText(), nextPack);
    await host.goto(site);
    await host.locator('#live-quiz', { hasText: 'Игра идёт' }).waitFor();
    await host.goto(site + 'quiz/');
    assert.match(await host.locator('.saved-room').innerText(), new RegExp('Игра идёт: .*раунд 1 · 3 игрока'));
    await host.getByRole('link', { name: 'Продолжить игру' }).click();
    await host.locator('.room-menu summary').click();
    await host.getByRole('button', { name: 'Закрыть комнату' }).click();
    for (const page of [anya, boris]) await page.getByRole('heading', { name: 'Комната закрыта' }).waitFor();
    await tv.waitForURL(/screen\.html\?pair=\d{4}/);
    assert.equal((await tv.locator('#pair-code').textContent()).trim(), pin);
    await host.goto(site);
    await host.getByRole('heading', { name: 'Во что играем?' }).waitFor();
    assert.equal(await host.locator('#live-quiz', { hasText: 'Игра идёт' }).count(), 0);
    console.log('PASS quiz: reload and menus offer to continue; closing tells the players and frees the TV');

    // MuzLoto on the same phone: the TV code is remembered.
    await host.goto(site + 'tv.html');
    await host.waitForFunction(() => typeof setTracks === 'function');
    await host.waitForTimeout(800);
    await host.evaluate(tracks(9));
    await host.locator('#btn-create-room').click();
    await host.locator('#sec-lobby').waitFor();
    const code = (await host.locator('#lobby-room-code').textContent()).trim();
    await tv.waitForURL(/music-screen\.html\?screen=[a-f0-9]{24}&pair=\d{4}/);
    await tv.waitForFunction(room => document.querySelector('#music-code')?.textContent === room, code);
    await host.locator('#btn-pair-tv', { hasText: 'ТВ подключён ✓' }).waitFor();
    await host.locator('#step-tv.done').waitFor();
    const seat = async name => {
      const page = await open(site + 'play.html?room=' + code);
      await page.locator('#input-name').fill(name);
      await page.locator('#btn-join').click();
      await page.locator('#sec-play').waitFor({ state: 'visible' });
      return page;
    };
    const guests = [await seat('Аня'), await seat('Борис')];
    await host.locator('#lobby-players-count', { hasText: '2' }).waitFor();
    await host.locator('#step-players.done').waitFor();
    await host.locator('#btn-back-setup').click();
    assert.match(await host.locator('#btn-create-room').innerText(), /Сохранить настройки/);
    await host.evaluate(tracks(20));
    await host.locator('#opt-size').selectOption('4');
    await host.locator('#btn-create-room').click();
    await host.locator('#sec-lobby').waitFor({ state: 'visible' });
    assert.equal((await host.locator('#lobby-room-code').textContent()).trim(), code, 'New settings keep the room code');
    for (const page of guests) await page.waitForFunction(cells(16));
    await host.locator('#lobby-players-count', { hasText: '2' }).waitFor();
    console.log('PASS MuzLoto lobby: remembered TV opened the room, new settings kept the room and both players');

    await host.locator('#btn-start-game').click();
    await host.locator('#sec-game').waitFor({ state: 'visible' });
    await host.goto(site);
    await host.locator('#live-music', { hasText: 'комната #' + code }).waitFor();
    await host.goto(site + 'tv.html');
    await host.locator('#sec-game').waitFor({ state: 'visible' });
    await tv.reload();
    await tv.getByText('Ход 1').first().waitFor();
    await host.locator('#btn-reset-session').click();
    for (const page of guests) {
      await page.locator('#join-notice:visible').waitFor();
      assert.match(await page.locator('#join-notice').innerText(), /Игра завершена/);
      assert.equal(await page.locator('#sec-play').isVisible(), false);
    }
    await tv.waitForURL(/screen\.html\?pair=\d{4}/);
    await guests[0].reload();
    await guests[0].waitForTimeout(1200);
    assert.equal(await guests[0].locator('#sec-play').isVisible(), false, 'A reload does not bring a player back into an ended game');
    const stranger = await open(site + 'play.html?room=' + code);
    await stranger.locator('#input-name').fill('Поздно');
    await stranger.locator('#btn-join').click();
    await stranger.locator('#toast', { hasText: 'уже завершена' }).waitFor();
    await host.locator('#sec-setup').waitFor({ state: 'visible' });
    assert.equal(await host.evaluate(() => localStorage.getItem('muzloto_active_host_code')), null);
    console.log('PASS MuzLoto: continue after reload; ending tells the players, frees the TV and refuses the old code');

    // «Новая игра» on the landing page ends the running game before its page has connected to the TV.
    await host.evaluate(tracks(9));
    await host.locator('#btn-create-room').click();
    await host.locator('#sec-lobby').waitFor();
    await tv.waitForURL(/music-screen\.html\?screen=/);
    await host.goto(site + 'muzloto.html');
    await host.locator('#hero-new').click();
    await host.locator('#sec-setup').waitFor({ state: 'visible' });
    await tv.waitForURL(/screen\.html\?pair=\d{4}/);
    assert.equal(await host.evaluate(() => localStorage.getItem('muzloto_active_host_code')), null);
    console.log('PASS MuzLoto «Новая игра» from the landing page: the old room is gone and the TV is back on its code');

    // Without the room server (the public site) the same lobby rules hold between tabs.
    const offline = await browser.newContext(mobile);
    await offline.route(/\/(socket\.io\/socket\.io|mqtt\.min|peerjs\.min)\.js/, route => route.abort());
    const lone = watch(await offline.newPage());
    await lone.goto(site + 'tv.html');
    await lone.waitForFunction(() => typeof setTracks === 'function');
    await lone.waitForTimeout(800);
    await lone.evaluate(tracks(9));
    await lone.locator('#btn-create-room').click();
    await lone.locator('#sec-lobby').waitFor();
    const meshCode = (await lone.locator('#lobby-room-code').textContent()).trim();
    const guest = watch(await offline.newPage());
    await guest.goto(site + 'play.html?room=' + meshCode);
    await guest.locator('#input-name').fill('Аня');
    await guest.locator('#btn-join').click();
    await guest.locator('#sec-play').waitFor({ state: 'visible' });
    await lone.locator('#btn-back-setup').click();
    await lone.evaluate(tracks(20));
    await lone.locator('#opt-size').selectOption('4');
    await lone.locator('#btn-create-room').click();
    await lone.locator('#sec-lobby').waitFor({ state: 'visible' });
    assert.equal((await lone.locator('#lobby-room-code').textContent()).trim(), meshCode);
    await guest.waitForFunction(cells(16));
    await lone.locator('#btn-start-game').click();
    await lone.locator('#sec-game').waitFor({ state: 'visible' });
    await lone.locator('#btn-reset-session').click();
    await guest.locator('#join-notice:visible').waitFor();
    await lone.locator('#sec-setup').waitFor({ state: 'visible' });
    assert.deepEqual(await lone.evaluate(() => Object.keys(localStorage).filter(key => /^muzloto_(mesh_room_|active_host_code)/.test(key))), []);
    await lone.reload();
    await lone.waitForTimeout(1200);
    assert.equal(await lone.locator('#sec-lobby').isVisible() || await lone.locator('#sec-game').isVisible(), false, 'An ended game does not come back');
    console.log('PASS MuzLoto without the server: settings keep the room, the ended game is gone for the player and the host');

    // A wrong code only waits; the TV can be forgotten; the QR on the TV stores its code on the phone.
    await host.locator('#btn-pair-tv').click();
    await enterCode(host, pin === '0000' ? '1111' : '0000');
    await host.locator('#btn-pair-tv', { hasText: 'ждём экран' }).waitFor();
    await host.locator('#btn-pair-tv').click();
    await host.locator('.pair-dialog button[value=forget]').click();
    await host.locator('#btn-pair-tv', { hasText: 'Подключить ТВ' }).waitFor();
    const phone = await open(site + 'screen.html?link=' + pin);
    await phone.getByText('ТВ подключён к этому телефону').waitFor();
    assert.equal(await phone.evaluate(() => localStorage.getItem('party-tv-pin')), pin);
    console.log('PASS TV code: a wrong code waits, the TV can be forgotten, the QR link stores the code');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

run().catch(error => { console.error(error.stack); process.exitCode = 1; });
