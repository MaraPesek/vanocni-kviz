import { openDb } from "./db.js";
import { ROUNDS } from "./questions.js";
import { PLAYER_URL } from "./config.js";
import { BUILT } from "./version.js";

/* ---------- pomocné ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SYMS = ["▲", "◆", "●", "■"], LET = "ABCD";
const qT = q => q.type || "abcd";
const norm = x => String(x).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const aTxt = a => typeof a === "string" ? a : a.t;
const aThumb = a => typeof a === "string" ? esc(a) : `<img class="th" src="${esc(a.img)}" alt="">${esc(a.t)}`;
const TLBL = { abcd: "A/B/C/D", text: "vlastní text", num: "číslo s tolerancí" };
const TIMES = [[30, "30 sekund"], [60, "1 minuta"], [180, "3 minuty"], [300, "5 minut"], [0, "bez limitu"]];
const qk = i => "q" + i;
const rid = () => Math.random().toString(36).slice(2, 10);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem("kviz-" + k)); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem("kviz-" + k) : localStorage.setItem("kviz-" + k, JSON.stringify(v)); } catch {} },
};
function ptsFor(q, a) {
  if (a == null) return 0;
  const t = qT(q);
  if (t === "abcd") return a === q.ok ? 1 : 0;
  if (t === "text") return q.acc.some(x => norm(x) === norm(a)) ? 1 : 0;
  const n = +a; return n === q.num ? 2 : Math.abs(n - q.num) <= (q.tol || 0) ? 1 : 0;
}
const okTxt = q => qT(q) === "abcd" ? aTxt(q.a[q.ok]) : qT(q) === "text" ? q.acc[0] : String(q.num);
const ansTxt = (q, a) => a == null ? "– bez odpovědi –" : qT(q) === "abcd" ? aTxt(q.a[a]) : String(a);
const fT = x => { x = Math.round((x || 0) * 10) / 10; const m = Math.floor(x / 60), c = v => String(v).replace(".", ","); return m ? m + " min " + c(Math.round((x - m * 60) * 10) / 10) + " s" : c(x) + " s"; };

/* ---------- zvuk ---------- */
const TUNES = { jingle: [[64, 1], [64, 1], [64, 2], [64, 1], [64, 1], [64, 2], [64, 1], [67, 1], [60, 1.5], [62, .5], [64, 4]] };
let actx, curAudio;
function playAudio(src) {
  try {
    if (curAudio) { curAudio.pause(); curAudio = null; }
    if (src.startsWith("tune:")) {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      let t = actx.currentTime + .05; const b = .28;
      for (const [n, d] of TUNES[src.slice(5)] || []) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = "triangle"; o.frequency.value = 440 * Math.pow(2, (n - 69) / 12);
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.3, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + d * b * .95);
        o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d * b); t += d * b;
      }
    } else { curAudio = new Audio(src); curAudio.play().catch(() => {}); }
  } catch {}
}

/* ---------- stav ---------- */
let db;
const L = { view: "home", code: null, tid: null, isHost: false };  // místní stav
let Q = null, unsub = null;                                         // kvíz z databáze
let extra = store.get("extra") || [];                              // otázky přidané pořadatelem
let quizName = store.get("name") || "Vánoční kvíz";
let TIME = store.get("time") ?? 30;
let online = true;

function buildQuiz() {
  const names = ROUNDS.map(r => r.name);
  extra.forEach(q => { if (q.round && !names.includes(q.round)) names.push(q.round); });
  const qs = [], rounds = [];
  names.forEach(n => {
    const base = ((ROUNDS.find(r => r.name === n) || {}).questions || []).map(q => ({ ...q, round: n }));
    const ex = extra.map((q, ei) => ({ ...q, ei })).filter(q => (q.round || names[0]) === n);
    const all = [...base, ...ex]; if (!all.length) return;
    rounds.push({ name: n, start: qs.length, count: all.length }); qs.push(...all);
  });
  return { qs, rounds };
}
const questions = () => (Q && Q.questions) || buildQuiz().qs;
const rounds = () => (Q && Q.rounds) || buildQuiz().rounds;
const roundOf = i => rounds().findIndex(r => i >= r.start && i < r.start + r.count);
const GAP = 3000;
const teams = () => Object.entries((Q && Q.teams) || {}).filter(([, t]) => !t.kicked);
const answersOf = i => (Q && Q.answers && Q.answers[qk(i)]) || {};
const resultsOf = i => (Q && Q.results && Q.results[qk(i)]) || null;
function totals() {
  const sc = {}, tm = {};
  teams().forEach(([id]) => { sc[id] = 0; tm[id] = 0; });
  questions().forEach((q, i) => {
    const r = resultsOf(i); if (!r) return;
    const an = answersOf(i);
    for (const [id, p] of Object.entries(r)) { if (!(id in sc)) continue; sc[id] += p; if (p > 0 && an[id]) tm[id] += an[id].t; }
  });
  return { sc, tm };
}
function ranking() {
  const { sc, tm } = totals();
  return teams().map(([id, t]) => ({ id, name: t.name, members: t.members || [], s: sc[id], t: tm[id] })).sort((a, b) => b.s - a.s || a.t - b.t);
}
function timeLeft() {
  if (!Q || !Q.qEnd || Q.state !== "question") return null;
  return Math.max(0, Math.ceil((Q.qEnd - db.now()) / 1000));
}
const inGap = () => !!(Q && Q.state === "question" && Q.qEnd && db.now() >= Q.qEnd);
const gapLeft = () => Math.max(1, Math.ceil((Q.qEnd + GAP - db.now()) / 1000));
const lastInRound = () => { const r = rounds()[roundOf(Q.qi)]; return !r || Q.qi >= r.start + r.count - 1; };
function tLbl() {
  if (inGap()) return "⌛ čas vypršel";
  if (!Q.qEnd) return "⏱ bez limitu";
  const s = timeLeft() ?? 0, m = Math.floor(s / 60), x = s % 60;
  return "⏱ " + (m ? m + ":" + String(x).padStart(2, "0") : x + " s");
}

/* ---------- databáze ---------- */
function watch(code) {
  if (unsub) unsub();
  L.code = code;
  unsub = db.on("quizzes/" + code, v => { Q = v; onQuiz(); render(); });
}
function onQuiz() {
  if (!Q) return;
  if (!L.isHost && L.tid && Q.teams && Q.teams[L.tid] && Q.teams[L.tid].kicked) {
    store.set("player", null); L.tid = null; L.view = "player-join"; L.err = "Pořadatel tvůj tým odpojil. Můžete se přihlásit znovu.";
  }
  if (Q.state !== "final") { L.sel = null; L.statP = null; }
  if (Q.state !== "question") advancing = null;
  if (Q.qi !== L.lastQi) { L.lastQi = Q.qi; L.ansDraft = ""; L.ansErr = ""; }
}
async function newCode() {
  for (let i = 0; i < 20; i++) {
    const c = "KVIZ-" + String(Math.floor(1000 + Math.random() * 9000));
    if (!(await db.get("quizzes/" + c + "/createdAt"))) return c;
  }
  return "KVIZ-" + rid().slice(0, 6).toUpperCase();
}

