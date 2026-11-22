const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const express = require('express');

const timeout = 12000;
const nav = { waitUntil: 'domcontentloaded', timeout: 20000 };
const checks = [];
let browser;
let root;

async function check(name, run) {
  try {
    await run();
    checks.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (error) {
    checks.push({ name, ok: false, error: error.stack });
    console.error('FAIL ' + name + '\n' + error.stack);
  }
}

async function game(size = 3, mode = 'full', trackCount, name = 'QA <игрок> "имя"') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  context.setDefaultTimeout(timeout);
  console.log('  Opening '+size+'x'+size+' '+mode);
  // Exercise the production cloud-mesh adapter over BroadcastChannel deterministically.
  await context.route(/\/(socket\.io\/socket\.io|mqtt\.min|peerjs\.min)\.js/, route => route.abort());
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const host = await context.newPage();
  await host.setViewportSize({width:1280,height:800});
  const player = await context.newPage();
  await host.goto(root + 'tv.html', nav);
  await host.getByText('Музыка в облаке: 43/43', { exact: true }).waitFor({ timeout: 20000 });
  await host.locator('#opt-size').selectOption(String(size));
  await host.locator('#opt-mode').selectOption(mode);
  if (trackCount) {
    while (await host.locator('[data-idx]').count() > trackCount) {
      const before=await host.locator('[data-idx]').count();
      await host.locator('[data-idx]').first().evaluate(button=>button.click());
      assert.equal(await host.locator('[data-idx]').count(),before-1,'Track removal must update the selection');
    }
  }
  await host.locator('#btn-create-room').click();
  await host.locator('#sec-lobby').waitFor({ state: 'visible', timeout });
  const code = (await host.locator('#lobby-room-code').textContent()).trim();
  await player.goto(root + 'play.html?room=' + code, nav);
  await player.locator('#input-name').fill(name);
  await player.locator('#btn-join').click();
  console.log('  Joining room '+code);
  await player.locator('#sec-play').waitFor({ state: 'visible', timeout });
  assert.equal(await player.locator('.bingo-cell').count(), size * size);
  assert.ok((await host.locator('#lobby-players-wrap').innerText()).includes(name));
  await host.locator('#btn-start-game').click();
  await host.locator('#chk-auto-next').uncheck();
  await player.waitForFunction(() => currentGameState === 'playing' && calledTrackIds.size === 1, null, { timeout, polling: 50 });
  return { context, host, player, code, errors, size, mode };
}

async function markCalled(player) {
  const ids = await player.locator('.bingo-cell:not(.marked)').evaluateAll(cells =>
    cells.filter(cell => calledTrackIds.has(cell.dataset.id)).map(cell => cell.dataset.id));
  for (const id of ids) await player.locator('.bingo-cell[data-id="' + id + '"]').evaluate(cell => cell.click());
}

async function win(g) {
  let turn = await g.player.evaluate(() => calledTrackIds.size);
  while (turn <= 43) {
    await g.player.waitForFunction(n => calledTrackIds.size === n, turn, { timeout, polling: 50 });
    await markCalled(g.player);
    assert.equal(await g.player.locator('.ready-to-stamp').count(), 0);
    if (await g.player.locator('#btn-bingo').isEnabled()) {
      console.log('  Claiming bingo at '+turn);
      await g.player.locator('#btn-bingo').click();
      await g.player.waitForFunction(() => currentGameState === 'finished', null, { timeout, polling: 50 });
      await g.host.locator('#win-showcase-modal').waitFor({ state: 'visible', timeout: 2500 });
      return turn;
    }
    await g.host.locator('#btn-next-keg').evaluate(button => button.click());
    turn++;
  }
  throw Error('No valid winner');
}

