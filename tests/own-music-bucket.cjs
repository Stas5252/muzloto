// In-memory stand-in for the Supabase Storage bucket used by the owner's music function.
module.exports = function memoryBucket() {
  const files = new Map();
  let broken = false;
  let keeps = false;
  return {
    files,
    fail(value) { broken = value; },
    failRemove(value) { keeps = value; },
    async list(path, options = {}) {
      if (broken) return { data: null, error: new Error('down') };
      const prefix = path + '/';
      const names = [...files.keys()].filter(name => name.startsWith(prefix) && !name.slice(prefix.length).includes('/'))
        .map(name => name.slice(prefix.length)).filter(name => !options.search || name.startsWith(options.search));
      return { data: names.map(name => ({ name, id: 'id-' + name })), error: null };
    },
    async download(path) {
      if (broken || !files.has(path)) return { data: null, error: new Error('missing') };
      return { data: new Blob([files.get(path)]), error: null };
    },
    async upload(path, body) {
      if (broken) return { error: new Error('down') };
      files.set(path, Buffer.from(await body.arrayBuffer()));
      return { error: null };
    },
    async remove(paths) {
      if (keeps) return { data: null, error: new Error('down') };
      for (const path of paths) files.delete(path);
      return { data: [], error: null };
    },
    async createSignedUrls(paths) {
      return { data: paths.map(path => files.has(path)
        ? { path, signedUrl: 'https://storage.test/sign/' + path, error: null } : { path, signedUrl: null, error: 'missing' }), error: null };
    },
    async createSignedUploadUrl(path) { return { data: { signedUrl: 'https://storage.test/upload/' + path }, error: null }; }
  };
};
