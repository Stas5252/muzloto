(function () {
  'use strict';

  window.createCloudAudioCatalog = function (config) {
    const tracks = new Map();
    let expiresAt = 0;

    return {
      hasTracks() {
        return Date.now() < expiresAt && tracks.size > 0;
      },

      get(id) {
        return this.hasTracks() ? tracks.get(String(id)) || null : null;
      },

      async load(ids) {
        const response = await fetch(config.url, {
          headers: { apikey: config.key },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Cloud music request failed');

        const data = await response.json();
        const wanted = new Set(ids);
        tracks.clear();
        for (const track of data.tracks) {
          if (wanted.has(track.id)) tracks.set(track.id, track.url);
        }
        expiresAt = Date.now() + (data.expiresIn - 300) * 1000;
        return tracks.size;
      }
    };
  };
})();
