const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

async function run() {
  const outputDir = path.join(__dirname, 'recorded_videos');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log('🎥 Запуск Chromium 1080p для записи презентационного видео МузЛото...');
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });

  const context = await browser.newContext({
    recordVideo: {
      dir: outputDir,
      size: { width: 1920, height: 1080 }
    },
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  // Clear any existing localStorage/sessionStorage for a fresh clean state
  await page.goto('http://localhost:3000/tv.html');
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch(e) {}
  });

  console.log('🌐 Загрузка студии записи: http://localhost:3000/studio-recorder.html');
  await page.goto('http://localhost:3000/studio-recorder.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Access the 3 iframes
  const tvFrame = page.frameLocator('#tv-frame');
  const p1Frame = page.frameLocator('#p1-frame');
  const p2Frame = page.frameLocator('#p2-frame');

  // 1. Setup on TV: Select Mode "1 Линия" for dynamic blitz game
  console.log('⚙️ Ведущий настраивает игру: Режим "1 Линия (быстрый блиц)"...');
  await tvFrame.locator('#opt-mode').waitFor({ state: 'visible', timeout: 8000 });
  await tvFrame.locator('#opt-mode').selectOption('line');
  await page.waitForTimeout(1500);

  console.log('🚀 Ведущий нажимает "Создать комнату для ТВ"...');
  await tvFrame.locator('#btn-create-room').click({ force: true });

  // 2. Wait for TV lobby screen & room code
  await tvFrame.locator('#sec-lobby').waitFor({ state: 'visible', timeout: 8000 });
  await tvFrame.locator('#lobby-room-code').waitFor({ state: 'visible', timeout: 8000 });
  
  // Wait until room code is not "----"
  let roomCode = '----';
  for (let i = 0; i < 20; i++) {
    roomCode = (await tvFrame.locator('#lobby-room-code').textContent()).trim();
    if (roomCode && roomCode !== '----') break;
    await page.waitForTimeout(300);
  }
  console.log(`✓ Комната создана! Код для игроков: #${roomCode}`);
  await page.waitForTimeout(2500);

  // 3. Player 1 (Гриша) joins via mobile
  console.log('📱 Игрок 1 (Гриша) вводит имя и код на телефоне...');
  await p1Frame.locator('#input-name').waitFor({ state: 'visible', timeout: 8000 });
  await p1Frame.locator('#input-name').fill('Гриша');
  await page.waitForTimeout(600);
  await p1Frame.locator('#input-room').fill(roomCode);
  await page.waitForTimeout(800);
  await p1Frame.locator('#btn-join').click({ force: true });
  await p1Frame.locator('#sec-play').waitFor({ state: 'visible', timeout: 6000 });
  console.log('✓ Гриша успешно вошёл, получил персональную карточку 3×3');
  await page.waitForTimeout(2000);

  // 4. Player 2 (Даша) joins via mobile
  console.log('📱 Игрок 2 (Даша) вводит имя и код на телефоне...');
  await p2Frame.locator('#input-name').waitFor({ state: 'visible', timeout: 8000 });
  await p2Frame.locator('#input-name').fill('Даша');
  await page.waitForTimeout(600);
  await p2Frame.locator('#input-room').fill(roomCode);
  await page.waitForTimeout(800);
  await p2Frame.locator('#btn-join').click({ force: true });
  await p2Frame.locator('#sec-play').waitFor({ state: 'visible', timeout: 6000 });
  console.log('✓ Даша успешно вошла, получила персональную карточку 3×3');
  await page.waitForTimeout(2500);

  // 5. TV Lobby shows 2 players seated + duration estimation
  console.log('📺 ТВ лобби: оба игрока за столом, ведущий запускает игру...');
  await page.waitForTimeout(1500);
  await tvFrame.locator('#btn-start-game').click({ force: true });
  await tvFrame.locator('#sec-game').waitFor({ state: 'visible', timeout: 6000 });
  console.log('✓ Главная ТВ сцена активна: 3D бочонок, виниловый диск и эквалайзер готовы!');

  // 6. Game Rounds: Draw barrels until a player gets BINGO
  let round = 1;
  let winnerFound = false;
  let winnerPlayerName = null;

  while (round <= 35 && !winnerFound) {
    console.log(`\n🎲 Раунд №${round}...`);
    await page.waitForTimeout(2500); // Wait for 3D barrel animation + vinyl disc spinning

    const kegNum = (await tvFrame.locator('#lotto-keg-number').textContent()).trim();
    console.log(`  ➔ Текущий бочонок №${kegNum}`);

    // Wait a brief moment for state propagation to players
    await page.waitForTimeout(600);

    // Player 1 (Гриша) checks ready-to-stamp cells
    const p1Ready = await p1Frame.locator('.bingo-cell.ready-to-stamp').all();
    for (const cell of p1Ready) {
      console.log(`  ✓ [Гриша] отмечает совпавший бочонок!`);
      await cell.click({ force: true });
      await page.waitForTimeout(400);
    }

    // Player 2 (Даша) checks ready-to-stamp cells
    const p2Ready = await p2Frame.locator('.bingo-cell.ready-to-stamp').all();
    for (const cell of p2Ready) {
      console.log(`  ✓ [Даша] отмечает совпавший бочонок!`);
      await cell.click({ force: true });
      await page.waitForTimeout(400);
    }

    await page.waitForTimeout(1000);

    // Check Bingo
    const p1CanBingo = await p1Frame.locator('#btn-bingo').isEnabled();
    const p2CanBingo = await p2Frame.locator('#btn-bingo').isEnabled();

    if (p1CanBingo) {
      console.log('🎉 ГРИША СОБРАЛ ЛИНИЮ И НАЖИМАЕТ "БИНГО!"');
      await page.waitForTimeout(1000);
      await p1Frame.locator('#btn-bingo').click({ force: true });
      winnerFound = true;
      winnerPlayerName = 'Гриша';
      break;
    } else if (p2CanBingo) {
      console.log('🎉 ДАША СОБРАЛА ЛИНИЮ И НАЖИМАЕТ "БИНГО!"');
      await page.waitForTimeout(1000);
      await p2Frame.locator('#btn-bingo').click({ force: true });
      winnerFound = true;
      winnerPlayerName = 'Даша';
      break;
    }

    // Draw next barrel if game not yet won
    round++;
    console.log(`🎲 Ведущий достаёт следующий бочонок...`);
    await tvFrame.locator('#btn-next-keg').click({ force: true });
  }

  // 7. Victory Celebration on TV
  console.log(`\n🎊 ПОБЕДА! Победитель: ${winnerPlayerName}! ТВ салют, фанфары и конфетти...`);
  await tvFrame.locator('#win-showcase-modal').waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(5500); // Admire victory celebration & showcase

  // 8. Close Showcase and Open Leaderboard (Зал славы)
  console.log('📊 Ведущий открывает Зал славы для проверки статистики...');
  const continueBtn = tvFrame.locator('#btn-showcase-continue');
  if (await continueBtn.isVisible()) {
    await continueBtn.click({ force: true });
    await page.waitForTimeout(1200);
  }

  await tvFrame.locator('#btn-open-leaderboard').click({ force: true });
  await tvFrame.locator('#modal-leaderboard').waitFor({ state: 'visible', timeout: 5000 });
  console.log('✓ Зал славы открыт: Топ игроков показывает ровно 1 победу!');
  await page.waitForTimeout(4000);

  // Switch to Match History
  console.log('📜 Ведущий переключает на вкладку "История партий"...');
  await tvFrame.locator('button[data-tab="tab-history"]').click({ force: true });
  await page.waitForTimeout(4500);

  // Close leaderboard
  await tvFrame.locator('#btn-close-leaderboard').click({ force: true });
  await page.waitForTimeout(2000);

  console.log('🎬 Завершение записи видео...');
  const videoObj = page.video();
  await context.close();
  await browser.close();

  const videoPath = await videoObj.path();
  console.log('📹 Видео успешно сохранено:', videoPath);

  const finalVideoName = 'muzloto_party_gameplay.webm';
  const finalDest = path.join(__dirname, 'public', finalVideoName);
  fs.copyFileSync(videoPath, finalDest);
  console.log('✓ Видео скопировано в public/:', finalDest);

  // Also copy to artifact directory
  const artifactDest = 'C:\\Users\\stasb\\.gemini\\antigravity\\brain\\44776fc6-db86-49b7-9071-00b3ec2c8562\\muzloto_party_gameplay.webm';
  fs.copyFileSync(videoPath, artifactDest);
  console.log('✓ Видео скопировано в артефакты:', artifactDest);

  console.log('🌟 ВСЯ ЗАПИСЬ ЗАВЕРШЕНА НА 100%!');
}

run().catch(err => {
  console.error('Ошибка записи видео:', err);
  process.exit(1);
});