/* ---------- pořadatel: akce ---------- */
async function createQuiz() {
  const code = await newCode(), pin = String(Math.floor(1000 + Math.random() * 9000));
  const { qs, rounds: rs } = buildQuiz();
  await db.set("quizzes/" + code, { name: quizName, pin, time: TIME, createdAt: db.now(), questions: qs.map(({ ei, ...q }) => q), rounds: rs, state: "lobby", qi: -1, ri: -1 });
  L.isHost = true; store.set("host", code); L.view = "host"; watch(code);
}
const qTimes = () => { const n = db.now(); return { qStart: n, qEnd: Q.time ? n + Q.time * 1000 : null }; };
const toIntro = ri => db.update("quizzes/" + L.code, { state: "intro", ri });
const startRound = () => db.update("quizzes/" + L.code, { state: "question", qi: rounds()[Q.ri].start, ...qTimes() });
const endQuestion = () => db.update("quizzes/" + L.code, { qEnd: db.now() });
let advancing = null;
async function advance() {
  if (!Q || Q.state !== "question" || advancing === Q.qi) return;
  const qi = Q.qi; advancing = qi;
  const q = questions()[qi], an = answersOf(qi), res = {};
  teams().forEach(([id]) => { res[id] = ptsFor(q, an[id] ? an[id].a : null); });
  const upd = { ["results/" + qk(qi)]: res };
  if (lastInRound()) upd.state = "roundEnd"; else Object.assign(upd, { qi: qi + 1, ...qTimes() });
  try { await db.update("quizzes/" + L.code, upd); } catch { advancing = null; }
}
let wake = null;
async function keepAwake(on) {
  try {
    if (on && !wake && navigator.wakeLock) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { wake = null; }); }
    if (!on && wake) { await wake.release(); wake = null; }
  } catch {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && L.isHost && L.view === "host") keepAwake(true); });

/* ---------- hráč: akce ---------- */
async function answer(a) {
  if (!Q || Q.state !== "question" || answersOf(Q.qi)[L.tid]) return;
  if (Q.qEnd && db.now() >= Q.qEnd) return;
  const t = Math.round((db.now() - Q.qStart) / 100) / 10;
  await db.set(`quizzes/${L.code}/answers/${qk(Q.qi)}/${L.tid}`, { a, t: Math.max(0, t) });
}

/* ---------- obrázky a nahrávky od pořadatele ---------- */
function readImage(file, max = 900) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", .75));
      };
      img.onerror = rej; img.src = fr.result;
    };
    fr.onerror = rej; fr.readAsDataURL(file);
  });
}
function readAudio(file) {
  return new Promise((res, rej) => {
    if (file.size > 3 * 1024 * 1024) return rej(new Error("big"));
    const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file);
  });
}

