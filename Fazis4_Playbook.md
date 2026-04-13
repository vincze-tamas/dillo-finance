# FÁZIS 4 VÉGREHAJTÁSI PLAYBOOK
## Armadillo Pénzügyi Automatizáció — Looker Studio dashboard

**Verzió:** 1.0 · **Dátum:** 2026-03-29
**Státusz:** Végrehajtásra kész

---

## FÜGGŐSÉGI SORREND — MI BLOKKOL MIT

```
Fázis 1 kész + éles adatok az SSOT sheet-ben ───────► Fejlesztő (41, 42)
                                                            └──► Péter + Ági (43 — review)
```

> Fázis 4 **párhuzamosan indítható** Fázis 3-mal, ha az SSOT sheet már tartalmaz éles adatot (Fázis 1 lezárva). Nem szükséges megvárni Fázis 3 befejezését.

**Ha ezek nincsenek kész, nem szabad elkezdeni Fázis 4-et:**

| Blokkoló | Felelős | Mit blokkol |
|---|---|---|
| Fázis 1 kész + SSOT-ban éles adat | Fejlesztő | Task 41, 42 (üres sheet-ből nem lehet értelmes dashboard-ot csinálni) |

---

## FEJLESZTŐ — Task 41 — Adatforrás beállítása + Data Blend

- [ ] Böngészőben megnyitni: [lookerstudio.google.com](https://lookerstudio.google.com)
- [ ] **Adatforrás #1: BEJÖVŐ_SZÁMLÁK**
  - Létrehozás → Google Sheets → SSOT sheet kiválasztása → `BEJÖVŐ_SZÁMLÁK` fül
  - Frissítési beállítás: **Every 4 hours** (vagy Every hour, ha fontos az aktualitás)
  - Mezők ellenőrzése: dátumok DATE típusúak, összegek NUMBER típusúak
- [ ] **Adatforrás #2: SZÁMLA_TÉTELEK**
  - Ugyanígy: `SZÁMLA_TÉTELEK` fül
- [ ] **Data Blend létrehozása** (projekt P&L nézethez):
  - Blend: Left Outer Join
  - Kulcs: `Számla ID` (BEJÖVŐ_SZÁMLÁK A oszlop = SZÁMLA_TÉTELEK A oszlop)
  - ⚠️ Csak akkor helyes, ha FK pontosan egyezik — ellenőrizni néhány sorban

**✅ Kész, ha:** Mindkét adatforrás csatlakoztatva, Data Blend lekérdezés helyes eredményt ad (nem üres, nem duplikál).

---

## FEJLESZTŐ — Task 42 — 5 dashboard oldal

- [ ] **1. oldal: Főoldal**
  - Státuszok szerinti szűrt lista (Scorecard + Table widget)
  - Nyitott tételek összesítve (BEÉRKEZETT + HIÁNYOS_PO + JÓVÁHAGYVA)
  - Lejáró számlák kiemelve: fizetési határidő < 7 nap
  - Szűrők: időszak, kategória (PROJEKT/ÁLLANDÓ), deviza

- [ ] **2. oldal: Cash flow**
  - Következő 30 nap fizetési határidői (Bar chart, naponta csoportosítva)
  - Összesített várható kiadás az időszakra
  - Szűrő: deviza (HUF/EUR külön)

- [ ] **3. oldal: ÁFA**
  - Havi bontás **teljesítési dátum** alapján (nem fizetési dátum!)
  - Nettó / ÁFA összeg / Bruttó összeg havi oszlopdiagram
  - ÁFA kulcsonkénti bontás (SZÁMLA_TÉTELEK G oszlop)

- [ ] **4. oldal: Kintlévőség**
  - Forrás: KIMENŐ_SZÁMLÁK fül
  - Ki nem fizetett: ügyfélnév, összeg, hány napja lejárt
  - Szűrő: NYITOTT + KÉSEDELMES státuszok

- [ ] **5. oldal: Lejárt tételek**
  - BEJÖVŐ_SZÁMLÁK — fizetési határidő lejárt, státusz nem TELJESÍTVE
  - Buckets: 1–15 nap / 16–30 nap / 31–60 nap / 60+ nap
  - Partnerenként csoportosítva

**✅ Kész, ha:** Mind az 5 oldal valós adatot mutat, nem placeholder értékeket.

---

## PÉTER + ÁGI — Task 43 — Dashboard review

> Előfeltétel: Task 42 kész, dashboard elérhető linken.

- [ ] Dashboard link megnyitása (fejlesztő küldi el)
- [ ] Ellenőrzés:
  - [ ] Az adatok egyeznek a Sheet-ben látottakkal?
  - [ ] Valami félrevezető, hiányzik, vagy felesleges?
  - [ ] Visszajelzés a fejlesztőnek — 3 munkanapon belül
- [ ] Ha nincs visszajelzés 3 munkanapon belül: **dashboard lezártnak tekinthető**

**✅ Kész, ha:** Visszajelzés megérkezett (vagy 3 munkanap telt el visszajelzés nélkül).

---

## FÁZIS 4 ZÁRÁSI KRITÉRIUM

Fázis 4 csak akkor zárható, ha **mind a 3 task** kész:

| Task | Felelős | Státusz |
|---|---|---|
| 41 — Adatforrás + Data Blend | Fejlesztő | ☐ |
| 42 — 5 dashboard oldal | Fejlesztő | ☐ |
| 43 — Dashboard review | Péter + Ági | ☐ |

**Ellenőrzés:**

- [ ] BEJÖVŐ_SZÁMLÁK adatforrás csatlakoztatva, mezők helyes típussal
- [ ] SZÁMLA_TÉTELEK adatforrás csatlakoztatva
- [ ] Data Blend helyes (nem duplikál, nem marad el sor)
- [ ] Mind az 5 oldal valós adatot mutat
- [ ] ÁFA oldal teljesítési dátum alapján számol (nem fizetési dátum)
- [ ] Péter + Ági visszajelzése beérkezett, javítások elvégezve

Ha bármelyik nem teljesül: Fázis 4 nem tekinthető lezártnak.

---

## MI TÖRTÉNIK, HA VALAMI HIÁNYZIK

| Mi hiányzik | Következmény |
|---|---|
| SSOT sheet üres (Fázis 1 nem zárult) | Dashboard üres — review elvégezhetetlen |
| KIMENŐ_SZÁMLÁK fül üres | Kintlévőség oldal nem mutat adatot — csak akkor probléma, ha a Megbízó KIMENŐ_SZÁMLÁK-at is vezet |
| Data Blend FK mismatch | Projekt P&L nézetben hibás összesítés — adatminőség kérdése |
| Péter + Ági nem ad visszajelzést | 3 munkanap után automatikusan lezártnak tekintjük |

---

*Következő fázis: Fázis 5 — Éves karbantartó scheduled task-ok + élesítés. Előfeltétel: Fázis 3 és Fázis 4 lezárva.*
