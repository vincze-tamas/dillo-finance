# FÁZIS 3 VÉGREHAJTÁSI PLAYBOOK
## Armadillo Pénzügyi Automatizáció — Szerdai workflow + batch generátor

**Verzió:** 1.0 · **Dátum:** 2026-03-29
**Státusz:** Végrehajtásra kész — HUF ághoz P9 + P11 kell előbb

---

## FÜGGŐSÉGI SORREND — MI BLOKKOL MIT

```
Fázis 2 kész ──────────────────────────────────────────────► Fejlesztő (31, 32)
P9 — jogcím kód (Péter) ──────────────────────────────────► 32 (HUF batch FEJ rekord)
P11 — IBM 852 ASCII teszt (Fejlesztő + Péter) ────────────► 32 (kódolás stratégia végleges)
P10 — SEPA formátum (Péter) ──────────────────────────────► 32 EUR-ág (elhalasztható ha nincs EUR partner)
                                                               └──► Péter (33 — MagNet teszt import)
```

**Ha ezek nincsenek kész, nem szabad elkezdeni Fázis 3-at:**

| Blokkoló | Felelős | Mit blokkol |
|---|---|---|
| Fázis 2 mind a 4 task | Fejlesztő | Task 31, 32 |
| P9 — MagNet jogcím kód | Péter | Task 32 (HUF batch FEJ rekord F217 mező) |
| P11 — IBM 852 ASCII teszt (1 Ft próba) | Fejlesztő + Péter | Task 32 (kódolás véglegesítés) |

**Ha P10 hiányzik:** HUF ág elkészíthető, EUR ág stub marad. Fázis 3 lezárható HUF-ra, EUR-hoz P10 után kiegészítés.

---

## PÉNZÜGYI VEZETŐ — PÉTER — PRE-3 feladatok

### P9 — MagNet jogcím kód megerősítése *(BLOKKOLÓ — Task 32 előtt)*

- [ ] MagNet NetBank → **Kötegek** → **Köteg rögzítés** → Típus: **ATUTAL**
- [ ] FEJ rekordnál megkeresni a **Jogcím** legördülőt
- [ ] Szállítói utaláshoz helyes kód kikeresése (feltételezett: `K01`)
- [ ] Pontos kód átadása a fejlesztőnek

**✅ Kész, ha:** Fejlesztő visszaigazolta, kód bekerült a CONFIG fülre.

---

### P10 — SEPA kötegállomány formátum *(Fázis 3 EUR-ághoz — elhalasztható)*

- [ ] MagNet NetBank → **Kötegek** → **Köteg rögzítés** → Típus: **SEPA átutalási megbízás**
- [ ] Milyen fájlt vár? (`.txt` fix szélességű, `.xml` pain.001, `.csv`?)
- [ ] Ha van mintafájl: letölteni és elküldeni a fejlesztőnek
- [ ] Ha nincs EUR partner aktívan: **elhalasztható** — HUF batch blokkoló nélkül indul

**✅ Kész, ha:** Formátum specifikáció vagy mintafájl átadva a fejlesztőnek.

---

### P11 — IBM 852 ASCII kódolás teszt *(BLOKKOLÓ — Task 32 előtt)*

> A fejlesztő generálja a tesztfájlt, Péter tölti fel MagNet-be.

- [ ] Fejlesztő által generált 1 tételes ASCII-only tesztfájl megkapása (ékezet nélküli cégnév + közlemény)
- [ ] MagNet NetBank → **Kötegek** → **Köteg rögzítés** → Típus: Csoportos átutalás → **Állomány feltöltése**
- [ ] Összeg: 1 Ft, belső számlára utalva
- [ ] Eredmény visszajelzése a fejlesztőnek:
  - **Ha importálható:** ASCII stratégia végleges — kódolás kérdés lezárva ✅
  - **Ha hibát jelez:** melyik mező okozza, milyen hibaüzenet → IBM 852 konverziós függvény szükséges

**✅ Kész, ha:** Fejlesztő visszaigazolta az eredményt és dokumentálta a stratégiát.

---

## FEJLESZTŐ — Task 31 — Szerda 9:00 jóváhagyási digest

