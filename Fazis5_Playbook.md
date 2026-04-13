# FÁZIS 5 VÉGREHAJTÁSI PLAYBOOK
## Armadillo Pénzügyi Automatizáció — Éves karbantartás + élesítés

**Verzió:** 1.0 · **Dátum:** 2026-03-29
**Státusz:** Végrehajtásra kész

---

## FÜGGŐSÉGI SORREND — MI BLOKKOL MIT

```
Fázis 3 + Fázis 4 kész ────────────────────────────► Fejlesztő (51 — scheduled task-ok)
52 — WORKING_SATURDAYS VERIFIED ───────────────────► Élesítés (kötelező feltétel!)
```

**Ha ezek nincsenek kész, az élesítés NEM engedélyezhető:**

| Blokkoló | Felelős | Mit blokkol |
|---|---|---|
| Fázis 3 kész (MagNet import sikeres) | Fejlesztő + Péter | Élesítés |
| Fázis 4 kész (dashboard review) | Fejlesztő + Péter + Ági | Élesítés |
| Task 52 — WORKING_SATURDAYS_2026 VERIFIED | Péter / IT felelős | Élesítés — **getNextWorkday() jogi kockázat** |

---

## FEJLESZTŐ — Task 51 — Scheduled task-ok létrehozása

> Előfeltétel: Fázis 3 kész.

### Január 1. — Ünnepnap cache frissítés

