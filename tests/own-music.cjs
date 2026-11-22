// The owner's music function against an in-memory bucket: catalogue, password, upload links, save and delete.
const assert = require('node:assert/strict');

const memoryBucket = require('./own-music-bucket.cjs');

(async () => {
  const { handle } = await import('../supabase/functions/muzloto-own-music/music.ts');
  const bucket = memoryBucket();
  const password = 'party-password';
  const url = 'https://project.test/functions/v1/muzloto-own-music';
  const get = async () => { const r = await handle(new Request(url), bucket, password); return [r.status, await r.json()]; };
  const post = async (body, key = password) => {
    const r = await handle(new Request(url, { method: 'POST', headers: { 'x-muzloto-key': key }, body: JSON.stringify(body) }), bucket, password);
    return [r.status, await r.json()];
  };
  const pack = 'p0123456789ab';
  const tracks = Array.from({ length: 3 }, (_, i) => ({
    id: 'u' + String(i).padStart(16, '0'), ext: i ? 'mp3' : 'm4a', artist: '  Тимати ', title: 'Трек ' + i,
    art: i ? '' : 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/cover.jpg/400x400bb.jpg'
  }));

  assert.deepEqual(await get(), [200, { expiresIn: 7200, tracks: [], packs: [] }], 'An empty bucket is an empty catalogue');
  assert.equal((await post({ action: 'check' }, 'wrong-password'))[0], 403);
  assert.equal((await post({ action: 'check' }))[0], 200);
  assert.equal((await post({ action: 'check' }, '%E0%A4%A'))[0], 403, 'A broken header is a wrong password');
  const cyrillic = new Request(url, { method: 'POST', headers: { 'x-muzloto-key': encodeURIComponent('пароль вечеринки') }, body: '{"action":"check"}' });
  assert.equal((await handle(cyrillic, bucket, 'пароль вечеринки')).status, 200, 'A Cyrillic password is accepted');
  const r = await handle(new Request(url, { method: 'POST', headers: { 'x-muzloto-key': password }, body: '{}' }), bucket, undefined);
  assert.equal(r.status, 403, 'No configured password means nobody is the owner');
  assert.equal((await handle(new Request(url, { method: 'POST', headers: { 'x-muzloto-key': 'short' }, body: '{}' }), bucket, 'short')).status, 403);

  assert.equal((await post({ action: 'upload', pack: '../x', track: tracks[0].id, ext: 'mp3' }))[0], 400);
  assert.equal((await post({ action: 'upload', pack, track: tracks[0].id, ext: 'exe' }))[0], 400);
  assert.deepEqual(await post({ action: 'upload', pack, track: tracks[0].id, ext: 'm4a' }),
    [200, { url: `https://storage.test/upload/own/${pack}/${tracks[0].id}.m4a` }]);

  const saved = await post({ action: 'save', pack: { id: pack, title: 'Плейлист', tracks } });
  assert.equal(saved[0], 409, 'A pack cannot list recordings that were not uploaded');
  assert.deepEqual(saved[1].missing, tracks.map(track => track.id));
  for (const track of tracks) bucket.files.set(`own/${pack}/${track.id}.${track.ext}`, Buffer.from('audio'));
  bucket.files.set(`own/${pack}/u9999999999999999.mp3`, Buffer.from('left over'));
  assert.equal((await post({ action: 'save', pack: { id: pack, title: '', tracks } }))[0], 400);
  assert.equal((await post({ action: 'save', pack: { id: pack, title: 'x', tracks: [{ ...tracks[0], art: 'https://evil.test/a.jpg' }] } }))[0], 400);
  assert.equal((await post({ action: 'save', pack: { id: pack, title: 'x', tracks: [tracks[0], tracks[0]] } }))[0], 400);
  assert.deepEqual(await post({ action: 'save', pack: { id: pack, title: ' Плейлист  компании ', tracks } }), [200, { ok: true }]);
  assert.ok(!bucket.files.has(`own/${pack}/u9999999999999999.mp3`), 'Recordings dropped from the pack are removed');

  let [status, catalogue] = await get();
  assert.equal(status, 200);
  assert.equal(catalogue.packs.length, 1);
  assert.equal(catalogue.packs[0].title, 'Плейлист компании');
  assert.equal(catalogue.packs[0].tracks[0].artist, 'Тимати');
  assert.deepEqual(catalogue.tracks.map(track => track.id), tracks.map(track => track.id));
  assert.equal(catalogue.tracks[0].url, `https://storage.test/sign/own/${pack}/${tracks[0].id}.m4a`);

  // Saving again replaces the pack; a second pack is added next to it.
  assert.equal((await post({ action: 'save', pack: { id: pack, title: 'Короче', tracks: tracks.slice(1) } }))[0], 200);
  const other = 'pabcdefabcdef';
  bucket.files.set(`own/${other}/${tracks[0].id}.m4a`, Buffer.from('audio'));
  assert.equal((await post({ action: 'save', pack: { id: other, title: 'Второй', tracks: [tracks[0]] } }))[0], 200);
  [status, catalogue] = await get();
  assert.deepEqual(catalogue.packs.map(item => [item.title, item.tracks.length]), [['Короче', 2], ['Второй', 1]]);
  assert.ok(!bucket.files.has(`own/${pack}/${tracks[0].id}.m4a`));

  // A storage failure must not replace the catalogue with an empty one.
  bucket.fail(true);
  assert.equal((await get())[0], 502);
  assert.equal((await post({ action: 'save', pack: { id: pack, title: 'Короче', tracks: tracks.slice(1) } }))[0], 502);
  assert.equal((await post({ action: 'delete', id: other }))[0], 502);
  bucket.fail(false);
  assert.equal((await get())[1].packs.length, 2);

  assert.equal((await post({ action: 'delete', id: 'nope' }))[0], 400);
  assert.deepEqual(await post({ action: 'delete', id: pack }), [200, { ok: true }]);
  [status, catalogue] = await get();
  assert.deepEqual(catalogue.packs.map(item => item.title), ['Второй']);
  assert.deepEqual([...bucket.files.keys()].sort(), ['own/index.json', `own/${other}/${tracks[0].id}.m4a`]);
  assert.equal((await handle(new Request(url, { method: 'PUT' }), bucket, password)).status, 405);
  console.log('PASS: owner music catalogue, password, upload links, save, replace and delete');
})().catch(error => { console.error(error); process.exit(1); });