- [ ] `WednesdayWorkflow.gs` fájl létrehozása
- [ ] Time-driven trigger: szerda 9:00 — **autobot@ fiókból!**
- [ ] BEÉRKEZETT státuszú számlák lekérdezése kategória szerint:
  - `PROJEKT` → Chat üzenet **OPS webhook**-ra (Ági + Márk)
  - `ÁLLANDÓ` → Chat üzenet **Finance webhook**-ra (Péter)
- [ ] HIÁNYOS_PO tételek szintén az OPS digestben — **tétel-szintű bontással:**
  ```
  ⚠️ HIÁNYOS_PO: [Szállító neve] — [Összeg]
    sor 1: "[Tétel leírás]" → PO: [érték] | Conf: [%] | [Gemini reasoning]
    sor 2: "[Tétel leírás]" → PO: HIÁNYZIK | Conf: 42% | Nem azonosítható projektszám
  ```
- [ ] 7 napon belül lejáró, jóvá nem hagyott tételek: **külön kiemelve** mindkét értesítőben
- [ ] HIÁNYOS_PO tételeknél az OPS Chat üzenet tartalmaz utasítást: "PO kézzel bevihető a Sheet N oszlopába → BEÉRKEZETT-re állítható, vagy Q oszlopban → VISSZAUTASÍTVA"

**✅ Kész, ha:** Kézi trigger futtatásakor (Script Editor-ból) OPS és Finance Chat üzenet megérkezett, tartalmuk helyes.

---

## FEJLESZTŐ — Task 32 — getNextWorkday() + batch generátor

> Előfeltétel: P9 kész (jogcím kód megvan), P11 kész (kódolás stratégia végleges).

- [ ] `getNextWorkday(date)` implementálása `Utils.gs`-ben:
  - CONFIG fülről olvassa: `HOLIDAYS_{ÉV}` és `WORKING_SATURDAYS_{ÉV}` sorokat
  - **Csak VERIFIED státuszú sor** alkalmazandó
  - Ha sor `ELLENŐRZENDŐ`: logol + admin email küldés, **de fut tovább** (nem áll meg)
  - Szombat munkanapon: ha szerepel `WORKING_SATURDAYS`-ban → munkanap
  - Vasárnap, ünnepnap: következő munkanapra ugrás

- [ ] `BatchGenerator.gs` — HUF CS-ÁTUTALÁS rekord generálás (`magnet_batch_spec.md` alapján):
  - **01 FEJ rekord (174 char):**
    - F217 jogcím kód: a P9-ben megerősített kód (CONFIG fülről olvasva)
    - Összes mező pontosan pozicionálva (fix szélességű, szóközzel feltöltve)
  - **02 TÉTEL rekord (249 char) — számlánként:**
    - T213 összeg (pos 17–26): **egész forint, tizedes TILOS** (`Math.round()`)
    - T214 bankszámlaszám (pos 27–50): bankszerv (8) + számlaszám (16)
    - T218 számlatulajdonos neve (pos 145–179, 35 char): csak az első 32 jut el
    - T219 közlemény (pos 180–249, 70 char): **csak az első 18 jut el** — rövid, egyértelmű szöveg
  - **03 LÁB rekord (24 char)**
  - **IBM 852 / ASCII stratégia** (P11 eredménye alapján):
    - ASCII transzliteráció: á→a, é→e, ő→o, ű→u, ö→o, ü→u, í→i, ó→o, ú→u
    - Ha P11 sikertelen volt: IBM 852 konverziós függvény (külön task)

- [ ] Szerda 14:00 trigger — **autobot@ fiókból!**:
  - JÓVÁHAGYVA státuszú számlák összegyűjtése
  - Devizánként csoportosítás: `groupBy(invoices, 'Deviza')`
  - HUF: CS-ÁTUTALÁS rekord → `.txt` fájl
  - EUR: SEPA (P10 eredménye alapján — addig: stub/skip)
  - Fájlnév: `BATCH-2026-W{hét}-HUF_{dátum}.txt`
  - Drive mentés: `Kötegek/2026/` mappába
  - KÖTEGEK fülre devizánként külön sor felvétele
  - Érintett számlák V oszlopa (KOTEG_ID) kitöltve — Q státusz JÓVÁHAGYVA marad
  - Chat üzenet **Finance webhook**-ra (Péter): Drive fájl link(ek)

