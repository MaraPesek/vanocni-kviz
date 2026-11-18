// OTÁZKY KVÍZU – připravené předem (doplníme spolu v chatu).
// Typy:
//   A/B/C/D:  { cat, q, a:["…","…","…","…"], ok: index správné (0–3) }
//             odpověď může být i fotka: { t:"popisek", img:"media/soubor.jpg" }
//   text:     { type:"text", cat, q, acc:["uznávaná odpověď", "varianta"] }
//   číslo:    { type:"num", cat, q, num: správné číslo, tol: tolerance ± }
// K jakékoli otázce lze přidat img:"media/obrazek.jpg" nebo audio:"media/nahravka.mp3".
// ZATÍM JSOU TU JEN UKÁZKOVÉ OTÁZKY.

function photo(e, c1, c2, t) {
  return { t, img: "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 90'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${c2}'/><stop offset='1' stop-color='${c1}'/></linearGradient></defs><rect width='120' height='90' fill='url(#g)'/><text x='60' y='58' font-size='40' text-anchor='middle'>${e}</text></svg>`) };
}

export const QUESTIONS = [
  { cat: "🎄 Vánoce", q: "Kolik svíček je na adventním věnci?", a: ["2", "3", "4", "5"], ok: 2 },
  { cat: "🦌 Pohádky", q: "Jak se jmenuje sob se svítícím červeným nosem?", a: ["Rudolf", "Kometa", "Blesk", "Tanečník"], ok: 0 },
  { cat: "🖼️ Obrázková otázka", q: "Co je na obrázku (zvětšený detail)?", img: photo("🌟", "#f9a825", "#fff8e1", "").img, a: ["Hvězda na špičce stromku", "Prskavka", "Sluníčko", "Sněhová vločka"], ok: 0 },
  { cat: "🎵 Poznej písničku", q: "Z jaké písničky je tahle melodie?", audio: "tune:jingle", a: ["Rolničky, rolničky", "Tichá noc", "Nesem vám noviny", "Purpura"], ok: 0 },
  { cat: "📸 Foto otázka", q: "Na které fotce je perníková chaloupka?", a: [photo("🎄", "#2e7d32", "#a5d6a7", "Stromek"), photo("🏠", "#a0582a", "#ffe0b2", "Chaloupka"), photo("☃️", "#1e88e5", "#e3f2fd", "Sněhulák"), photo("🎁", "#c62828", "#ffcdd2", "Dárek")], ok: 1 },
  { type: "text", cat: "✍️ Napiš odpověď", q: "Kdo nosí dárky dětem v Rusku?", acc: ["Děda Mráz", "Ded Moroz", "Dědeček Mráz"] },
  { type: "num", cat: "🎂 Hádej rok", q: "Ve kterém roce se narodila Monika? (ukázka, rok je vymyšlený)", num: 1990, tol: 2 },
];
