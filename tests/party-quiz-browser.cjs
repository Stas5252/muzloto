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
      const { demoPack } = await import('./game.mjs?v=17');
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
    await Promise.all(players.map(phone => button(phone, 'Ответить').waitFor()));
    assert.equal(await button(host, 'Открыть кнопки').count(), 0);
    const held = button(players[0], 'Ответить');
    await held.evaluate(element => { window.heldBuzzer = element; });
    const rect = await held.boundingBox();
    await players[0].mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await players[0].mouse.down();
    await Promise.all(players.slice(1).map(phone => phone.evaluate(() => document.querySelector('.buzzer').click())));
    await Promise.all(players.slice(1).map(phone => phone.getByRole('button', { name: /^(Отвечай вслух|Ты в очереди)$/ }).waitFor()));
    assert.equal(await held.evaluate(element => element === window.heldBuzzer), true, 'A press in progress must survive other players buzzing');
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
    const waitingForHandoff = button(players[0], 'Ведущий выбирает игрока');
    await waitingForHandoff.waitFor();
    assert.equal(await waitingForHandoff.isDisabled(), true);
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
    assert.deepEqual(errors, []);
    console.log('PASS mobile host, separate TV, photo and link recovery, 11 players and private final answers');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