- [ ] **+3 napos ellenőrző trigger** (naponta fut):
  - JÓVÁHAGYVA státuszú tételek ahol KOTEG_ID nem üres ÉS utalás dátuma > 3 napja lejárt és nem UTALVA
  - Chat figyelmeztetés Finance webhook-ra (Péter)

**✅ Kész, ha:** Kézi trigger futtatásakor `.txt` kötegállomány generálódik a `Kötegek/2026/` mappában, tartalmaz legalább 1 FEJ + 1 TÉTEL + 1 LÁB rekordot, minden sor pontosan 174/249/24 karakter.

---

## PÉNZÜGYI VEZETŐ (PÉTER) — Task 33 — MagNet NetBank teszt import

> Előfeltétel: Task 32 kész, tesztfájl generálva.

- [ ] A generált `.txt` kötegállomány letöltése Drive-ról
- [ ] MagNet NetBank → **Kötegek** → **Köteg rögzítés** → Típus: **Csoportos átutalás** → **Állomány feltöltése**
- [ ] Eredmény ellenőrzése:
  - **Ha importálható:** ✅ Fázis 3 kész — összeg jóváhagyás előtt visszavonni!
  - **Ha hibát jelez:** visszajelzés a fejlesztőnek:
    - Melyik mező okozza a hibát?
    - Milyen hibaüzenet jelenik meg (screenshot)?
    - Hányadik sor / rekord?

**✅ Kész, ha:** A kötegállomány hiba nélkül importálható MagNet NetBankba (összeg jóváhagyás nélkül visszavonva).

---

## FÁZIS 3 ZÁRÁSI KRITÉRIUM

Fázis 3 csak akkor zárható, ha **mind a 3 task + P9 + P11** kész:

| Task | Felelős | Státusz |
|---|---|---|
| P9 — Jogcím kód | Péter | ☐ |
| P11 — IBM 852 ASCII teszt | Fejlesztő + Péter | ☐ |
| 31 — Szerda 9:00 digest | Fejlesztő | ☐ |
| 32 — getNextWorkday() + batch generátor | Fejlesztő | ☐ |
| 33 — MagNet NetBank teszt import | Péter | ☐ |

**Ellenőrzés:**

- [ ] Kézi trigger → OPS + Finance Chat üzenet megérkezett, tétel-szintű HIÁNYOS_PO bontás helyes
- [ ] `.txt` kötegállomány generált, minden rekord pontos hosszúságú (174/249/24)
- [ ] T213 összeg: egész forint (tizedes nélkül)
- [ ] T219 közlemény: max 18 karaktert érdemes beírni (70 char van, de csak 18 jut el)
- [ ] MagNet NetBank: importálható hiba nélkül (Task 33 ✅)
- [ ] getNextWorkday(): hétvégén/ünnepnapon a következő munkanapot adja vissza
- [ ] KÖTEGEK fülön új sor keletkezett a generálás után
- [ ] Érintett számlák V oszlopa (KOTEG_ID) kitöltve — Q státusz JÓVÁHAGYVA marad (BEKÖTEGELT nem létezik — levezethetó a KOTEG_ID-ből)

Ha bármelyik nem teljesül: **Fázis 4 nem indul el** (de Looker Studio technikailag párhuzamosan megkezdhető).

---

## MI TÖRTÉNIK, HA VALAMI HIÁNYZIK

| Mi hiányzik | Következmény |
|---|---|
| P9 (jogcím kód) | FEJ rekord F217 mező kitöltetlen — MagNet visszautasítja a fájlt |
| P11 sikertelen (bank visszautasítja) | IBM 852 konverziós függvény szükséges — külön fejlesztési task |
| P10 (SEPA) hiányzik | EUR batch nem generálható — EUR számlák nem kerülnek kötegbe |
| WORKING_SATURDAYS nem VERIFIED | getNextWorkday() logol, de téves utalási dátumot adhat — **jogi kockázat** |
| Task 33 hiba (MagNet visszautasítja) | A kötegállomány nem tölthető fel — Péter visszajelzése alapján javítás szükséges |

---

*Következő fázis: Fázis 4 — Looker Studio dashboard. Előfeltétel: SSOT sheet tartalmaz éles adatot (Fázis 1 lezárva).*
