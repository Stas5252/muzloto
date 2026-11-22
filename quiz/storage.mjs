const opened = new Promise((resolve, reject) => {
  const request = indexedDB.open('vne-ocheredi', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('drafts');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function read(key) {
  const db = await opened;
  return new Promise((resolve, reject) => {
    const request = db.transaction('drafts').objectStore('drafts').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function write(key, value) {
  const db = await opened;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite');
    tx.objectStore('drafts').put(value, key);
    tx.commit?.();
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}

export async function photoData(file) {
  if (!/^image\/(jpeg|png|webp|gif|avif|bmp|heic|heif)$/.test(file.type) || file.size > 15_000_000) {
    throw new Error('Выберите фото до 15 МБ. Подойдут JPG, PNG и WebP.');
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Фото не открылось. Попробуйте сохранить его в JPG, PNG или WebP.');
  });
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#161921';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .82);
  } finally {
    bitmap.close();
  }
}