// The host's catalogue: a failed refresh of the owner's packs keeps their links while they are valid.
(async () => {
  global.window = {};
  require('../cloud-audio.js');
  const realFetch = global.fetch;
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  let ownFails = false;
  global.fetch = async url => {
    if (String(url).endsWith('/own')) {
      if (ownFails) throw new TypeError('offline');
      return Response.json({ expiresIn: 7200, packs: [{ id: 'p1', title: 'Свой', tracks: [] }], tracks: [{ id: 'u1', url: 'https://storage.test/u1' }] });
    }
    return Response.json({ expiresIn: 7200, tracks: [{ id: '1', url: 'https://storage.test/1' }, { id: '2', url: 'https://storage.test/2' }] });
  };
  try {
    const catalogue = window.createCloudAudioCatalog({ url: 'https://cloud.test/game', ownUrl: 'https://cloud.test/own', key: 'k' });
    assert.equal(await catalogue.load(['1']), 2);
    assert.equal(catalogue.get('u1'), 'https://storage.test/u1');
    assert.equal(catalogue.get('2'), null, 'Built-in recordings of other packs are not kept');
    ownFails = true;
    now += 3600 * 1000;
    assert.equal(await catalogue.load(['1']), 2);
    assert.equal(catalogue.get('u1'), 'https://storage.test/u1', 'Links that are still valid survive a failed refresh');
    assert.equal(catalogue.ownPacks().length, 1);
    now += 3301 * 1000;
    assert.equal(catalogue.hasTracks(), false, 'The catalogue asks again when the kept links run out');
    assert.equal(await catalogue.load(['1']), 1);
    assert.equal(catalogue.get('u1'), null);
    assert.equal(catalogue.get('1'), 'https://storage.test/1');
    const plain = window.createCloudAudioCatalog({ url: 'https://cloud.test/game', key: 'k' });
    assert.equal(await plain.load(['1', '2']), 2);
    assert.deepEqual(plain.ownPacks(), []);
    console.log('PASS: host catalogue keeps valid owner links through a failed refresh');
  } finally {
    global.fetch = realFetch;
    Date.now = realNow;
  }
})().catch(error => { console.error(error); process.exit(1); });
