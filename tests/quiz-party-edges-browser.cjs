const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const site = process.env.QUIZ_URL || 'http://localhost:3000/quiz/';
const chrome = process.env.MUZLOTO_CHROME || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const long = 'Это суровый шлем из ледяной пустыни: серый металл с синим свечением, будто внутри работает магия. ' +
  'На лицевой части узоры в виде черепа с круглыми отверстиями вместо глаз, и всё это светится, как неоновый фонарь. ' +
  'Снизу торчит белый мех, жёсткий, как щетина, а по бокам идут шипы, которыми удобно пугать прохожих. ' +
  'Говорят, что тот, кто его надел, превращает врагов в овец и замораживает землю под ногами. Назовите этот предмет.';
const pack = {
  title: 'Проверка краёв',
  rounds: [{ title: 'Раунд', categories: [{ title: 'Длинные вопросы', questions: [
    { prompt: long, answer: 'Первый ответ', value: 100 }, { prompt: 'Второй вопрос', answer: 'Второй ответ', value: 200 },
    { prompt: 'Третий вопрос', answer: 'Третий ответ', value: 300 }] }] }],
  finals: [{ topic: 'Нейросеть описывает предмет', prompt: long + ' ' + long, answer: 'Шлем' }]
};

async function run() {
  const browser = await chromium.launch({ executablePath: chrome });
  const errors = [];
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  async function open(options, url) {
    const page = await (await browser.newContext(options)).newPage();
    page.setDefaultTimeout(18000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return page;
  }
  // Two touches on the same spot, faster than a person can read what appeared under the finger.
  async function doubleTap(page, name) {
    const box = await button(page, name).boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(120);
    await page.touchscreen.tap(x, y);
  }
  // Empty when the whole text is inside its panel and the panel and the seats are inside the screen.
  const overflow = page => page.evaluate(() => {
    const box = name => document.querySelector(name).getBoundingClientRect();
    const [seats, panel, text] = [box('.score-panel'), box('.question'), box('.question h1')];
    const size = parseFloat(getComputedStyle(document.querySelector('.question h1')).fontSize);
    return document.documentElement.scrollHeight <= innerHeight + 1 && seats.bottom <= innerHeight + 1 && panel.bottom <= seats.top + 1 &&
      text.top >= panel.top && text.bottom <= panel.bottom && size >= 16 ? '' :
      `page ${document.documentElement.scrollHeight}/${innerHeight}, seats ${Math.round(seats.top)}–${Math.round(seats.bottom)}, ` +
      `panel ${Math.round(panel.top)}–${Math.round(panel.bottom)}, text ${Math.round(text.top)}–${Math.round(text.bottom)} at ${size}px`;
  });
  try {
    const host = await open(phone, site);
    await host.evaluate(async draft => {
      const { write } = await import('./storage.mjs');
      await write('draft', draft);
      localStorage.setItem('vne-ocheredi-pack', JSON.stringify('draft'));
      localStorage.setItem('vne-ocheredi-pace', '0');
    }, pack);
    await host.reload({ waitUntil: 'domcontentloaded' });
    await button(host, 'Создать комнату').click();
    const joinUrl = await host.getByRole('link', { name: /Открыть игрока/ }).getAttribute('href');
    const tvUrl = await host.getByRole('link', { name: /Экран ТВ/ }).getAttribute('href');
    const tv = await open({ viewport: { width: 1280, height: 720 } }, tvUrl);
    const wide = await open({ viewport: { width: 1920, height: 1080 } }, tvUrl);

    const join = async name => {
      const page = await open(phone, joinUrl);
      await page.getByRole('textbox', { name: 'Имя на табло' }).fill(name);
      await button(page, 'Войти').click();
      return page;
    };
    const players = [];
    for (let index = 0; index < 12; index += 4) {
      players.push(...await Promise.all([0, 1, 2, 3].map(async offset => {
        const page = await join(`Игрок ${index + offset + 1} из команды`);
        await page.getByRole('heading', { name: 'Ты в игре' }).waitFor();
        return page;
      })));
    }
    await host.getByText('12/12', { exact: true }).waitFor();
    const late = await open(phone, joinUrl);
    await late.getByText('до 24 букв').waitFor();
    assert.equal(await late.locator('.wordmark').getAttribute('href'), null, 'The logo does not lead a player to the host menu');
    await late.getByRole('textbox', { name: 'Имя на табло' }).fill('Тринадцатый');
    await button(late, 'Войти').click();
    await late.getByRole('heading', { name: 'Комната заполнена' }).waitFor();
    await late.waitForTimeout(7500);
    assert.equal(await late.getByText(/Ведущий не отвечает/).count(), 0, 'A full room is not blamed on the host');
    console.log('PASS the thirteenth player is told that the room is full');

    await button(host, 'Начать игру').click();
    await host.locator('[data-id=c0q0]').click();
    await tv.locator('.question h1').waitFor();
    await wide.locator('.question h1').waitFor();
    assert.equal(await overflow(tv), '', 'A long question fits a 720p TV together with the seats');
    assert.equal(await overflow(wide), '', 'A long question fits a 1080p TV together with the seats');
    if (process.env.QUIZ_SCREENSHOT) await tv.screenshot({ path: process.env.QUIZ_SCREENSHOT + '-question-720.png' });
    await button(host, 'Принимать ответы').click();
    await button(players[0], 'Ответить').waitFor();
    await players[0].locator('.buzzer').tap();
    await button(host, '+100 · Верно').waitFor();
    await host.waitForTimeout(500);
    await doubleTap(host, '+100 · Верно');
    await host.waitForTimeout(700);
    assert.ok(await button(host, 'К табло').isVisible(), 'The second tap on «Верно» does not skip the answer');
    await tv.getByText('Первый ответ', { exact: true }).waitFor();
    assert.ok(await tv.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'The answer to a long question fits a 720p TV');
    await host.waitForTimeout(500);
    await doubleTap(host, 'К табло');
    await host.waitForTimeout(1800);
    assert.equal(await host.locator('[data-id=c0q1]').count(), 1, 'The second tap on «К табло» does not open a question');
    await tv.locator('.round-board').waitFor();
    assert.equal(await tv.locator('.round-board .value:not(.used):not([disabled])').count() >= 2, true);
    assert.equal(await tv.locator('.question').count(), 0, 'The TV stays on the board');
    console.log('PASS a double tap of the host neither skips the answer nor opens the next question');

    host.once('dialog', dialog => dialog.accept());
    if (!await button(host, 'Перейти в финал').isVisible()) await host.locator('.room-menu summary').click();
    await button(host, 'Перейти в финал').click();
    await tv.getByText('Финал · Нейросеть описывает предмет', { exact: true }).waitFor();
    await wide.getByText('Финал · Нейросеть описывает предмет', { exact: true }).waitFor();
    assert.equal(await overflow(tv), '', 'A long final question fits a 720p TV together with the seats');
    assert.equal(await overflow(wide), '', 'A long final question fits a 1080p TV together with the seats');
    if (process.env.QUIZ_SCREENSHOT) {
      await tv.screenshot({ path: process.env.QUIZ_SCREENSHOT + '-720.png' });
      await wide.screenshot({ path: process.env.QUIZ_SCREENSHOT + '-1080.png' });
    }
    console.log('PASS a long final question fits the TV at 1280×720 and 1920×1080');

    const stray = await open(phone, await host.evaluate(() => location.href));
    await stray.getByText(/Пульт этой игры остался/).waitFor();
    console.log('PASS the host link on another phone explains where the remote is');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

run().catch(error => { console.error(error.stack); process.exitCode = 1; });
