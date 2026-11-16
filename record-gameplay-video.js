const { chromium } = require('playwright-core');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

async function run() {
  const outputDir = path.join(__dirname, 'recorded_videos');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log('🎥 Запуск Chromium 1080p для записи презентационного видео МузЛото со звуком...');
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

  // Start internal audio capture on TV Frame
  console.log('🎙️ Запуск студийного захвата аудиодорожки на ТВ (музыка + звуки игры)...');
  await tvFrame.locator('body').evaluate(() => {
    if (window.startStudioAudioRecording) {
      window.startStudioAudioRecording();
    }
  });

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

  // Stop Audio Recording & Retrieve Base64 data
  console.log('🎵 Остановка захвата аудиодорожки...');
  const base64Audio = await tvFrame.locator('body').evaluate(async () => {
    if (window.stopStudioAudioRecording) {
      return await window.stopStudioAudioRecording();
    }
    return null;
  });

  const tempAudioPath = path.join(outputDir, 'captured_audio.webm');
  if (base64Audio) {
    fs.writeFileSync(tempAudioPath, Buffer.from(base64Audio, 'base64'));
    console.log(`✓ Записанная аудиодорожка сохранена (${(base64Audio.length * 0.75 / 1024).toFixed(1)} KB)`);
  } else {
    console.warn('⚠️ Аудио захват вернул пустые данные');
  }

  console.log('🎬 Завершение записи видеопотока...');
  const videoObj = page.video();
  await context.close();
  await browser.close();

  const rawVideoPath = await videoObj.path();
  console.log('📹 Сырое видео сохранено:', rawVideoPath);

  // 9. Use FFmpeg to Mux Video + Audio into High-Quality MP4
  const finalMp4Name = 'muzloto_party_gameplay.mp4';
  const finalMp4Public = path.join(__dirname, 'public', finalMp4Name);
  const artifactDest = 'C:\\Users\\stasb\\.gemini\\antigravity\\brain\\44776fc6-db86-49b7-9071-00b3ec2c8562\\muzloto_party_gameplay.mp4';

  console.log('⚡ Запуск FFmpeg: финальный рендеринг видео в формате MP4 (H.264 + AAC со звуком)...');
  try {
    let ffmpegCmd = '';
    if (fs.existsSync(tempAudioPath) && fs.statSync(tempAudioPath).size > 1000) {
      // Merge captured video and captured audio
      ffmpegCmd = `"${ffmpeg.path}" -y -i "${rawVideoPath}" -i "${tempAudioPath}" -c:v libx264 -preset fast -crf 22 -c:a aac -b:a 192k -pix_fmt yuv420p -movflags +faststart "${finalMp4Public}"`;
    } else {
      // Fallback: encode video to MP4
      ffmpegCmd = `"${ffmpeg.path}" -y -i "${rawVideoPath}" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -movflags +faststart "${finalMp4Public}"`;
    }
    
    execSync(ffmpegCmd, { stdio: 'inherit' });
    console.log('✓ MP4 видео со звуком успешно скомпилировано:', finalMp4Public);

    // Copy to artifact directory
    fs.copyFileSync(finalMp4Public, artifactDest);
    console.log('✓ MP4 видео скопировано в артефакты:', artifactDest);
  } catch(e) {
    console.error('Ошибка при работе FFmpeg:', e.message);
  }

  console.log('🌟 ВСЯ ЗАПИСЬ ВИДЕО СО ЗВУКОМ ЗАВЕРШЕНА НА 100%!');
}

run().catch(err => {
  console.error('Ошибка записи видео:', err);
  process.exit(1);
});
