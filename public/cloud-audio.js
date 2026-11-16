(function () {
  'use strict';

  const lifetime = 2 * 60 * 60;
  const refreshBefore = 5 * 60 * 1000;

  window.createCloudAudioCatalog = function (client) {
    const bucket = client.storage.from('muzloto-audio');
    const urls = new Map();
    let version = 0;

    return {
      clear() {
        version++;
        urls.clear();
      },

      get(id) {
        const entry = urls.get(String(id));
        return entry && entry.expiresAt > Date.now() ? entry.url : null;
      },

      async load(ids) {
        const requestVersion = version;
        const paths = Array.from(new Set(ids.map(String)))
          .filter(id => /^\d+$/.test(id))
          .map(id => id + '.mp3');
        if (!paths.length) return 0;

        const expiresAt = Date.now() + lifetime * 1000 - refreshBefore;
        const { data, error } = await bucket.createSignedUrls(paths, lifetime);
        if (requestVersion !== version) return 0;
        if (error) throw error;

        let count = 0;
        for (const entry of data || []) {
          if (entry.error || !entry.signedUrl) continue;
          urls.set(entry.path.slice(0, -4), { url: entry.signedUrl, expiresAt });
          count++;
        }
        return count;
      }
    };
  };
})();