/* ---------- šablony ---------- */
const bar = (t, s = "", back = "home") => `<div class="bar"><button class="homeb" data-back="${back}">‹ Zpět</button><span class="bt">${t}</span><small>${s}</small></div>`;
function media(q, who) {
  let h = "";
  if (q.img) h += `<img class="qimg" src="${esc(q.img)}" alt="Obrázek k otázce">`;
  if (q.audio) h += who === "host"
    ? `<button class="btn play" data-play="cur">▶ Přehrát nahrávku</button><div class="muted center">Pusť ji nahlas, ať ji slyší všichni.</div>`
    : `<div class="card center">🎧 <b>Poslouchej nahrávku</b><div class="muted">Hraje z telefonu pořadatele.</div><button class="mini" data-play="cur" style="margin-top:6px">▶ Pustit si ji i u sebe</button></div>`;
  return h;
}
function qrSvg(text) {
  try { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
  catch { return `<div class="center" style="padding:60px 0">QR kód se nenačetl.<br>Použijte kód níže.</div>`; }
}
const joinUrl = () => (db.mode === "local" ? location.origin + location.pathname : PLAYER_URL) + "?k=" + L.code;

function homeView() {
  const h = store.get("host"), p = store.get("player");
  return `<div class="snow"></div><div class="home"><div class="hlogo">🎄</div><div class="xmas">Vánoční kvíz</div><p class="sub">Šelmy ze stavebáku</p>
  <button class="btn hbig" id="mHost"><span>🎅</span>Vytvořit kvíz<small>Jsem pořadatel, budu posílat otázky</small></button>
  <button class="btn hbig red" id="mPlay"><span>🎁</span>Připojit se<small>Přihlásím tým a hrajeme</small></button>
  ${h ? `<button class="btn sec" id="resumeHost">↩ Pokračovat v řízení kvízu ${esc(h)}</button>` : ""}
  ${p ? `<button class="btn sec" id="resumePlay">↩ Vrátit se do kvízu ${esc(p.code)}</button>` : ""}
  ${db.mode === "local" ? `<div class="muted center" style="font-size:12px">Zkušební režim bez internetu: funguje jen mezi okny tohoto prohlížeče.</div>` : ""}</div>
  <button class="upd ${L.newer ? "new" : ""}" id="upd">${L.updating ? "⏳ Aktualizuji…" : L.newer ? "🔔 Je k dispozici nová verze, ťukni pro aktualizaci" : "🔄 Aktualizovat"}<small>Poslední aktualizace: ${fmtBuilt(BUILT)}</small></button>`;
}

function hostCreateView() {
  const { qs, rounds: rs } = buildQuiz();
  return bar("🎄 Nový kvíz") + `<div class="body">
  <div><label>Název kvízu</label><input id="qn" value="${esc(quizName)}"></div>
  <div class="card"><label>Okruhy a otázky (${rs.length} okruhy, ${qs.length} otázek)</label>
   <div class="qlist">${rs.map((r, ri) => `<div class="rhead">Okruh ${ri + 1}: ${esc(r.name)} <small>· ${r.count} ${r.count === 1 ? "otázka" : r.count < 5 ? "otázky" : "otázek"}</small></div>` + qs.slice(r.start, r.start + r.count).map((q, k) => `<div class="qli"><b>${k + 1}.</b><span>${esc(q.q)}<small>${esc(q.cat)}${q.img ? " · 🖼️" : ""}${q.audio ? " · 🎵" : ""} · ${TLBL[qT(q)]}${q.mine ? " · přidaná" : " · připravená"}</small></span>${q.mine ? `<button class="mini warn" data-delq="${q.ei}">Smazat</button>` : ""}</div>`).join("")).join("")}</div>
   <button class="btn sec" id="addQ" style="margin-top:10px">＋ Přidat otázku</button></div>
  <div><label>Čas na odpověď</label><select id="tsel">${TIMES.map(([v, l]) => `<option value="${v}" ${TIME === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
  <div class="card muted">Otázky v okruhu běží samy: každá trvá celý čas a 3 s po jeho konci naskočí další. Správné odpovědi se ukážou až na konci okruhu.</div>
  <div class="card muted">Bodování: správně = 1 bod (číslo přesně 2 body, v toleranci 1 bod). Špatně = 0, nic se neodečítá. Při shodě bodů rozhoduje součet časů správných odpovědí.</div>
  </div><div class="foot"><button class="btn" id="create">Založit kvíz a ukázat QR 🎁</button></div>`;
}

function addqView() {
  const d = L.draft;
  return bar("＋ Nová otázka", "", "host-create") + `<div class="body">
  <div><label>Okruh</label><select id="dRound">${buildQuiz().rounds.map(r => `<option ${d.round === r.name ? "selected" : ""}>${esc(r.name)}</option>`).join("")}<option value="__new" ${d.round === "__new" ? "selected" : ""}>＋ Nový okruh…</option></select>
   ${d.round === "__new" ? `<input id="dNewR" value="${esc(d.newR)}" placeholder="Název nového okruhu" style="margin-top:6px">` : ""}</div>
  <div><label>Kategorie (štítek u otázky)</label><input id="dCat" value="${esc(d.cat)}" placeholder="např. 🎄 Vánoce"></div>
  <div class="g2"><label class="att">${d.qimg ? `<img src="${d.qimg}">` : "🖼️"}<span>${d.qimg ? "Obrázek přidán" : "Přidat obrázek k otázce"}</span><input type="file" accept="image/*" data-dqf="qimg" hidden></label>
   <label class="att">${d.audio ? "🎵" : "🎤"}<span>${d.audio ? "Nahrávka přidána" : "Přidat nahrávku (písnička, film)"}</span><input type="file" accept="audio/*" data-dqf="audio" hidden></label></div>
  ${d.qimg || d.audio ? `<div class="row" style="gap:6px">${d.audio ? '<button class="mini" data-play="draft">▶ Přehrát</button>' : ""}${d.qimg ? '<button class="mini warn" data-rmq="qimg">Odebrat obrázek</button>' : ""}${d.audio ? '<button class="mini warn" data-rmq="audio">Odebrat nahrávku</button>' : ""}</div>` : ""}
  <div><label>Otázka</label><input id="dQ" value="${esc(d.q)}" placeholder="Napiš otázku…"></div>
  <div><label>Typ odpovědi</label><div class="tseg">${["abcd", "text", "num"].map(x => `<button data-dt="${x}" class="${d.type === x ? "on" : ""}">${{ abcd: "A/B/C/D", text: "✍️ Text", num: "🔢 Číslo" }[x]}</button>`).join("")}</div></div>
  ${d.type === "text" ? `<div><label>Uznávané odpovědi (oddělené čárkou)</label><input id="dAcc" value="${esc(d.acc)}" placeholder="např. Děda Mráz, Ded Moroz"><div class="muted" style="margin-top:4px">Na velikosti písmen a háčcích nezáleží. Pořadatel může odpověď uznat i ručně.</div></div>`
      : d.type === "num" ? `<div class="g2"><div><label>Správné číslo</label><input id="dNum" type="number" value="${esc(d.num)}" placeholder="např. 1990"></div><div><label>Tolerance ±</label><input id="dTol" type="number" value="${esc(d.tol)}"></div></div><div class="muted">Přesně = 2 body, v toleranci = 1 bod, jinak 0.</div>`
      : `<label>Odpovědi · ťukni na ✓ u té správné</label>
  ${[0, 1, 2, 3].map(i => `<div class="arow"><span class="tag ${LET[i]}">${SYMS[i]}</span><input data-da="${i}" value="${esc(d.a[i])}" placeholder="Odpověď ${i + 1}">
   <label class="ph" title="Přidat fotku">${d.img[i] ? `<img src="${d.img[i]}">` : "📷"}<input type="file" accept="image/*" data-df="${i}" hidden></label>
   <button class="okb ${d.ok === i ? "on" : ""}" data-dok="${i}">✓</button></div>`).join("")}
  <div class="muted">📷 = přidat k odpovědi fotku (z galerie nebo foťáku).</div>`}
  <div class="err">${esc(L.dErr || "")}</div>
  </div><div class="foot"><button class="btn" id="saveQ">Uložit otázku</button></div>`;
}

function statsHtml(id) {
  const qs = questions(), tm = Q.teams[id] || { members: [] }, { sc, tm: tt } = totals();
  const pts = i => (resultsOf(i) || {})[id] || 0;
  const ok = qs.filter((q, i) => pts(i) > 0).length;
  let det = "";
  if (L.sel != null && qs[L.sel]) {
    const q = qs[L.sel], x = answersOf(L.sel)[id], p = pts(L.sel);
    det = `<div class="card qdet ${p > 0 ? "g" : "r"}"><div class="row" style="justify-content:space-between"><b>Otázka ${L.sel + 1}</b><span class="cat">${esc(q.cat)}</span></div>
    <div class="q" style="font-size:16px;margin:6px 0">${esc(q.q)}</div>${q.img ? `<img class="qimg" src="${esc(q.img)}" alt="">` : ""}${q.audio ? `<button class="mini" data-play="${L.sel}">▶ Přehrát nahrávku</button>` : ""}
    <div class="kv"><span>Vaše odpověď</span><b>${esc(ansTxt(q, x ? x.a : null))}</b></div>
    <div class="kv"><span>Správně</span><b>${esc(okTxt(q))}${qT(q) === "num" ? ` (±${q.tol})` : ""}</b></div>
    <div class="kv"><span>Body</span><b>${p}${p > 0 && x ? ` · ⏱ ${fT(x.t)}` : ""}</b></div></div>`;
  }
  return `<div class="card"><div class="muted" style="margin-bottom:8px">👥 ${esc((tm.members || []).join(", "))}</div><div class="stats"><div><b class="okc">${ok}</b><small>dobře</small></div><div><b class="badc">${qs.length - ok}</b><small>špatně</small></div><div><b>${sc[id] || 0}</b><small>bodů</small></div><div><b style="font-size:18px">${fT(tt[id])}</b><small>čas správných</small></div></div>
  <div class="muted" style="margin:10px 0 6px">Ťukni na číslo otázky:</div><div class="qnums">${qs.map((q, i) => `<button data-qn="${i}" class="${pts(i) > 0 ? "g" : "r"} ${L.sel === i ? "sel" : ""}">${i + 1}</button>`).join("")}</div></div>${det}`;
}
const lbRow = (r, i) => `<div class="row ${r.id === L.tid ? "me" : ""}"><b>${i + 1}.</b><span>${esc(r.name)}</span><span class="sc">${r.s} b.<small>⏱ ${fT(r.t)}</small></span></div>`;

const plural = n => n === 1 ? "otázka" : n > 1 && n < 5 ? "otázky" : "otázek";
const tName = v => (TIMES.find(([x]) => x === v) || [0, "bez limitu"])[1];
function introHtml(who) {
  const rs = rounds(), r = rs[Q.ri];
  return `<div class="intro"><div class="rk">Okruh ${Q.ri + 1} z ${rs.length}</div><div class="rn">${esc(r.name)}</div>
    <b>${r.count} ${plural(r.count)}</b><div class="muted">Čas na otázku: ${tName(Q.time)}</div>
    ${who === "host" ? `<div class="muted" style="margin-top:10px">Otázky pak poběží samy. Správné odpovědi se ukážou na konci okruhu.</div>` : `<p class="muted" style="margin-top:10px">Čekáme, až pořadatel okruh spustí… 🔔</p>`}</div>`;
}
function gapHtml() {
  return `<div class="card gap"><b style="font-size:20px">⌛ Čas vypršel</b><div class="muted" style="margin:6px 0">${lastInRound() ? "Konec okruhu za" : "Další otázka za"}</div><div class="n">${gapLeft()}</div></div>`;
}
// souhrn okruhu: pro tým (id) nebo pro pořadatele (id = null)
function roundSummary(id) {
  const r = rounds()[Q.ri], qs = questions();
  return qs.slice(r.start, r.start + r.count).map((q, k) => {
    const i = r.start + k, an = answersOf(i), res = resultsOf(i) || {};
    if (id) {
      const x = an[id], p = res[id] || 0;
      return `<div class="card rq ${p > 0 ? "g" : "r"}"><div class="muted">Otázka ${k + 1}</div><div class="qq">${esc(q.q)}</div>
        <div class="kv"><span>Vaše odpověď</span><b>${esc(ansTxt(q, x ? x.a : null))}</b></div>
        <div class="kv"><span>Správně</span><b>${esc(okTxt(q))}${qT(q) === "num" ? ` (±${q.tol})` : ""}</b></div>
        <div class="kv"><span>Body</span><b>${p > 0 ? "✅ " : "❌ "}${p}</b></div></div>`;
    }
    const rows = teams().map(([tid, t]) => ({ tid, name: t.name, a: an[tid] ? an[tid].a : null, p: res[tid] || 0 }));
    if (qT(q) === "num") rows.sort((x, y) => (x.a == null) - (y.a == null) || Math.abs(x.a - q.num) - Math.abs(y.a - q.num));
    return `<div class="card rq"><div class="muted">Otázka ${k + 1}</div><div class="qq">${esc(q.q)}</div>
      <div class="kv"><span>Správně</span><b>${esc(okTxt(q))}${qT(q) === "num" ? ` (±${q.tol})` : ""}</b></div>
      ${qT(q) === "text" ? '<div class="muted" style="font-size:12px">Ťuknutím na body můžeš odpověď uznat nebo neuznat.</div>' : ""}
      <div class="list">${rows.map(x => `<div class="row"><span style="flex:1">${esc(x.name)}: <b>${esc(ansTxt(q, x.a))}</b></span>${qT(q) === "text" && x.a != null ? `<button class="mini ${x.p ? "okp" : ""}" data-tog="${i}:${x.tid}">${x.p ? "✓ 1 bod" : "✗ 0"}</button>` : `<span class="ptb pt${x.p}">${x.p} b.</span>`}</div>`).join("") || '<span class="muted">Žádné týmy.</span>'}</div></div>`;
  }).join("");
}

function hostView() {
  if (!Q) return bar("Načítám…") + `<div class="body"><div class="center muted">Připojuji se ke kvízu…</div></div>`;
  const qs = questions(), rs = rounds(), q = qs[Q.qi], n = teams().length;
  switch (Q.state) {
    case "lobby": return bar(esc(Q.name), "čekárna") + `<div class="body">
      <div class="center muted">Naskenujte QR kód foťákem</div><div class="qrbox">${qrSvg(joinUrl())}</div>
      <div class="center muted">nebo otevřete ${esc((db.mode === "local" ? "" : PLAYER_URL.replace(/^https?:\/\//, "")))} a zadejte kód</div><div class="code">${esc(L.code)}</div>
      <div class="pinrow">PIN pořadatele: <b>${L.pinShow ? esc(Q.pin) : "••••"}</b><button class="mini" id="pinT">${L.pinShow ? "Skrýt" : "Ukázat"}</button></div>
      <div class="card"><b>Přihlášené týmy: ${n}</b><div style="margin-top:6px">${teams().map(([id, t]) => `<div class="dev"><span>👥 ${esc(t.name)}<small class="mem">${esc((t.members || []).join(", "))}</small></span>${L.unpair === id ? `<button class="mini warn" data-un="${id}">Opravdu odpojit?</button>` : `<span class="pill">Připojeno</span><button class="mini" data-ask="${id}">Odpojit</button>`}</div>`).join("") || '<span class="muted">zatím nikdo…</span>'}</div></div>
      <div class="card muted">${rs.length} okruhy · ${qs.length} otázek · ${tName(Q.time)} na otázku</div>
      </div><div class="foot"><button class="btn" id="toIntro" ${n ? "" : "disabled"}>Přejít na 1. okruh ▶</button></div>`;
    case "intro": return bar(`Okruh ${Q.ri + 1}/${rs.length}`, esc(Q.name)) + `<div class="body">${introHtml("host")}</div>
      <div class="foot"><button class="btn" id="startR">Spustit okruh ▶</button></div>`;
    case "question": {
      const an = answersOf(Q.qi), c = teams().filter(([id]) => an[id]).length, r = rs[roundOf(Q.qi)], k = Q.qi - r.start;
      if (inGap()) return bar(`${esc(r.name)} · ${k + 1}/${r.count}`, tLbl()) + `<div class="body" style="justify-content:center">${gapHtml()}<div class="card center"><div class="big">${c}/${n}</div><div class="muted">týmů odpovědělo</div></div></div>`;
      return bar(`${esc(r.name)} · ${k + 1}/${r.count}`, tLbl()) + `<div class="body">
      <span class="cat">${esc(q.cat)}</span><div class="q">${esc(q.q)}</div>${media(q, "host")}
      <div class="timer"><i style="width:${Q.time ? (timeLeft() / Q.time) * 100 : 100}%"></i></div>
      ${qT(q) === "abcd" ? `<div class="list">${q.a.map((a, i) => `<div class="row"><span class="tag ${LET[i]}">${SYMS[i]}</span>${aThumb(a)}</div>`).join("")}</div>`
        : qT(q) === "text" ? `<div class="card">✍️ <b>Týmy píšou vlastní odpověď.</b></div>`
        : `<div class="card">🔢 <b>Týmy hádají číslo.</b><div class="muted">Přesně = 2 body, v toleranci ±${q.tol} = 1 bod.</div></div>`}
      <div class="card center"><div class="big">${c}/${n}</div><div class="muted">týmů odpovědělo</div></div>
      </div><div class="foot">${Q.qEnd ? `<div class="muted center">Další otázka naskočí sama 3 s po konci času.</div>` : `<button class="btn sec" id="endQ">Ukončit otázku</button>`}</div>`;
    }
    case "roundEnd": {
      const r = rs[Q.ri], last = Q.ri >= rs.length - 1;
      return bar(`Konec okruhu ${Q.ri + 1}/${rs.length}`, esc(r.name)) + `<div class="body">
      <div class="card lb"><b>📊 Průběžné pořadí</b>${ranking().map(lbRow).join("")}</div>
      <div class="center"><b style="font-size:18px">✅ Správné odpovědi okruhu</b></div>${roundSummary(null)}
      </div><div class="foot"><button class="btn" id="${last ? "fin" : "toNext"}">${last ? "Vyhlásit vítěze 🏆" : `Další okruh: ${esc(rs[Q.ri + 1].name)} ▶`}</button></div>`;
    }
    case "final": {
      const r = ranking(), sp = L.statP && Q.teams[L.statP];
      return bar("🏆 Konečné pořadí") + `<div class="body">
      <div class="podium"><div class="p2">2.<br>${esc(r[1]?.name || "")}</div><div class="p1">1.<br>${esc(r[0]?.name || "")}</div><div class="p3">3.<br>${esc(r[2]?.name || "")}</div></div>
      ${sp ? `<div class="row"><button class="mini" id="statBack">‹ Celé pořadí</button><b style="margin-left:6px">${esc(sp.name)}</b></div>${statsHtml(L.statP)}`
        : `<div class="card lb">${r.map((x, i) => `<div class="row click" data-statp="${x.id}"><b>${i + 1}.</b><span>${esc(x.name)} <small class="muted">· statistiky ›</small></span><span class="sc">${x.s} b.<small>⏱ ${fT(x.t)}</small></span></div>`).join("")}</div>`}
      </div><div class="foot"><button class="btn sec" id="endQuiz">Ukončit a začít nový kvíz</button></div>`;
    }
  }
  return "";
}

function playerJoinView() {
  return `<div class="snow"></div>` + bar("📷 Připojit se") + `<div class="body">
  <div class="card center"><div class="big">📱</div><b>Naskenuj QR kód z telefonu pořadatele</b>
   <button class="btn" id="scan" style="margin-top:10px">📷 Naskenovat QR kód</button>
   <p class="muted" style="margin:8px 0 0;font-size:13px">Jde to i obyčejným foťákem v telefonu, otevře se kvíz s vyplněným kódem.</p></div>
  <div><label>nebo opiš kód kvízu</label><input class="codein" id="joinCode" placeholder="KVIZ-____" maxlength="11" value="${esc(L.codeDraft || "")}" autocomplete="off"></div>
  <div class="err">${esc(L.err || "")}</div>
  <details class="take" ${L.takeOpen ? "open" : ""}><summary>Vybil se telefon pořadatele?</summary>
   <div class="muted" style="margin-top:6px">Tenhle telefon převezme řízení kvízu, týmy hrají dál.</div>
   <div class="g"><input id="toCode" placeholder="KVIZ-____" autocomplete="off" value="${esc(L.toC || "")}"><input id="toPin" placeholder="PIN" inputmode="numeric" maxlength="4" value="${esc(L.toP || "")}"></div>
   <button class="btn sec" id="takeBtn">Převzít pořadatele</button><div class="err">${esc(L.toErr || "")}</div>
  </details>
  </div><div class="foot"><button class="btn" id="go">Pokračovat</button></div>`;
}
function teamView() {
  const tm = L.team;
  return bar("Přihlásit tým", esc(L.code), "player-join") + `<div class="body">
  <div class="big">🎅🎄🦌</div>
  <div><label>Název týmu</label><input id="tName" value="${esc(tm.name)}" maxlength="30" placeholder="např. Šelmy z podatelny"></div>
  <div><label>Hráči v týmu (${tm.members.filter(x => x.trim()).length})</label>
   ${tm.members.map((m, i) => `<div class="arow" style="margin-bottom:6px"><span class="tag" style="background:#2e7d32">${i + 1}</span><input data-mem="${i}" value="${esc(m)}" placeholder="Jméno hráče">${tm.members.length > 1 ? `<button class="okb" data-rmm="${i}" title="Odebrat">✕</button>` : ""}</div>`).join("")}
   <button class="btn sec" id="addMem">＋ Přidat hráče</button></div>
  <div class="err">${esc(L.err || "")}</div>
  <div class="muted">Za tým odpovídá tenhle jeden telefon. Hráčů může být v týmu kolik chcete.</div></div><div class="foot"><button class="btn" id="join">Přihlásit tým 🎁</button></div>`;
}
function playerView() {
  if (!Q) return bar("Načítám…") + `<div class="body"><div class="center muted">Připojuji se ke kvízu…</div></div>`;
  const me = Q.teams && Q.teams[L.tid];
  if (!me) { L.view = "player-join"; return playerJoinView(); }
  const qs = questions(), rs = rounds(), q = qs[Q.qi], my = q ? answersOf(Q.qi)[L.tid] : null, r = ranking(), pos = r.findIndex(x => x.id === L.tid) + 1;
  switch (Q.state) {
    case "lobby": return `<div class="snow"></div>` + bar(esc(Q.name), esc(me.name)) + `<div class="body" style="justify-content:center;text-align:center">
      <div class="big">⛄</div><b>Tým ${esc(me.name)} je ve hře!</b><div class="muted">${esc((me.members || []).join(", "))}</div>
      <p class="muted">Čekáme, až pořadatel spustí kvíz…<br>Přihlášených týmů: ${teams().length}</p><span class="pill" style="align-self:center">● ${online ? "Online" : "Bez připojení…"} · ${esc(L.code)}</span></div>`;
    case "intro": return `<div class="snow"></div>` + bar(`Okruh ${Q.ri + 1}/${rs.length}`, esc(me.name)) + `<div class="body">${introHtml("player")}</div>`;
    case "question": {
      const rr = rs[roundOf(Q.qi)], k = Q.qi - rr.start, head = bar(`${esc(rr.name)} · ${k + 1}/${rr.count}`, tLbl());
      if (inGap()) return head + `<div class="body" style="justify-content:center">${gapHtml()}${my ? `<p class="center muted">Odpověď máte odeslanou. Jestli byla správně, uvidíte na konci okruhu.</p>` : `<p class="center muted">Na tuhle otázku jste neodpověděli.</p>`}</div>`;
      if (my) return head + `<div class="body" style="justify-content:center;text-align:center">
        <div class="timer"><i style="width:${Q.time ? (timeLeft() / Q.time) * 100 : 100}%"></i></div>
        ${qT(q) === "abcd" ? `<div class="ans ${LET[my.a]}" style="min-height:120px"><span class="s">${SYMS[my.a]}</span>${esc(aTxt(q.a[my.a]))}</div>` : `<div class="card"><div class="muted">Vaše odpověď</div><div class="big" style="font-size:32px">${esc(my.a)}</div></div>`}
        <b>Odpověď odeslána ✉️</b><p class="muted">Další otázka přijde, až vyprší čas.<br>Správnost uvidíte na konci okruhu.</p></div>`;
      return head + `<div class="body">
      <span class="cat">${esc(q.cat)}</span><div class="q">${esc(q.q)}</div>${media(q, "player")}<div class="timer"><i style="width:${Q.time ? (timeLeft() / Q.time) * 100 : 100}%"></i></div>
      ${qT(q) === "abcd" ? `<div class="answers">${q.a.map((a, i) => `<button class="ans ${LET[i]}${a.img ? " pic" : ""}" data-a="${i}">${a.img ? `<img src="${esc(a.img)}" alt="${esc(a.t)}"><span class="cap"><span>${SYMS[i]}</span> ${esc(a.t)}</span>` : `<span class="s">${SYMS[i]}</span>${esc(a)}`}</button>`).join("")}</div>`
        : `<div class="card"><label>${qT(q) === "text" ? "Vaše odpověď" : "Váš odhad"}</label><input id="ansIn" ${qT(q) === "num" ? 'type="number" inputmode="numeric" placeholder="např. 1990"' : 'placeholder="Napište odpověď…" autocomplete="off"'} value="${esc(L.ansDraft || "")}" style="font-size:20px">
          <div class="muted" style="margin-top:6px">${qT(q) === "num" ? `Přesně = 2 body · o ±${q.tol} vedle = 1 bod` : "Na velikosti písmen a háčcích nezáleží."}</div><div class="err">${esc(L.ansErr || "")}</div></div>
          <button class="btn" id="ansSend">Odeslat odpověď 📨</button>`}</div>`;
    }
    case "roundEnd": {
      const rr = rs[Q.ri], b0 = rr.start, got = qs.slice(b0, b0 + rr.count).reduce((s, x, k) => s + (((resultsOf(b0 + k) || {})[L.tid]) || 0), 0);
      return bar(`Konec okruhu ${Q.ri + 1}/${rs.length}`, esc(rr.name)) + `<div class="body">
      <div class="card center"><div class="muted">Za tento okruh</div><div class="big">+${got}</div><div class="muted">Celkem ${r[pos - 1]?.s ?? 0} b. · ⏱ ${fT(r[pos - 1]?.t)}</div><b>${pos}. místo z ${r.length}</b></div>
      <div class="card lb"><b>📊 Průběžné pořadí</b>${r.map(lbRow).join("")}</div>
      <div class="center"><b style="font-size:18px">Vaše odpovědi v okruhu</b></div>${roundSummary(L.tid)}
      <p class="center muted">${Q.ri < rs.length - 1 ? "Další okruh brzy začne…" : "Za chvíli vyhlášení vítězů… 🏆"}</p></div>`;
    }
    case "final": return `<div class="snow"></div>` + bar("🏆 Konec kvízu") + `<div class="body">
      <div class="center"><div class="big" style="margin:0">${pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : "🎄"}</div><b style="font-size:24px">${pos}. místo z ${r.length}</b></div>
      ${statsHtml(L.tid)}<div class="card lb"><b>Konečné pořadí</b>${r.map(lbRow).join("")}</div><p class="muted center">Veselé Vánoce a šťastný nový rok! 🎁</p></div>`;
  }
  return "";
}

/* ---------- vykreslení (se zachováním kurzoru v políčku) ---------- */
function render() {
  const a = document.activeElement, key = a && a.tagName === "INPUT" && a.type !== "file" ? (a.id ? "#" + a.id : [...a.attributes].filter(x => x.name.startsWith("data-")).map(x => `[${x.name}="${x.value}"]`).join("")) : null;
  const sel = key && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
  let h;
  switch (L.view) {
    case "home": h = homeView(); break;
    case "host-create": h = hostCreateView(); break;
    case "host-addq": h = addqView(); break;
    case "host": h = hostView(); break;
    case "player-join": h = playerJoinView(); break;
    case "player-team": h = teamView(); break;
    case "player": h = playerView(); break;
  }
  $("#app").innerHTML = h;
  if (key) { const e = document.querySelector(key); if (e) { e.focus(); try { sel && e.setSelectionRange(...sel); } catch {} } }
}
setInterval(() => {
  if (L.isHost && L.view === "host" && Q) keepAwake(true); else if (wake) keepAwake(false);
  if (Q && Q.state === "question" && Q.qEnd) {
    if (L.isHost && L.view === "host" && db.now() >= Q.qEnd + GAP) advance();
    const a = document.activeElement;
    if (!(a && a.id === "ansIn") || inGap()) render(); else { const b = $(".bar small"); if (b) b.textContent = tLbl(); const t = $(".timer i"); if (t && Q.time) t.style.width = (timeLeft() / Q.time) * 100 + "%"; }
  }
}, 250);

/* ---------- události ---------- */
function go(view) { L.err = ""; L.view = view; render(); }
function leaveQuiz() { if (unsub) unsub(); unsub = null; Q = null; L.code = null; L.isHost = false; }

document.addEventListener("input", e => {
  const t = e.target;
  if (t.id === "qn") { quizName = t.value; store.set("name", quizName); }
  else if (t.id === "joinCode") L.codeDraft = t.value;
  else if (t.id === "toCode") L.toC = t.value;
  else if (t.id === "toPin") L.toP = t.value;
  else if (t.id === "tName") L.team.name = t.value;
  else if (t.dataset.mem != null) L.team.members[+t.dataset.mem] = t.value;
  else if (t.id === "ansIn") L.ansDraft = t.value;
  else if (L.draft) {
    if (t.id === "dNewR") L.draft.newR = t.value;
    else if (t.id === "dCat") L.draft.cat = t.value; else if (t.id === "dQ") L.draft.q = t.value;
    else if (t.dataset.da != null) L.draft.a[+t.dataset.da] = t.value;
    else if (t.id === "dAcc") L.draft.acc = t.value; else if (t.id === "dNum") L.draft.num = t.value; else if (t.id === "dTol") L.draft.tol = t.value;
  }
});
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "tsel") { TIME = +t.value; store.set("time", TIME); return; }
  if (t.id === "dRound") { L.draft.round = t.value; return render(); }
  const f = t.files && t.files[0]; if (!f) return;
  try {
    if (t.dataset.dqf === "qimg") L.draft.qimg = await readImage(f);
    else if (t.dataset.dqf === "audio") L.draft.audio = await readAudio(f);
    else if (t.dataset.df != null) L.draft.img[+t.dataset.df] = await readImage(f, 500);
    L.dErr = "";
  } catch (er) { L.dErr = er && er.message === "big" ? "Nahrávka je moc velká (max 3 MB). Zkrať ji na pár sekund." : "Soubor se nepodařilo načíst."; }
  render();
});
document.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  if (e.target.id === "ansIn") $("#ansSend")?.click();
  else if (e.target.id === "joinCode") $("#go")?.click();
});

document.addEventListener("click", async e => {
  const sp = e.target.closest("[data-statp]");
  if (sp) { L.statP = sp.dataset.statp; L.sel = null; return render(); }
  const t = e.target.closest("button"); if (!t) return;
  const id = t.id, ds = t.dataset;

  if (ds.back) {
    if (scanStop) scanStop();
    if (ds.back === "home" && (L.view === "host" || L.view === "player")) leaveQuiz();
    return go(ds.back);
  }
  if (ds.play) { const src = ds.play === "draft" ? L.draft.audio : ds.play === "cur" ? questions()[Q.qi].audio : questions()[+ds.play].audio; if (src) playAudio(src); return; }

  // úvod
  if (id === "mHost") return go("host-create");
  if (id === "mPlay") { L.codeDraft = ""; return go("player-join"); }
  if (id === "scan") return startScan();
  if (id === "upd") return doUpdate();
  if (id === "resumeHost") { L.isHost = true; L.view = "host"; watch(store.get("host")); return render(); }
  if (id === "resumePlay") { const p = store.get("player"); L.isHost = false; L.tid = p.tid; L.view = "player"; watch(p.code); return render(); }

  // pořadatel: příprava
  if (id === "addQ") { L.draft = { round: (buildQuiz().rounds[0] || { name: "__new" }).name, newR: "", type: "abcd", cat: "", q: "", a: ["", "", "", ""], img: [null, null, null, null], ok: null, acc: "", num: "", tol: "2", qimg: null, audio: null }; L.dErr = ""; return go("host-addq"); }
  if (ds.delq != null) { extra.splice(+ds.delq, 1); store.set("extra", extra); return render(); }
  if (ds.dt) { L.draft.type = ds.dt; L.dErr = ""; return render(); }
  if (ds.dok != null) { L.draft.ok = +ds.dok; return render(); }
  if (ds.rmq) { L.draft[ds.rmq] = null; return render(); }
  if (id === "saveQ") {
    const d = L.draft, rn = d.round === "__new" ? d.newR.trim() : d.round, base = { mine: true, round: rn, cat: d.cat.trim() || "⭐ Vlastní", q: d.q.trim() };
    if (d.qimg) base.img = d.qimg; if (d.audio) base.audio = d.audio;
    let nq = null;
    if (!rn) L.dErr = "Napiš název nového okruhu.";
    else if (!base.q) L.dErr = "Napiš otázku.";
    else if (d.type === "abcd") {
      if (d.a.some((a, i) => !a.trim() && !d.img[i])) L.dErr = "Vyplň všechny 4 odpovědi (text nebo fotku).";
      else if (d.ok == null) L.dErr = "Označ správnou odpověď (✓).";
      else nq = { ...base, a: d.a.map((a, i) => d.img[i] ? { t: a.trim() || "Foto " + (i + 1), img: d.img[i] } : a.trim()), ok: d.ok };
    } else if (d.type === "text") {
      const acc = d.acc.split(",").map(x => x.trim()).filter(Boolean);
      if (!acc.length) L.dErr = "Napiš aspoň jednu správnou odpověď."; else nq = { ...base, type: "text", acc };
    } else {
      if (d.num === "" || isNaN(+d.num)) L.dErr = "Zadej správné číslo."; else nq = { ...base, type: "num", num: +d.num, tol: Math.max(0, +d.tol || 0) };
    }
    if (nq) { extra.push(nq); try { store.set("extra", extra); } catch {} return go("host-create"); }
    return render();
  }
  if (id === "create") { t.disabled = true; try { await createQuiz(); } catch (er) { alertBox("Kvíz se nepodařilo založit. Zkontroluj připojení k internetu."); } return; }

  // pořadatel: hra
  if (id === "pinT") { L.pinShow = !L.pinShow; return render(); }
  if (ds.ask) { L.unpair = ds.ask; return render(); }
  if (ds.un) { L.unpair = null; await db.set(`quizzes/${L.code}/teams/${ds.un}/kicked`, true); return; }
  if (id === "toIntro") { t.disabled = true; return toIntro(0); }
  if (id === "toNext") { t.disabled = true; return toIntro(Q.ri + 1); }
  if (id === "startR") { t.disabled = true; return startRound(); }
  if (id === "endQ") { t.disabled = true; return endQuestion(); }
  if (id === "fin") return db.update("quizzes/" + L.code, { state: "final" });
  if (ds.tog) { const [qi, tid] = ds.tog.split(":"), cur = (resultsOf(+qi) || {})[tid] || 0; return db.set(`quizzes/${L.code}/results/${qk(+qi)}/${tid}`, cur ? 0 : 1); }
  if (id === "statBack") { L.statP = null; L.sel = null; return render(); }
  if (ds.qn != null) { L.sel = L.sel === +ds.qn ? null : +ds.qn; return render(); }
  if (id === "endQuiz") { store.set("host", null); leaveQuiz(); return go("home"); }

  // hráč
  if (id === "go") {
    const c = (L.codeDraft || "").trim().toUpperCase().replace(/^(\d{4})$/, "KVIZ-$1");
    if (!c) { L.err = "Opiš kód z telefonu pořadatele."; return render(); }
    t.disabled = true;
    const ex = await db.get("quizzes/" + c + "/state");
    if (!ex) { L.err = "Kvíz s tímhle kódem neexistuje. Zkontroluj ho."; return render(); }
    if (ex === "final") { L.err = "Tenhle kvíz už skončil."; return render(); }
    L.code = c; L.team = L.team || { name: "", members: [""] }; return go("player-team");
  }
  if (id === "addMem") { L.team.members.push(""); render(); const ins = document.querySelectorAll("[data-mem]"); ins[ins.length - 1].focus(); return; }
  if (ds.rmm != null) { L.team.members.splice(+ds.rmm, 1); return render(); }
  if (id === "join") {
    const nm = L.team.name.trim(), ms = L.team.members.map(x => x.trim()).filter(Boolean);
    if (!nm) { L.err = "Napište název týmu."; return render(); }
    if (!ms.length) { L.err = "Přidejte aspoň jednoho hráče."; return render(); }
    t.disabled = true;
    const tms = (await db.get(`quizzes/${L.code}/teams`)) || {};
    if (Object.values(tms).some(x => !x.kicked && norm(x.name) === norm(nm))) { L.err = "Tým s tímhle názvem už je přihlášený. Zvolte jiný."; return render(); }
    const tid = "t" + rid();
    await db.set(`quizzes/${L.code}/teams/${tid}`, { name: nm, members: ms, joinedAt: db.now() });
    L.tid = tid; L.isHost = false; store.set("player", { code: L.code, tid }); L.view = "player"; watch(L.code); return;
  }
  if (ds.a != null) return answer(+ds.a);
  if (id === "ansSend") {
    const v = (L.ansDraft || "").trim(), q = questions()[Q.qi];
    if (!v) { L.ansErr = "Nejdřív něco napište."; return render(); }
    if (qT(q) === "num" && isNaN(+v)) { L.ansErr = "Zadejte číslo."; return render(); }
    L.ansDraft = ""; L.ansErr = ""; return answer(qT(q) === "num" ? +v : v);
  }
  if (id === "takeBtn") {
    const c = (L.toC || "").trim().toUpperCase(), pin = (L.toP || "").trim(); L.takeOpen = true;
    const qz = c && (await db.get("quizzes/" + c + "/pin"));
    if (!qz) L.toErr = "Kvíz s tímhle kódem neexistuje.";
    else if (qz !== pin) L.toErr = "PIN nesouhlasí. Zkus to znovu.";
    else { L.toErr = ""; L.isHost = true; store.set("host", c); L.view = "host"; watch(c); return; }
    return render();
  }
});
/* ---------- aktualizace ---------- */
const FILES = ["./", "index.html", "app.js", "app.css", "db.js", "config.js", "questions.js", "version.js", "qrcode.js", "jsqr.js"];
function fmtBuilt(b) {
  if (!b) return "vývojová verze";
  const d = new Date(b);
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" }) + " v " + d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}
async function latestBuilt() {
  const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error("x"); return (await r.json()).built;
}
async function checkUpdate() { try { const b = await latestBuilt(); L.newer = !!(b && BUILT && b !== BUILT); if (L.view === "home") render(); } catch {} }
async function doUpdate() {
  if (L.updating) return; L.updating = true; render();
  try {
    const b = await latestBuilt();
    if (b && b === BUILT) { L.updating = false; L.newer = false; render(); return alertBox("✅ Máš nejnovější verzi."); }
    await Promise.all(FILES.map(f => fetch(f, { cache: "reload" }).catch(() => {})));
    location.reload();
  } catch { L.updating = false; render(); alertBox("Aktualizace se nepodařila. Zkontroluj internet."); }
}

/* ---------- čtečka QR kódu ---------- */
let scanStop = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve();
  return new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "jsqr.js"; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
}
function codeFrom(text) {
  try { const k = new URL(text).searchParams.get("k"); if (k) return k.toUpperCase(); } catch {}
  const m = String(text).toUpperCase().match(/KVIZ-[A-Z0-9]+/); return m ? m[0] : null;
}
async function startScan() {
  const ov = document.createElement("div"); ov.className = "scanov";
  ov.innerHTML = `<div class="scanbox"><video playsinline muted></video><i></i></div><p>Namiř foťák na QR kód na telefonu pořadatele</p><button class="btn sec" id="scanX">Zrušit</button>`;
  document.body.appendChild(ov);
  const video = ov.querySelector("video");
  let stream, raf, alive = true;
  const stop = () => { alive = false; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); ov.remove(); scanStop = null; };
  scanStop = stop; ov.querySelector("#scanX").onclick = stop;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    if (!alive) return stream.getTracks().forEach(t => t.stop());
    video.srcObject = stream; await video.play();
  } catch { stop(); alertBox("Foťák se nepodařilo spustit. Povol přístup ke kameře, nebo opiš kód."); return; }
  const det = "BarcodeDetector" in window ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
  if (!det) { try { await loadJsQR(); } catch { stop(); alertBox("Čtečku se nepodařilo načíst. Opiš kód."); return; } }
  const cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true });
  let busy = false;
  const found = txt => {
    const c = codeFrom(txt); if (!c) return false;
    stop(); L.codeDraft = c; L.err = ""; render(); $("#go")?.click(); return true;
  };
  const tick = async () => {
    if (!alive) return;
    if (!busy && video.readyState >= 2) {
      busy = true;
      try {
        if (det) { const r = await det.detect(video); if (r[0] && found(r[0].rawValue)) return; }
        else {
          const w = 480, h = Math.round(w * video.videoHeight / video.videoWidth) || 360; cv.width = w; cv.height = h;
          cx.drawImage(video, 0, 0, w, h); const r = jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
          if (r && found(r.data)) return;
        }
      } catch {}
      busy = false;
    }
    raf = requestAnimationFrame(tick);
  };
  tick();
}

function alertBox(msg) { const d = document.createElement("div"); d.className = "toast"; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 4000); }

/* ---------- start ---------- */
(async () => {
  try { db = await openDb(); }
  catch { $("#app").innerHTML = `<div class="body" style="justify-content:center;text-align:center"><div class="big">📡</div><b>Nepodařilo se připojit.</b><p class="muted">Zkontroluj internet a obnov stránku.</p></div>`; return; }
  if (db.onConnection) db.onConnection(c => { online = c; });
  const k = new URLSearchParams(location.search).get("k");
  const p = store.get("player");
  if (k) {
    if (p && p.code === k.toUpperCase()) { L.tid = p.tid; L.view = "player"; watch(p.code); }
    else { L.codeDraft = k.toUpperCase(); L.view = "player-join"; render(); $("#go")?.click(); return; }
  }
  render();
  checkUpdate();
})();
