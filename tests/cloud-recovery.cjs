const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const root = process.env.MUZLOTO_AUDIT_SITE || 'https://stas5252.github.io/muzloto/';
const timeout = 20000;
const nav = { waitUntil: 'domcontentloaded', timeout };
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function context(browser) {
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(timeout);
  // Isolated contexts cannot use BroadcastChannel; disable WebRTC to require MQTT.
  await ctx.route('**/peerjs.min.js', route => route.abort());
  await ctx.route('**/socket.io/socket.io.js', route => route.abort());
  return ctx;
}

async function createHost(ctx) {
  const host = await ctx.newPage();
  await host.goto(root + 'tv.html', nav);
  await host.getByText('Музыка в облаке: 43/43', { exact: true }).waitFor();
  await host.locator('#btn-create-room').click();
  await host.locator('#sec-lobby').waitFor({ state: 'visible' });
  return host;
}

async function markOne(host, player) {
  for (let attempt = 0; attempt < 43; attempt++) {
    const id = await player.locator('.bingo-cell').evaluateAll(cells =>
      cells.find(cell => calledTrackIds.has(cell.dataset.id))?.dataset.id);
    if (id) { await player.locator('.bingo-cell[data-id="' + id + '"]').click(); return; }
    const turn = await player.evaluate(() => calledTrackIds.size);
    await host.locator('#btn-next-keg').click();
    await player.waitForFunction(n => calledTrackIds.size === n + 1, turn, { timeout });
  }
  throw Error('No matching song');
}

async function recovery(browser) {
  const hostCtx = await context(browser);
  const playerCtx = await context(browser);
  try {
    const host = await createHost(hostCtx);
    const code = (await host.locator('#lobby-room-code').textContent()).trim();
    let player = await playerCtx.newPage();
    await player.goto(root + 'play.html?room=' + code, nav);
    await player.locator('#btn-join').click();
    assert.match(await player.locator('#toast').innerText(), /имя/);
    await player.locator('#input-name').fill('QA сеть');
    await player.locator('#btn-join').click();
    await player.locator('#sec-play').waitFor({ state: 'visible' });
    await host.locator('#btn-start-game').click();
    await host.locator('#chk-auto-next').uncheck();
    await player.waitForFunction(() => currentGameState === 'playing' && calledTrackIds.size === 1, null, { timeout });
    await markOne(host, player);
    const card = await player.locator('.bingo-cell').evaluateAll(cells => cells.map(c => c.dataset.id));
    const turn = await player.evaluate(() => calledTrackIds.size);
    await playerCtx.setOffline(true);
    await host.locator('#btn-next-keg').click();
    await host.locator('#btn-next-keg').click();
    await playerCtx.setOffline(false);
    await player.waitForFunction(n => calledTrackIds.size === n + 2, turn, { timeout });
    assert.equal(await player.locator('.bingo-cell.marked').count(), 1);
    assert.deepEqual(await player.locator('.bingo-cell').evaluateAll(cells => cells.map(c => c.dataset.id)), card);
    await host.reload(nav);
    await host.locator('#sec-game').waitFor({ state: 'visible' });
    await host.getByText('Музыка в облаке: 43/43', { exact: true }).waitFor();
    await host.locator('#btn-next-keg').click();
    await player.waitForFunction(n => calledTrackIds.size === n + 3, turn, { timeout });
    assert.equal(await player.locator('.bingo-cell.marked').count(), 1);
    const pid = await player.evaluate(() => myPlayerPid);
    await player.close();
    player = await playerCtx.newPage();
    await player.goto(root + 'play.html?room=' + code, nav);
    await player.waitForFunction(n => calledTrackIds.size === n + 3, turn, { timeout });
    assert.equal(await player.evaluate(() => myPlayerPid), pid);
    assert.equal(await player.locator('.bingo-cell.marked').count(), 1);
    assert.deepEqual(await player.locator('.bingo-cell').evaluateAll(cells => cells.map(c => c.dataset.id)), card);
    player.once('dialog', dialog => dialog.accept());
    await player.locator('#btn-leave-room').click();
    await player.locator('#sec-join').waitFor({ state: 'visible' });
    await host.waitForFunction(() => document.getElementById('lobby-players-count').textContent.trim() === '0', null, { timeout });
    console.log('PASS MQTT: isolated devices, temporary offline player, host refresh, browser tab reopened with same card and marks, explicit exit');
  } finally { await hostCtx.close(); await playerCtx.close(); }
}

async function outages(browser) {
  const ctx = await context(browser);
  try {
    const host = await ctx.newPage();
    const catalog = '**/functions/v1/muzloto-game-audio';
    await host.route(catalog, route => route.abort());
    await host.goto(root + 'tv.html', nav);
    await host.getByText('Не удалось подключить облачную музыку.', { exact: false }).waitFor();
    await host.locator('#btn-create-room').click();
    await host.locator('#btn-start-game').click();
    await host.locator('#chk-auto-next').uncheck();
    await host.getByText('Запись пока недоступна.', { exact: false }).waitFor();
    assert.equal(await host.locator('#btn-next-keg').isEnabled(), true);
    assert.equal(await host.locator('#btn-play-full-track').isEnabled(), false);
    await host.unroute(catalog);
    await host.locator('#btn-next-keg').click();
    await host.waitForFunction(() => document.getElementById('main-audio').currentTime > 0.15, null, { timeout });
    console.log('PASS catalog outage: clear error, working controls, music recovers on next draw');

    const audioFiles = '**/storage/v1/object/**';
    await host.route(audioFiles, route => route.abort());
    await host.locator('#btn-next-keg').click();
    await host.getByText('Не удалось загрузить звук.', { exact: false }).waitFor();
    assert.equal(await host.locator('#btn-next-keg').isEnabled(), true);
    await host.unroute(audioFiles);
    await host.locator('#btn-next-keg').click();
    await host.waitForFunction(() => document.getElementById('main-audio').currentTime > 0.15, null, { timeout });
    console.log('PASS audio-file outage: playable next track after connectivity returns');
  } finally { await ctx.close(); }
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.MUZLOTO_CHROME || (fs.existsSync(chrome) ? chrome : undefined), headless: true });
  try {
    if (!process.argv.includes('--outages-only')) await recovery(browser);
    if (!process.argv.includes('--recovery-only')) await outages(browser);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
