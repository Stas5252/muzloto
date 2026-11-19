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
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const host = await open(desktop, site);
    await button(host, 'Создать комнату').click();
    await host.locator('#join-qr canvas').waitFor({ state: 'attached' });
    const joinUrl = await host.getByRole('link', { name: /Открыть игрока/ }).getAttribute('href');
    const tvUrl = await host.getByRole('link', { name: /Экран ТВ/ }).getAttribute('href');
    const tv = await open(desktop, tvUrl);
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
    await tv.getByRole('heading', { name: 'Мем в эмодзи' }).waitFor();
    const scores = tv.locator('.score-panel');
    const boardNames = await scores.locator('.scores li span').allTextContents();
    assert.deepEqual([...boardNames].sort(), [...names].sort());
    const scoreBottom = await scores.evaluate(element => element.getBoundingClientRect().bottom);
    if (process.env.QUIZ_SCREENSHOT) await tv.screenshot({ path: process.env.QUIZ_SCREENSHOT });
    await host.locator('[data-id=c0q0]').click();
    await button(host, 'Открыть кнопки').click();
    await Promise.all(players.map(phone => button(phone, 'Ответить').waitFor()));
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
    for (const [title, next, memes] of [['К раунду 2', 'Свои в ленте', 'Мемы 2023-го'], ['К раунду 3', 'Ещё один раунд', 'Вирусный поворот']]) {
      host.once('dialog', dialog => dialog.accept());
      await button(host, title).click();
      await button(host, 'Начать раунд').click();
      await tv.getByRole('heading', { name: next, exact: true }).waitFor();
      await tv.getByRole('heading', { name: memes, exact: true }).waitFor();
      if (memes === 'Мемы 2023-го') {
        await host.locator('[data-id=r1c5q1]').click();
        await tv.waitForFunction(() => document.querySelector('.question-image[src="media/pop22.webp"]')?.naturalWidth > 0);
        await button(host, 'Открыть ответ').click();
        await tv.getByText('Сырники', { exact: true }).waitFor();
        await button(host, 'К табло').click();
      }
    }
    host.once('dialog', dialog => dialog.accept());
    await button(host, 'Перейти в финал').click();
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

    await submit(winner, 'Pokémon GO', 50);
    await writer.waitForFunction(() => document.querySelector('.scores') !== window.previousQuizScores);
    assert.equal(await writerInput.evaluate(input => input === window.savedQuizInput && input === document.activeElement &&
      input.selectionStart === 4 && input.value === 'Пишу ответ'), true, 'Another player submitting must not replace a focused answer field');
    assert.equal(await tv.getByText('Pokémon GO', { exact: true }).count(), 0);
    await Promise.all(players.filter(phone => phone !== winner).map((phone, index) => submit(phone, `Ответ ${index + 1}`)));
    await host.getByText('11/11', { exact: true }).waitFor();
    await host.getByRole('checkbox', { name: /Pokémon GO/ }).check();
    await button(host, 'Подвести итоги').click();
    await tv.getByText('150 очков', { exact: true }).waitFor();
    assert.equal(await tv.locator('.scores li').count(), names.length);
    assert.equal(await tv.locator('.verdicts li').count(), names.length);
    assert.ok(scoreBottom <= 720, `TV scores should all fit at 1280×720, found bottom at ${scoreBottom}px`);
    assert.deepEqual(errors, []);
    console.log('PASS 11-player party quiz, complete TV scores, private final answers and preserved typing focus');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