async function matrix() {
  for (const size of [3, 4]) for (const mode of ['line', 'two_lines', 'full']) {
    await check(size + 'x' + size + ' ' + mode + ': player UI, validation, win and refresh', async () => {
      const g = await game(size, mode);
      try {
        assert.equal(await g.player.locator('#player-round-status').isVisible(), false);
        assert.equal(await g.player.locator('#mode-badge,#proximity-badge,#marks-count-text').count(), 0);
        const earlyId = await g.player.locator('.bingo-cell').evaluateAll(cells =>
          cells.find(cell => !calledTrackIds.has(cell.dataset.id)).dataset.id);
        await g.player.locator('.bingo-cell[data-id="' + earlyId + '"]').click();
        assert.equal(await g.player.locator('.bingo-cell.marked').count(), 0);
        assert.equal(await g.player.locator('#btn-bingo').isEnabled(), false);
        const turn = await win(g);
        const marks = await g.player.locator('.bingo-cell.marked').count();
        await g.player.reload(nav);
        await g.player.waitForFunction(() => currentGameState === 'finished', null, { timeout, polling: 50 });
        assert.equal(await g.player.locator('.bingo-cell.marked').count(), marks);
        assert.equal(await g.player.locator('#btn-bingo').isEnabled(), false);
        assert.equal(await g.player.locator('#player-round-status').isVisible(), true);
        assert.equal(await g.player.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        assert.deepEqual(g.errors, []);
        console.log('  Winner at draw ' + turn);
      } finally { await g.context.close(); }
    });
  }
}

async function repeatRound() {
  const g = await game(3, 'full', 9);
  try {
    assert.equal(await win(g), 9);
    await g.host.locator('#btn-showcase-newround').click();
    await g.player.waitForFunction(() => currentGameState === 'playing' && calledTrackIds.size === 1, null, { timeout, polling: 50 });
    assert.equal(await g.player.locator('.bingo-cell.marked').count(), 0);
    assert.equal(await win(g), 9);
    const db = await g.host.evaluate(() => JSON.parse(localStorage.getItem('muzloto_db_stats')));
    assert.equal(db.history.length, 2, 'Two separate rounds must produce two results, even within 30 seconds');
    await g.host.locator('#btn-showcase-lobby').click();
    await g.host.locator('#sec-lobby').waitFor({ state: 'visible', timeout });
    await g.player.waitForFunction(() => currentGameState === 'lobby', null, { timeout, polling: 50 });
    assert.equal(await g.player.locator('#btn-bingo').isEnabled(), false);
    assert.equal(await g.player.locator('.bingo-cell.marked').count(), 0);
    assert.deepEqual(g.errors, []);
  } finally { await g.context.close(); }
}

async function hostReload() {
  const g = await game();
  try {
    for (let turn = 1; turn <= 43; turn++) {
      await g.player.waitForFunction(n => calledTrackIds.size === n, turn, { timeout, polling: 50 });
      await markCalled(g.player);
      if (await g.player.locator('.bingo-cell.marked').count()) break;
      await g.host.locator('#btn-next-keg').evaluate(button => button.click());
    }
    const turn = await g.player.evaluate(() => calledTrackIds.size);
    const card = await g.player.locator('.bingo-cell').evaluateAll(cells => cells.map(c => c.dataset.id));
    await g.host.reload(nav);
    await g.host.locator('#sec-game').waitFor({ state: 'visible', timeout });
    assert.equal((await g.host.locator('#game-turn-badge').textContent()).trim(), 'Ход ' + turn);
    await g.host.locator('#btn-next-keg').evaluate(button => button.click());
    await g.player.waitForFunction(n => calledTrackIds.size === n + 1, turn, { timeout, polling: 50 });
    assert.deepEqual(await g.player.locator('.bingo-cell').evaluateAll(cells => cells.map(c => c.dataset.id)), card);
    assert.ok(await g.player.locator('.bingo-cell.marked').count());
    assert.deepEqual(g.errors, []);
  } finally { await g.context.close(); }
}

async function leaveRoom() {
  const g = await game();
  try {
    g.player.once('dialog', dialog => dialog.accept());
    await g.player.locator('#btn-leave-room').click();
    await g.player.locator('#sec-join').waitFor({ state: 'visible', timeout });
    await g.host.waitForFunction(() => document.getElementById('lobby-players-count').textContent.trim() === '0', null, { timeout: 2500 });
    await g.player.locator('#input-name').fill('Вернулся');
    await g.player.locator('#btn-join').click();
    await g.player.locator('#sec-play').waitFor({ state: 'visible', timeout });
    await g.host.waitForFunction(() => document.getElementById('lobby-players-count').textContent.trim() === '1', null, { timeout, polling: 50 });
    assert.deepEqual(g.errors, []);
  } finally { await g.context.close(); }
}

async function playerRejoin() {
  const g = await game();
  try {
    let turn = 1;
    for (; turn <= 43; turn++) {
      await g.player.waitForFunction(n => calledTrackIds.size === n, turn);
      await markCalled(g.player);
      if (await g.player.locator('.bingo-cell.marked').count()) break;
      await g.host.locator('#btn-next-keg').evaluate(button => button.click());
    }
    await g.host.waitForFunction(() => {
      const code = document.getElementById('lobby-room-code').textContent.trim();
      return JSON.parse(localStorage.getItem('muzloto_mesh_room_' + code)).players[0][1].marks.length === 1;
    });
    const readSeat = page => page.evaluate(() => ({ pid: myPlayerPid, card: myCard.map(track => track.id), marks: [...myMarks] }));
    const original = await readSeat(g.player);
    await g.player.close();

    const player = await g.context.newPage();
    await player.goto(root + 'play.html?room=' + g.code, nav);
    await player.waitForFunction(n => calledTrackIds.size === n, turn);
    assert.deepEqual(await readSeat(player), original, 'Reopening the page must preserve player ID, card and marks');

    player.once('dialog', dialog => dialog.accept());
    await player.locator('#btn-leave-room').click();
    await g.host.waitForFunction(() => document.getElementById('lobby-players-count').textContent.trim() === '0');
    await player.reload(nav);
    assert.equal(await player.locator('#sec-join').isVisible(), true, 'Explicit leave must stop auto-join');
    await player.locator('#btn-join').click();
    await player.locator('#sec-play').waitFor({ state: 'visible' });
    assert.deepEqual(await readSeat(player), original, 'Rejoining with the same nickname must restore the seat');
    assert.equal((await g.host.locator('#lobby-players-count').innerText()).trim(), '1');

    await player.evaluate(() => {
      const postMessage = BroadcastChannel.prototype.postMessage;
      BroadcastChannel.prototype.postMessage = function (message) {
        if (message.type !== 'mark') postMessage.call(this, message);
      };
    });
    await player.locator('.bingo-cell.marked').click();
    await player.close();
    const restored = await g.context.newPage();
    await restored.goto(root + 'play.html?room=' + g.code, nav);
    await restored.waitForFunction(n => calledTrackIds.size === n, turn);
    assert.deepEqual(await readSeat(restored), { ...original, marks: [] });
    await g.host.waitForFunction(code => {
      return JSON.parse(localStorage.getItem('muzloto_mesh_room_' + code)).players[0][1].marks.length === 0;
    }, g.code);
  } finally { await g.context.close(); }
}

async function specialName() {
  const g = await game(3, 'full', 9, '__proto__');
  try {
    await win(g);
    const result = await g.host.evaluate(() => {
      const stats = JSON.parse(localStorage.getItem('muzloto_db_stats'));
      return {
        wins: Object.hasOwn(stats.leaderboard, '__proto__') ? stats.leaderboard['__proto__'].wins : null,
        polluted: Object.hasOwn(Object.prototype, 'wins'),
      };
    });
    assert.equal(result.wins, 1);
    assert.equal(result.polluted, false);
  } finally { await g.context.close(); }
}

async function durationEstimate() {
  const g = await game(4, 'full', 16);
  try {
    assert.match(await g.host.locator('#lobby-estimate-desc').textContent(), /16 трек/,
      'Duration estimate must use the actual selected track count');
    assert.doesNotMatch(await g.host.locator('#lobby-estimate-desc').textContent(), /из 50/);
  } finally { await g.context.close(); }
}

async function quizMenu() {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  context.setDefaultTimeout(timeout);
  try {
    const page = await context.newPage();
    const home = new URL('quiz/', root).href;
    const start = page.getByRole('button', { name: 'Начать игру' });
    const resume = page.getByRole('link', { name: 'Продолжить игру' });
    const board = page.getByRole('button', { name: 'К табло' });
    await page.goto(home, nav);
    await page.getByRole('button', { name: 'Создать комнату', exact: true }).click();
    await start.click();
    const roomUrl = page.url();
    assert.match(new URL(roomUrl).searchParams.get('host'), /^[a-f0-9]{24}$/);
    await page.locator('[data-id="c0q0"]').click();
    await page.getByRole('button', { name: 'Открыть ответ' }).click();
    await page.goto(home, nav);
    await resume.waitFor();
    assert.equal(await board.count(), 0, 'The main URL always opens the menu');
    await resume.click();
    await board.waitFor();
    assert.equal(page.url(), roomUrl);
    await page.reload(nav);
    await board.waitFor();
    await page.getByRole('link', { name: 'Меню квиза', exact: true }).click();
    await resume.waitFor();
    assert.equal(await resume.getAttribute('href'), roomUrl);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  } finally { await context.close(); }
}

async function gameMenu() {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  context.setDefaultTimeout(timeout);
  try {
    const page = await context.newPage();
    const menu = page.getByRole('heading', { name: 'Во что играем?' });
    const back = page.getByRole('link', { name: 'Все игры' }).first();
    await page.goto(root, nav);
    await menu.waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.getByRole('link', { name: /МузЛото/ }).click();
    await page.getByRole('link', { name: 'Создать игру' }).first().waitFor();
    assert.equal(new URL(page.url()).pathname, new URL('muzloto.html', root).pathname);
    await back.click();
    await menu.waitFor();
    await page.getByRole('link', { name: /Вне очереди/ }).click();
    await page.getByRole('button', { name: 'Создать комнату', exact: true }).waitFor();
    assert.equal(page.url(), new URL('quiz/', root).href);
    await back.click();
    await menu.waitFor();
    for (const file of ['tv.html', 'play.html']) {
      await page.goto(root + file, nav);
      assert.equal(await page.locator('a[href="index.html"]').count(), 0, file + ' returns to the MuzLoto home page');
      assert.ok(await page.locator('a[href="muzloto.html"]').count() > 0);
    }
  } finally { await context.close(); }
}

async function main() {
  let server;
  if (process.env.MUZLOTO_AUDIT_SITE) root = process.env.MUZLOTO_AUDIT_SITE;
  else {
    const app = express();
    app.use('/quiz', express.static(path.join(__dirname, '..', 'quiz')));
    app.use(express.static(path.join(__dirname, '..', 'public')));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    root = 'http://127.0.0.1:' + server.address().port + '/';
  }
  const windowsChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  try {
    browser = await chromium.launch({
      executablePath: process.env.MUZLOTO_CHROME || (fs.existsSync(windowsChrome) ? windowsChrome : undefined),
      headless: true,
    });
    if (process.argv.includes('--menu-only')) {
      await check('Main menu opens both games and each game returns to it', gameMenu);
    } else if (process.argv.includes('--quiz-only')) {
      await check('Quiz opens its mobile menu and resumes the exact saved question', quizMenu);
    } else if (process.argv.includes('--estimate-only')) {
      await check('Duration estimate uses the selected pack and card size', durationEstimate);
    } else if (process.argv.includes('--name-only')) {
      await check('Special player name remains an ordinary leaderboard entry', specialName);
    } else if (process.argv.includes('--leave-only')) {
      await check('Explicit leave removes the participant; rejoin creates one seat', leaveRoom);
    } else if (process.argv.includes('--rejoin-only')) {
      await check('Player keeps card and marks after closing or leaving', playerRejoin);
    } else if (!process.argv.includes('--repeat-only')) {
      await matrix();
      await check('Host refresh preserves room, draw order, card and marks', hostReload);
      await check('Explicit leave removes the participant; rejoin creates one seat', leaveRoom);
      await check('Player keeps card and marks after closing or leaving', playerRejoin);
      await check('Special player name remains an ordinary leaderboard entry', specialName);
      await check('Duration estimate uses the selected pack and card size', durationEstimate);
      await check('Quiz opens its mobile menu and resumes the exact saved question', quizMenu);
      await check('Main menu opens both games and each game returns to it', gameMenu);
    }
    if (!process.argv.some(arg => ['--leave-only', '--name-only', '--estimate-only', '--rejoin-only', '--quiz-only', '--menu-only'].includes(arg))) await check('Same winner at the same draw in consecutive rounds', repeatRound);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
  console.log(JSON.stringify(checks.map(({ name, ok }) => ({ name, ok })), null, 2));
  if (checks.some(result => !result.ok)) process.exitCode = 1;
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
