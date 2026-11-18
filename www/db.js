// Jednotné rozhraní k databázi: Firebase Realtime Database, nebo místní ukázkový režim
// (bez Firebase funguje jen mezi okny jednoho prohlížeče – na zkoušení).
import { firebaseConfig } from "./config.js";

const split = p => p.split("/").filter(Boolean);
const clone = v => v === undefined ? null : JSON.parse(JSON.stringify(v));

function localDb() {
  const KEY = "kviz-localdb";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const save = t => localStorage.setItem(KEY, JSON.stringify(t));
  const bc = "BroadcastChannel" in window ? new BroadcastChannel("kviz") : null;
  const subs = new Set();
  const fire = () => subs.forEach(s => s());
  if (bc) bc.onmessage = fire;
  window.addEventListener("storage", e => { if (e.key === KEY) fire(); });
  const getAt = (t, p) => split(p).reduce((o, k) => (o == null ? null : o[k]), t) ?? null;
  const setAt = (t, p, v) => {
    const ks = split(p); let o = t;
    ks.slice(0, -1).forEach(k => { if (typeof o[k] !== "object" || o[k] === null) o[k] = {}; o = o[k]; });
    if (v === null || v === undefined) delete o[ks.at(-1)]; else o[ks.at(-1)] = clone(v);
  };
  const changed = () => { fire(); bc && bc.postMessage(1); };
  return {
    mode: "local",
    now: () => Date.now(),
    async get(p) { return clone(getAt(load(), p)); },
    async set(p, v) { const t = load(); setAt(t, p, v); save(t); changed(); },
    async update(p, obj) { const t = load(); for (const [k, v] of Object.entries(obj)) setAt(t, p + "/" + k, v); save(t); changed(); },
    on(p, cb) {
      let last;
      const s = () => { const v = JSON.stringify(getAt(load(), p)); if (v !== last) { last = v; cb(JSON.parse(v)); } };
      subs.add(s); s(); return () => subs.delete(s);
    },
  };
}

async function firebaseDb() {
  const V = "10.12.2";
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const F = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-database.js`);
  const app = initializeApp(firebaseConfig);
  const db = F.getDatabase(app);
  let offset = 0;
  F.onValue(F.ref(db, ".info/serverTimeOffset"), s => { offset = s.val() || 0; });
  return {
    mode: "firebase",
    now: () => Date.now() + offset,
    async get(p) { return (await F.get(F.ref(db, p))).val(); },
    set: (p, v) => F.set(F.ref(db, p), v),
    update: (p, obj) => F.update(F.ref(db, p), obj),
    on(p, cb) { return F.onValue(F.ref(db, p), s => cb(s.val())); },
    onConnection(cb) { return F.onValue(F.ref(db, ".info/connected"), s => cb(!!s.val())); },
  };
}

export async function openDb() {
  // Na adrese 127.0.0.1 (zkoušení na počítači) běží vždy místní režim bez internetu.
  return firebaseConfig && location.hostname !== "127.0.0.1" ? firebaseDb() : localDb();
}
