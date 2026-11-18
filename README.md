# 🎄 Vánoční kvíz – Šelmy ze stavebáku

Pořadatel založí kvíz v Android aplikaci a ukáže QR kód. Týmy ho naskenují foťákem a hrají v prohlížeči.

- **Stránka pro hráče:** https://marapesek.github.io/vanocni-kviz/
- **Aplikace pro pořadatele (APK):** v sekci **Releases** vpravo, soubor `vanocni-kviz.apk`. Na telefonu ho stáhni a otevři (povol instalaci z neznámých zdrojů).

## Jak to funguje
- `www/` – celá aplikace (stejná pro pořadatele i hráče).
- `www/questions.js` – připravené otázky.
- `www/config.js` – připojení k Firebase a adresa stránky pro hráče.
- Aplikace pro pořadatele načítá obsah ze stránky pro hráče, takže změny se do ní dostanou samy (do ~10 minut, stačí aplikaci zavřít a otevřít). Nové APK je potřeba jen při změně ikony, názvu nebo oprávnění.

## Firebase
Realtime Database, pravidla viz `database.rules.json` (zkopírovat do Firebase → Realtime Database → Rules).
Bez `firebaseConfig` běží aplikace ve zkušebním režimu jen mezi okny jednoho prohlížeče.
