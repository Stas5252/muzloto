(function () {
  'use strict';

  window.createCloudAudioCatalog = function (config) {
    const tracks = new Map();
    let ownPacks = [];
    let expiresAt = 0;

    const request = url => fetch(url, { headers: { apikey: config.key }, cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error('Cloud music request failed');
      return response.json();
    });

    return {
      hasTracks() {
        return Date.now() < expiresAt && tracks.size > 0;
      },

      get(id) {
        return this.hasTracks() ? tracks.get(String(id)) || null : null;
      },

      // Packs the owner uploaded on the "Своя музыка" page.
      ownPacks() {
        return ownPacks;
      },

      async load(ids) {
        // The owner's packs are optional: the built-in recordings must play even when that request fails.
        const [data, own] = await Promise.all([
          request(config.url),
          config.ownUrl ? request(config.ownUrl).catch(() => null) : null
        ]);
        const wanted = new Set(ids);
        tracks.clear();
        for (const track of data.tracks) {
          if (wanted.has(track.id)) tracks.set(track.id, track.url);
        }
        if (own) {
          for (const track of own.tracks) tracks.set(track.id, track.url);
          ownPacks = own.packs;
        }
        expiresAt = Date.now() + (Math.min(data.expiresIn, own?.expiresIn ?? Infinity) - 300) * 1000;
        return tracks.size;
      }
    };
  };
})();
