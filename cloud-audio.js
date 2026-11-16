(function () {
  'use strict';

  window.createCloudAudioCatalog = function (config, hostKey) {
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
          method: 'POST',
          headers: { apikey: config.key, 'x-muzloto-key': hostKey },
          cache: 'no-store',
        });
        if (!response.ok) {
          const error = new Error('Cloud music request failed');
          error.status = response.status;
          throw error;
        }

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