- [ ] `Triggers.gs`-ben `setupYearlyTasks()` függvény implementálása
- [ ] Január 1-jére időzített trigger (`ScriptApp.newTrigger()` → évente egyszer):
  ```javascript
  // Január 1. 08:00 — Nager.Date API fetch
  function refreshHolidaysCache() {
    const year = new Date().getFullYear() + 1;
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/HU`;
    // withRetry(fn, 3, 30000) wrapperrel
    const holidays = JSON.parse(UrlFetchApp.fetch(url).getContentText())
      .map(h => h.date).join(',');
    // CONFIG fülre írja: HOLIDAYS_{year} sor, státusz: ELLENŐRZENDŐ
    // Chat értesítő Admin webhook-ra: "Ellenőrizd és állítsd VERIFIED-re"
  }
  ```
- [ ] Chat értesítő szövege: `"⚠️ Ünnepnap lista frissítve ({ÉV}). Ellenőrizd a CONFIG fülön és állítsd VERIFIED-re: [Sheet link]"`
- [ ] withRetry: ha az API hívás sikertelen → admin email + log

**✅ Kész, ha:** Trigger létrehozva autobot@ fiókból, kézi futtatással CONFIG fülre ír egy `HOLIDAYS_{ÉV+1}` sort `ELLENŐRZENDŐ` státusszal.

---

### December 1. — Áthelyezett munkanapok emlékeztető

- [ ] December 1-jére időzített trigger:
  ```javascript
  // December 1. 09:00
  function remindWorkingSaturdays() {
    const year = new Date().getFullYear() + 1;
    sendChatMessage(CHAT_WEBHOOK_ADMIN,
      `📅 Emlékeztető: töltsd ki a WORKING_SATURDAYS_${year} sort a CONFIG fülön, ` +
      `majd állítsd VERIFIED-re. Forrás: Magyar Közlöny (október–november). [Sheet link]`
    );
  }
  ```
- [ ] Ugyanez Finance webhook-ra is: Péter értesítése

**✅ Kész, ha:** Trigger létrehozva, kézi futtatással Admin és Finance Chat üzenet megérkezik.

---

## PÉTER / IT FELELŐS — Task 52 — WORKING_SATURDAYS_2026 VERIFIED-re állítása

> **Ez kötelező élesítés előtt. Enélkül az élesítés NEM engedélyezhető.**

- [ ] SSOT sheet → **CONFIG** fül megnyitása
- [ ] `WORKING_SATURDAYS_2026` sor megkeresése
- [ ] Dátumok ellenőrzése a Magyar Közlöny alapján (2026-ra vonatkozó munkarend):
  - Jelenlegi értékek a CONFIG fülön: `2026-01-10, 2026-08-08, 2026-12-12`
  - Ha más dátumok szerepelnek a Közlönyben: javítani
- [ ] Státusz oszlop: `ELLENŐRZENDŐ` → `VERIFIED`
- [ ] Visszajelzés a fejlesztőnek

> ⚠️ Ha ez ELLENŐRZENDŐ marad élesítéskor: `getNextWorkday()` logol, de **téves utalási dátumot adhat**. Ez a kifizetések késedelméhez vagy hibás banki feldolgozáshoz vezet — **jogi következménnyel járhat**.

**✅ Kész, ha:** CONFIG fülön `WORKING_SATURDAYS_2026` sor státusza `VERIFIED`, dátumok ellenőrzöttek.

---

## ÉLESÍTÉSI ELLENŐRZŐLISTA

Mielőtt a rendszer élesbe megy, fejlesztő végigpipálja:

### Fázisok lezárva

- [ ] Fázis 0 — SSOT sheet + validációk ✅
- [ ] Fázis 1 — Gmail + Gemini OCR, tesztszámla sikeres ✅
- [ ] Fázis 2 — HIÁNYOS_PO + visszautasítás, teszt sikeres ✅
- [ ] Fázis 3 — Batch generátor, MagNet import sikeres ✅
- [ ] Fázis 4 — Dashboard, review lezárva ✅

### Konfigurációk

- [ ] Minden trigger **autobot@ fiókból** létrehozva
- [ ] CONFIG object: minden folder ID kitöltve (nem üres string)
- [ ] CONFIG object: mind a 3 webhook URL kitöltve (OPS, Finance, Admin)
- [ ] PropertiesService-ben Gemini key beállítva (nem null)
- [ ] CONFIG fül: `HOLIDAYS_2026` státusza `VERIFIED`
- [ ] CONFIG fül: `WORKING_SATURDAYS_2026` státusza `VERIFIED` ← **kötelező!**
- [ ] PARTNEREK fül: minden aktív partner IBAN-nal feltöltve
- [ ] PROJEKTEK fül: minden aktív projekt helyes formátumú projektszámmal

### Kommunikáció

- [ ] Ági és Péter értesítése: az élesítés időpontja, mit vár tőlük az első héten
- [ ] IT felelős: autobot@ fiók jelszava biztonságos helyen tárolva (nem személyes email-ban)
- [ ] Első szerdai workflow: fejlesztő elérhető legyen, ha valami nem stimmel

---

## FÁZIS 5 ZÁRÁSI KRITÉRIUM

| Task | Felelős | Státusz |
|---|---|---|
| 51 — Scheduled task-ok (jan 1. + dec 1.) | Fejlesztő | ☐ |
| 52 — WORKING_SATURDAYS_2026 VERIFIED | Péter / IT | ☐ |
| Élesítési ellenőrzőlista végigpipálva | Fejlesztő | ☐ |

**A rendszer élesben van, ha:**

- [ ] Fázis 0–4 mind lezárva
- [ ] Task 51 + 52 kész
- [ ] Élesítési ellenőrzőlista 100%-on pipált
- [ ] Első éles szerdai workflow lefutott (9:00 digest + 14:00 batch)
- [ ] Péter megerősítette, hogy a batch fájl feltölthető volt MagNet-be éles adattal

---

## MI TÖRTÉNIK, HA VALAMI HIÁNYZIK

| Mi hiányzik | Következmény |
|---|---|
| Task 52 (WORKING_SATURDAYS nem VERIFIED) | getNextWorkday() téves dátumot adhat — kifizetési késedelem, jogi kockázat |
| Scheduled task-ok nem autobot@-ból | Trigger leállhat, éves emlékeztetők elmaradnak |
| Webhooks nem kitöltve | Chat értesítők némán elmaradnak — Gmail fallback fut, de kevésbé látható |
| PARTNEREK fülön hiányzó IBAN | Az érintett partner nem fizethető ki a batch-ből |
| Első szerdai workflow fejlesztő nélkül | Ha hiba van, senki nem veszi észre azonnal — érdemes az első alkalommal figyelni |

---

## KARBANTARTÁSI NAPTÁR (rendszeres teendők)

| Mikor | Ki | Teendő |
|---|---|---|
| Január eleje | IT / Péter | `HOLIDAYS_{ÉV}` ELLENŐRZENDŐ → VERIFIED (Chat értesítő érkezik) |
| December eleje | Péter | `WORKING_SATURDAYS_{ÉV+1}` kitöltése + VERIFIED (Chat emlékeztető érkezik) |
| Negyedévente | Fejlesztő | Apps Script Executions nézet — hibák ellenőrzése |
| Amikor partner változik | Péter | PARTNEREK fül frissítése |
| Amikor új projekt indul | Ági | PROJEKTEK fülre felvétel (XXXX + ÉÉ + SS formátum) |

---

*A projekt lezártnak tekinthető, ha az élesítési ellenőrzőlista 100%-on pipált és az első éles szerdai workflow sikeresen lefutott.*
