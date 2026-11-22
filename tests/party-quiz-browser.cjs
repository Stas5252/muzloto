const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const site = process.env.QUIZ_URL || 'http://localhost:3000/quiz/';
const chrome = process.env.MUZLOTO_CHROME || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const names = Array.from({ length: 11 }, (_, index) => `Участник ${index + 1} из команды`);
const button = (page, name) => page.getByRole('button', { name, exact: true });

async function run() {
  const browser = await chromium.launch({ executablePath: chrome });
  const errors = [];
  async function open(context, url) {
    const page = await context.newPage();
    page.setDefaultTimeout(18000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return page;
  }
  try {
    const phoneHost = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const bigScreen = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await bigScreen.addInitScript(() => { delete window.BroadcastChannel; });
    const host = await open(phoneHost, site);
    await host.evaluate(async image => {
      const { demoPack } = await import('./game.mjs?v=19');
      const { write } = await import('./storage.mjs');
      const draft = structuredClone(demoPack);
      draft.rounds[0].categories[0].questions[3].image = image;
      await write('draft', draft);
    }, 'data:image/webp;base64,' + fs.readFileSync(require('node:path').join(__dirname, '../quiz/media/new-bag-amber.webp')).toString('base64'));
    await host.reload({ waitUntil: 'domcontentloaded' });
    await button(host, 'Создать комнату').click();
    await host.locator('#join-qr canvas').waitFor({ state: 'attached' });
    const joinUrl = await host.getByRole('link', { name: /Открыть игрока/ }).getAttribute('href');
    const tvUrl = await host.getByRole('link', { name: /Экран ТВ/ }).getAttribute('href');
    assert.notEqual(new URL(joinUrl).searchParams.get('play'), new URL(tvUrl).searchParams.get('tv'));
    const tv = await open(bigScreen, tvUrl);
    await tv.getByText('Собираем игроков', { exact: true }).waitFor();
    await tv.locator('#join-qr canvas').waitFor({ state: 'attached' });
    assert.match(await tv.locator('.join-link').textContent(), /\?play=[a-f0-9]{24}$/, 'The TV lobby shows the player link');
    assert.equal(await tv.getByRole('button', { name: 'Начать игру', exact: true }).count(), 0);
    const players = [];

    for (let index = 0; index < names.length; index += 4) {
      const batch = await Promise.all(names.slice(index, index + 4).map(async name => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const phone = await open(context, joinUrl);
        await phone.getByRole('textbox', { name: 'Имя на табло' }).fill(name);
        await button(phone, 'Войти').click();
        await phone.getByRole('heading', { name: 'Ты в игре' }).waitFor();
        return phone;
      }));
      players.push(...batch);
    }
    await host.getByText('11/12', { exact: true }).waitFor();
    console.log('11 players joined');

    await button(host, 'Начать игру').click();
    await tv.locator('.round-board').waitFor();
    assert.equal(await tv.locator('.round-board .value').count(), 24);
    await tv.getByRole('heading', { name: 'Договори фразу' }).waitFor();
    const scores = tv.locator('.score-panel');
    const boardNames = await scores.locator('.scores li span').allTextContents();
    assert.deepEqual([...boardNames].sort(), [...names].sort());
    const scoreBottom = await scores.evaluate(element => element.getBoundingClientRect().bottom);
    if (process.env.QUIZ_SCREENSHOT) await tv.screenshot({ path: process.env.QUIZ_SCREENSHOT });
    await host.locator('[data-id=c0q0]').click();
    await tv.waitForFunction(() => document.querySelector('.question-image[src="media/new-bag-phone.webp"]')?.naturalWidth > 0);
    await Promise.all(players.map(phone => button(phone, 'Жди сигнала').waitFor()));
    assert.equal(await tv.getByText('Жмите кнопку!', { exact: true }).count(), 0);
    await players[1].locator('.buzzer').click({ force: true });
    await button(players[1], 'Рано! Подожди').waitFor();
    assert.equal(await host.locator('.answering').count(), 0, 'A press before the signal does not reach the host');
    await button(host, 'Принимать ответы').click();
    await tv.getByText('Жмите кнопку!', { exact: true }).waitFor();
    await Promise.all(players.map(phone => button(phone, 'Ответить').waitFor()));
    assert.equal(await players[1].locator('.buzzer').getAttribute('aria-disabled'), 'false', 'The false start block ends after a second');
    const held = players[0].locator('.buzzer');
    await held.evaluate(element => { window.heldBuzzer = element; });
    const rect = await held.boundingBox();
    await players[0].mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await players[0].mouse.down();
    await Promise.all(players.slice(1).map(phone => phone.evaluate(() => document.querySelector('.buzzer').click())));
    await Promise.all(players.slice(1).map(phone => phone.getByRole('button', { name: /^(Отвечай вслух|Ты в очереди)$/ }).waitFor()));
    assert.equal(await held.evaluate(element => element === window.heldBuzzer), true, 'A press in progress must survive other players buzzing');
    assert.equal(await button(players[0], 'Отвечай вслух').count(), 1, 'The touch counts when the finger lands, before it lifts');
    await players[0].mouse.up();
    await Promise.all(players.map(phone => phone.getByRole('button', { name: /^(Отвечай вслух|Ты в очереди)$/ }).waitFor()));
    const labels = await Promise.all(players.map(phone => phone.locator('.buzzer').textContent()));
    assert.equal(labels.filter(label => label.includes('Отвечай вслух')).length, 1);
    assert.equal(labels.filter(label => label.includes('Ты в очереди')).length, 10);
    const firstName = (await host.locator('.answering').innerText()).trim();
    await button(host, '−100 · Неверно').click();
    await host.waitForFunction(previous => document.querySelector('.answering')?.textContent !== previous, firstName);
    const winnerName = (await host.locator('.answering').innerText()).trim();
    await button(host, '+100 · Верно').click();
    const winner = players[names.indexOf(winnerName)];
    await winner.getByText('100 очков', { exact: true }).waitFor();
    await winner.reload({ waitUntil: 'domcontentloaded' });
    await winner.getByText('100 очков', { exact: true }).waitFor();
    assert.equal(await winner.locator('.player-seat strong').textContent(), winnerName);
    assert.equal(await host.locator('.score-panel .scores li').count(), names.length);
    console.log('11 presses, queue, scoring and player reconnect verified');

    await button(host, 'К табло').click();
    await host.locator('[data-id=c0q3]').click();
    await tv.waitForFunction(() => document.querySelector('.question-image[src^="data:image/webp;base64,"]')?.naturalWidth > 0);
    await tv.reload({ waitUntil: 'domcontentloaded' });
    await tv.waitForFunction(() => document.querySelector('.question-image[src^="data:image/webp;base64,"]')?.naturalWidth > 0);
    const waitingForHandoff = button(players[0], 'Жди сигнала');
    await waitingForHandoff.waitFor();
    assert.equal(await waitingForHandoff.getAttribute('aria-disabled'), 'true');
    await button(host, 'Дать ответить всем').click();
    await Promise.all(players.map(phone => button(phone, 'Ответить').waitFor()));
    await button(host, 'Открыть ответ').click();
    await button(host, 'К табло').click();
    for (const [title, next, category] of [['К раунду 2', 'Знакомые лица и звуки', 'Угадай инструмент'], ['К раунду 3', 'Всё знакомое', 'Пословица по картинке']]) {
      host.once('dialog', dialog => dialog.accept());
      await button(host, title).click();
      await button(host, 'Начать раунд').click();
      await tv.getByRole('heading', { name: next, exact: true }).waitFor();
      await tv.getByRole('heading', { name: category, exact: true }).waitFor();
      if (category === 'Угадай инструмент') {
        await host.locator('[data-id=r1c5q3]').click();
        await tv.waitForFunction(() => document.querySelector('.question-image[src="media/family-sax.webp"]')?.naturalWidth > 0);
        const image = await tv.locator('.question-image').elementHandle();
        await host.reload({ waitUntil: 'domcontentloaded' });
        await button(host, 'Открыть ответ').waitFor();
        await host.waitForFunction(link => document.querySelector('[data-tv]')?.href === link, tvUrl);
        const sameBrowserTv = await open(phoneHost, tvUrl);
        await sameBrowserTv.waitForFunction(() => document.querySelector('.question-image[src="media/family-sax.webp"]')?.naturalWidth > 0);
        await sameBrowserTv.close();
        assert.equal(await image.evaluate(element => element.isConnected), true, 'An unchanged TV refresh keeps the image in place');
        assert.equal(await tv.getByText('Саксофон.', { exact: true }).count(), 0);
        await host.getByRole('button', { name: 'Дать подсказку', exact: true }).click();
        await tv.getByText('Знаменитое соло в песне «Кэрлесс виспер» сыграно на этом инструменте.', { exact: true }).waitFor();
        await button(host, 'Открыть ответ').click();
        await tv.getByText('Саксофон.', { exact: true }).waitFor();
        await button(host, 'К табло').click();
      }
    }
    host.once('dialog', dialog => dialog.accept());
    await button(host, 'Перейти в финал').click();
    await tv.getByText('Финал · Игрушка из детства', { exact: true }).waitFor();
    const writer = players.find(phone => phone !== winner);
    const writerInput = writer.getByRole('textbox', { name: 'Твой ответ' });
    await writerInput.fill('Пишу ответ');
    await writerInput.evaluate(input => {
      window.savedQuizInput = input;
      window.previousQuizScores = document.querySelector('.scores');
      input.setSelectionRange(4, 4);
    });

    async function submit(phone, answer, wager = 0) {
      await phone.getByRole('textbox', { name: 'Твой ответ' }).fill(answer);
      await phone.getByRole('spinbutton').fill(String(wager));
      await button(phone, 'Зафиксировать ответ').click();
      await phone.getByRole('heading', { name: 'Ответ принят' }).waitFor();
    }

    await submit(winner, 'Кубик Рубика', 50);
    await writer.waitForFunction(() => document.querySelector('.scores') !== window.previousQuizScores);
    assert.equal(await writerInput.evaluate(input => input === window.savedQuizInput && input === document.activeElement &&
      input.selectionStart === 4 && input.value === 'Пишу ответ'), true, 'Another player submitting must not replace a focused answer field');
    assert.equal(await tv.getByText('Кубик Рубика', { exact: true }).count(), 0);
    await Promise.all(players.filter(phone => phone !== winner).map((phone, index) => submit(phone, `Ответ ${index + 1}`)));
    await host.getByText('11/11', { exact: true }).waitFor();
    await host.getByRole('checkbox', { name: /Кубик Рубика/ }).check();
    await button(host, 'Подвести итоги').click();
    await tv.getByText('150 очков', { exact: true }).waitFor();
    assert.equal(await tv.locator('.scores li').count(), names.length);
    assert.equal(await tv.locator('.verdicts li').count(), names.length);
    assert.ok(scoreBottom <= 720, `TV scores should all fit at 1280×720, found bottom at ${scoreBottom}px`);
    host.once('dialog', dialog => dialog.accept());
    await button(host, 'Закрыть комнату').click();
    await tv.getByText('Комната закрыта.', { exact: true }).waitFor();

    // A converted pack: picture question, picture answer, and answering in turns.
    await host.getByRole('radio', { name: /Знаки зодиака, кроссовки и бренды/ }).click();
    await host.locator('.home-deck').getByText('Нарисовали кроссовки', { exact: true }).waitFor();
    await button(host, 'Создать комнату').click();
    await host.locator('#join-qr canvas').waitFor({ state: 'attached' });
    assert.equal(await host.locator('.lobby-copy h1').textContent(), 'Знаки зодиака, кроссовки и бренды');
    const packTv = await open(bigScreen, await host.getByRole('link', { name: /Экран ТВ/ }).getAttribute('href'));
    const packJoin = await host.getByRole('link', { name: /Открыть игрока/ }).getAttribute('href');
    const seats = [];
    for (const name of ['Аня', 'Боря']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const phone = await open(context, packJoin);
      await phone.getByRole('textbox', { name: 'Имя на табло' }).fill(name);
      await button(phone, 'Войти').click();
      await phone.getByRole('heading', { name: 'Ты в игре' }).waitFor();
      seats.push(phone);
    }
    await host.getByText('2/12', { exact: true }).waitFor();
    await button(host, 'По очереди').click();
    await host.getByRole('button', { name: 'По очереди', exact: true, pressed: true }).waitFor();
    await button(host, 'Начать игру').click();
    await packTv.getByText('Выбирает и отвечает первым:').waitFor();
    await seats[0].getByRole('heading', { name: 'Твой ход' }).waitFor();
    await seats[1].getByRole('heading', { name: 'Ход: Аня' }).waitFor();
    await host.locator('[data-id=c1q0]').click();
    await packTv.waitForFunction(() => /^packs\/media\/[a-f0-9]{12}\.webp$/.test(document.querySelector('.question-image')?.getAttribute('src')) &&
      document.querySelector('.question-image').naturalWidth > 0);
    const questionPhoto = await packTv.locator('.question-image').getAttribute('src');
    await button(seats[0], 'Отвечай вслух').waitFor();
    assert.equal(await button(seats[1], 'Отвечает Аня').isDisabled(), true);
    assert.equal(await button(host, 'Принимать ответы').count(), 0);
    await button(host, '−100 · Неверно').click();
    await button(seats[1], 'Отвечай вслух').waitFor();
    await packTv.getByText('Отвечает Боря', { exact: true }).waitFor();
    await button(host, '+100 · Верно').click();
    await packTv.waitForFunction(previous => document.querySelector('.question-image')?.getAttribute('src') !== previous &&
      document.querySelector('.question-image')?.naturalWidth > 0, questionPhoto);
    await packTv.getByText('adidas (Gazelle)', { exact: true }).waitFor();
    await button(host, 'К табло').click();
    await seats[1].getByRole('heading', { name: 'Твой ход' }).waitFor();
    assert.ok(await host.locator('#final-topic').count() === 0, 'The final topic is chosen in the last round');
    host.once('dialog', dialog => dialog.accept());
    await button(host, 'Закрыть комнату').click();
    await packTv.getByText('Комната закрыта.', { exact: true }).waitFor();

    // The editor launches its own draft even though a bundled pack is still chosen on the home screen.
    const tune = require('../quiz/packs/dota.json').rounds[1].categories[1].questions[0].audio;
    const finalTopic = topic => ({ topic, prompt: 'Вопрос финала', answer: 'Ответ финала' });
    await button(host, 'Редактор вопросов').click();
    host.once('dialog', dialog => dialog.accept());
    await host.locator('input[data-import]').setInputFiles({ name: 'deck.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      title: 'Проверка редактора', finals: [finalTopic('Первая тема'), finalTopic('Вторая тема')],
      rounds: [{ title: 'Раунд со звуком', categories: [{ title: 'Мелодии', questions: [{ prompt: 'Что звучит?', answer: 'Мелодия', value: 100, audio: tune }] }] }]
    })) });
    await host.getByRole('heading', { name: 'Финал · тема 1 из 2' }).waitFor();
    await button(host, 'Убрать тему').click();
    assert.equal(await host.getByRole('textbox', { name: 'Тема финала' }).inputValue(), 'Вторая тема');
    await button(host, 'Убрать финал').click();
    await button(host, 'Добавить финал').waitFor();
    await button(host, 'Создать комнату').click();
    await host.locator('#join-qr canvas').waitFor({ state: 'attached' });
    assert.equal(await host.locator('.lobby-copy h1').textContent(), 'Проверка редактора', 'The room uses the deck shown in the editor');
    assert.equal(await host.evaluate(async () => {
      const { validPack } = await import('./game.mjs?v=19');
      const { read } = await import('./storage.mjs?v=2');
      return validPack(await read('draft')).finals.length;
    }), 0, 'A final removed in the editor stays removed');
    const listener = await open(await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }),
      await host.getByRole('link', { name: /Открыть игрока/ }).getAttribute('href'));
    await listener.getByRole('textbox', { name: 'Имя на табло' }).fill('Аня');
    await button(listener, 'Войти').click();
    await host.getByText('1/12', { exact: true }).waitFor();
    await host.getByRole('button', { name: 'По очереди', exact: true, pressed: true }).waitFor();
    await button(host, 'Кто быстрее').click();
    await button(host, 'Начать игру').click();
    await host.locator('[data-id=c0q0]').click();
    await host.locator('.host-sound audio').evaluate(async audio => {
      window.heardTrack = audio;
      await audio.play();
    });
    await host.waitForFunction(() => window.heardTrack.currentTime > 0);
    await button(host, 'Принимать ответы').click();
    await button(listener, 'Ответить').waitFor();
    await listener.locator('.buzzer').click();
    await host.locator('.answering', { hasText: 'Аня' }).waitFor();
    assert.equal(await host.evaluate(() => window.heardTrack.isConnected && !window.heardTrack.paused &&
      document.querySelectorAll('.host-sound audio').length === 1), true, 'Opening the buttons and a buzz keep the host preview playing');
    host.once('dialog', dialog => dialog.accept());
    await button(host, 'Закрыть комнату').click();
    assert.deepEqual(errors, []);
    console.log('PASS mobile host, separate TV, photo and link recovery, 11 players, false start, converted pack in turns mode, editor launch, host audio preview and private final answers');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
