// IndexedDB：sessions 存元数据，samples 存原始数据，列表加载不必读大数组
const DB = 'aeroear';
let dbp;

function open() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      r.result.createObjectStore('samples', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    let out;
    fn(t, (v) => (out = v));
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
  });
}

export const addSession = (meta, samples) =>
  run(['sessions', 'samples'], 'readwrite', (t, set) => {
    const r = t.objectStore('sessions').add(meta);
    r.onsuccess = () => {
      set(r.result);
      t.objectStore('samples').put({ id: r.result, samples });
    };
  });

export const listSessions = () =>
  run(['sessions'], 'readonly', (t, set) => {
    const r = t.objectStore('sessions').getAll();
    r.onsuccess = () => set(r.result.sort((a, b) => b.start - a.start));
  });

export const getSamples = (id) =>
  run(['samples'], 'readonly', (t, set) => {
    const r = t.objectStore('samples').get(id);
    r.onsuccess = () => set(r.result ? r.result.samples : []);
  });

export const deleteSession = (id) =>
  run(['sessions', 'samples'], 'readwrite', (t) => {
    t.objectStore('sessions').delete(id);
    t.objectStore('samples').delete(id);
  });

export const clearAll = () =>
  run(['sessions', 'samples'], 'readwrite', (t) => {
    t.objectStore('sessions').clear();
    t.objectStore('samples').clear();
  });
