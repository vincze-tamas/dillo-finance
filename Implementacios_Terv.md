# Armadillo Pénzügyi Automatizáció — Implementációs terv

**Verzió:** 1.4
**Dátum:** 2026. március 29.
**Státusz:** Aktív

---

## Validáció — Jelenlegi állapot

| Elem | Állapot | Megjegyzés |
|---|---|---|
| Scope dokumentum | ✅ Kész | `Penzugyi_Automatizacio_Scope.md` |
| Mermaid flowchart | ✅ Kész | `Armadillo-pénzügyi-folyamat.svg` |
| Gmail infrastruktúra | ✅ Megvan | szamlazas@ cím Google-on fut |
| Gemini API key | ✅ Megvan | GCP projekt konfigurálva |
| Robot fiók | ✅ Megvan | autobot@armadillo.hu — triggerek gazdája |
| Partner lista | ⚠️ Részleges | `Banki partnerek.xls` — kiegészítendő |
| Batch formátum spec (HUF) | ✅ Kész | CS-ÁTUTALÁS fix szélességű rekord, IBM 852/ASCII. ATUTAL vs TOMEGA (P9) + SEPA (P10) pending |
| Chat webhook URL-ek | ❌ Hiányzik | IT felelős beállítja |
| Jóváhagyási jogosultak listája | ❌ Hiányzik | Operatív vezető adja meg |
| Google Workspace struktúra | ❌ Nem létezik | Lentebb tervezve |

---

## 1. Google Workspace mappastruktúra

### Ajánlás: Shared Drive (nem My Drive)

Shared Drive: fájlok szervezethez kötöttek, nem személyhez. Ha valaki kilép, semmi nem vész el.
**Létrehozás: manuálisan, autobot@armadillo.hu-ból bejelentkezve Chrome-ban.**

```
Shared Drive: 🏦 Armadillo Pénzügy
│
├── 📊 SSOT/
│   └── [SSOT] Armadillo Pénzügyi Adatbázis.gsheet     ← AZ egyetlen master sheet
│
├── 📥 Bejövő számlák/
│   ├── 2026/
│   │   ├── 01_Január/
│   │   ├── 02_Február/
│   │   ├── 03_Március/
│   │   └── ...  (Apps Script hozza létre automatikusan, ha hiányzik)
│   └── _VISSZAUTASÍTOTT/
│
├── 📦 Kötegek/
│   └── 2026/
│       ├── 2026-W11_koteg_HUF_2026-03-11.txt          ← devizánként külön fájl
│       ├── 2026-W11_koteg_EUR_2026-03-11.txt
│       └── ...
│
├── 📊 Dashboard/
│
└── ⚙️ Rendszer/
    └── Dokumentáció/
        ├── Penzugyi_Automatizacio_Scope.md
        └── Armadillo-pénzügyi-folyamat.svg
```

### Jogosultságok

| Mappa | Operatív vezető | Pénzügyi vezető | IT felelős / autobot@ | Könyvelő (jövő) |
|---|---|---|---|---|
| SSOT/ | Szerkesztő | Szerkesztő | Szerkesztő | Olvasó |
| Bejövő számlák/ | Olvasó | Szerkesztő | Szerkesztő | Olvasó |
| Kötegek/ | Olvasó | Szerkesztő | Szerkesztő | Olvasó |
| Rendszer/ | Olvasó | Olvasó | Szerkesztő | — |

### Apps Script elhelyezése

Container-bound script a `[SSOT] Armadillo Pénzügyi Adatbázis` sheet-hez kötve.
Megnyitás: Shared Drive sheet → Extensions → Apps Script.
**Triggereket autobot@armadillo.hu fiókból kell létrehozni — nem személyes fiókból.**

---

## 2. Gmail routing — szamlazas@ → autobot@

**Megoldás: Google Group (nem Gmail forward)**

A `szamlazas@armadillo.hu` legyen Google Group vagy routing alias, amely kézbesít `autobot@armadillo.hu`-ra.
- Forward helyett kézbesítés: csatolmány-integritás garantált
- Ha autobot@-t le kell cserélni, csak a Group tagságát kell módosítani
- Gmail filter a scriptben: `in:inbox is:unread has:attachment` (autobot@ saját inboxát nézi)

**IT felelős feladata, PRE-0-ban.**

---

## 3. SSOT Sheet felépítése (7 fül)

### BEJÖVŐ_SZÁMLÁK — fejlécek

| Oszlop | Mező | Megjegyzés |
|---|---|---|
| A | Számla ID | Auto, pl. INV-2026-001 |
| B | Fogadás dátuma | |
| C | Szállító neve | Gemini kinyeri |
| D | Szállító adószáma | Gemini kinyeri |
| E | Számla száma | Gemini kinyeri |
| F | Számla kelte | |
| G | Teljesítés dátuma | |
| H | Fizetési határidő | |
| I | Nettó összeg | |
| J | ÁFA összeg | |
| K | Bruttó összeg | |
| L | Deviza | HUF / EUR — dropdown |
| M | Kategória | PROJEKT / ÁLLANDÓ — dropdown |
| N | PO_SUMMARY | konkrét PO / MULTI / HIÁNYOS — Gemini aggregálja tételszintről |
| O | PO_CONFIDENCE | aggregált: 1 PO → annak conf.-je; MULTI → MIN(tételek conf.); HIÁNYOS → 0 |
| P | PO_REASONING | aggregált: 1 PO → AI reasoning; MULTI → "MULTI_TETEL – lásd SZÁMLA_TÉTELEK"; HIÁNYOS → "NINCS_PO" |
| Q | Státusz | Dropdown — státuszgép |
| R | Jóváhagyó neve | |
| S | Jóváhagyás dátuma | |
| T | Köteg ID | FK → KÖTEGEK fül |
| U | Teljesítés dátuma (tényleges) | Pénzügyi vezető tölti ki |
| V | Drive PDF link | |
| W | Gmail message ID | Deduplikációhoz |
| X | Utolsó módosítás | Auto |

### SZÁMLA_TÉTELEK — fejlécek

| Oszlop | Mező |
|---|---|
| A | Számla ID (FK → BEJÖVŐ_SZÁMLÁK) |
| B | Sor sorszám |
| C | Tétel leírása |
| D | Mennyiség |
| E | Egységár |
| F | Nettó összeg |
| G | ÁFA kulcs |
| H | ÁFA összeg |
| I | Bruttó összeg |
| J | Projektszám (tétel szintű) | FK → PROJEKTEK.A — validálva M oszlopban |
| K | PO_CONFIDENCE | 0–100, Gemini adja — tétel szinten |
| L | PO_REASONING | Gemini magyarázat — tétel szinten |
| M | PO_VALIDÁLT | IGEN/NEM — auto: IGEN ha J ∈ PROJEKTEK.A és K ≥ 95 |

*SZÁMLA_TÉTELEK az elsődleges forrás (source of truth). BEJÖVŐ_SZÁMLÁK N/O/P csak aggregált summary layer.*

### PROJEKTEK — fejlécek

| Oszlop | Mező |
|---|---|
| A | Projektszám (pl. IMME2601) |
| B | Projekt neve |
| C | Ügyfél neve |
| D | Kezdés dátuma |
| E | Befejezés dátuma |
| F | Státusz (AKTÍV/LEZÁRT) |
| G | Projekt vezető |

### PARTNEREK — fejlécek

| Oszlop | Mező |
|---|---|
| A | Partner neve |
| B | Adószám |
| C | Bankszámlaszám (IBAN) |
| D | Kategória (PROJEKT/ÁLLANDÓ) |
| E | Kapcsolattartó email |
| F | Alapértelmezett fizetési határidő (napokban) |
| G | Aktív (IGEN/NEM) |

*Forrás: `Banki partnerek.xls` részlegesen feltölthető, kiegészítendő.*

### KÖTEGEK — fejlécek

| Oszlop | Mező |
|---|---|
| A | Köteg ID (pl. BATCH-2026-W11-HUF) |
| B | Generálás dátuma |
| C | Utalás dátuma (kalkulált, munkanapos) |
| D | Deviza (HUF / EUR) |
| E | Számlák száma |
| F | Teljes összeg |
| G | Drive fájl link |
| H | Státusz (GENERÁLT/FELTÖLTVE/TELJESÍTVE) |

*Devizánként külön sor — egy szerdán 2 sor keletkezhet (HUF + EUR).*

### KIMENŐ_SZÁMLÁK — fejlécek

| Oszlop | Mező |
|---|---|
| A | Számla száma |
| B | Kiállítás dátuma |
| C | Ügyfél neve |
| D | Összeg |
| E | Fizetési határidő |
| F | Befizetve dátuma |
| G | Státusz (NYITOTT/KÉSEDELMES/FIZETVE) |

### CONFIG fül — struktúra (ÚJ, 7. fül)

| Kulcs | Érték | Státusz |
|---|---|---|
| HOLIDAYS_2026 | 2026-01-01,2026-03-15,2026-04-06,... | VERIFIED |
| HOLIDAYS_2027 | (üres) | ELLENŐRZENDŐ |
| WORKING_SATURDAYS_2026 | 2026-03-28,2026-10-10 | VERIFIED |
| WORKING_SATURDAYS_2027 | (üres) | ELLENŐRZENDŐ |
| PO_CONFIDENCE_THRESHOLD | 95 | — |
| ADMIN_EMAIL | autobot@armadillo.hu | — |

**Fontos:** `getNextWorkday()` csak VERIFIED státuszú sorokat alkalmaz. ELLENŐRZENDŐ esetén logol és admin emailt küld.

---

## 3.5 SSOT validációs réteg

A rendszer 4 típusú validációt alkalmaz a manuális adatbevitel hibáinak megelőzésére:

| Típus | Fül / Oszlop | Szabály |
|---|---|---|
| Dropdown | BEJÖVŐ_SZÁMLÁK Q | BEÉRKEZETT / HIÁNYOS_PO / VISSZAUTASÍTVA / JÓVÁHAGYVA / BEKÖTEGELT / TELJESÍTVE / AI_HIBA |
| Dropdown | BEJÖVŐ_SZÁMLÁK L | HUF / EUR |
| Dropdown | BEJÖVŐ_SZÁMLÁK M | PROJEKT / ÁLLANDÓ |
| FK referencia | SZÁMLA_TÉTELEK J → PROJEKTEK A | VLOOKUP ellenőrzés: ha J érték nem szerepel PROJEKTEK.A-ban → piros kiemelés |
| Formátum regex | PROJEKTEK A | `^[A-Z]{4}[0-9]{4}$` (pl. IMME2601) |
| Numerikus range | SZÁMLA_TÉTELEK K (PO_CONFIDENCE) | 0–100 |

**Apps Script oldal:** `onEdit` trigger futtatja a `validateRow()` függvényt. Hibás sor piros háttérszínt kap; a hiba rögzítésre kerül a CONFIG fül hibalog sorában.

---

## 4. Ünnepnapok és áthelyezett munkanapok architektúrája

### Két réteg, teljes külső API-függőség nélkül

**Ünnepnapok (HOLIDAYS):** Nager.Date API — de csak éves cache-eléshez, NEM runtime híváshoz.

```javascript
// Január 1-jén fut (scheduled task), withRetry-ba burkolva
function refreshHolidaysCache(year) {
  const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/HU`;
  const holidays = JSON.parse(UrlFetchApp.fetch(url).getContentText())
    .map(h => h.date).join(',');
  // CONFIG fülre írja, státusz: ELLENŐRZENDŐ
  // Chat értesítő: "Ellenőrizd és VERIFIED-re állítsd"
}
```

**Szerdai kód soha nem hív külső API-t** — csak CONFIG fülről olvas. 100% stabil.

**Áthelyezett szombatok (WORKING_SATURDAYS):** CONFIG fülben tárolva, december 1-jei reminder (schedule skill).

---

## 5. Deviza batch splitting + kötegállomány formátum (Fázis 3)

HUF → CS-ÁTUTALÁS fix szélességű rekord (.txt), EUR → SEPA (formátum: P10 után). MagNet devizánként külön feltöltést vár.

**⚠️ A formátum NEM CSV — fix szélességű rekord, IBM 852 / ASCII kódolás.**

### HUF kötegállomány struktúra (CS-ÁTUTALÁS, 14.1.5)

| Rekord | Hossz | Db | Kódolás |
|---|---|---|---|
| 01 FEJ | 174 char | 1 | IBM 852 / ASCII |
| 02 TÉTEL | 249 char | 1–999 999 | IBM 852 / ASCII |
| 03 LÁB | 24 char | 1 | ASCII (ékezet nélkül) |

**Kulcsmezők (02 TÉTEL):**
- T213 összeg (pos 17–26, 10 char): **egész forint, tizedesrész TILOS**
- T214 bankszámlaszám (pos 27–50): bankszerv (8) + számlaszám (16)
- T218 számlatulajdonos neve (pos 145–179, 35 char): **K, kötelező**; csak első 32 jut el
- T219 közlemény (pos 180–249, 70 char): **csak az első 18 karakter jut el** a kedvezményezetthez

**IBM 852 / ASCII stratégia:** ékezetes karakterek transzliterációja (á→a, é→e, ő→o, ű→u). Teszt: P11 feladat.

```javascript
// Szerda 14:00 — devizánként külön kötegállomány
const byDeviza = groupBy(approvedInvoices, 'Deviza');
Object.entries(byDeviza).forEach(([currency, invoices]) => {
  const content = generateBatchTxt(invoices, currency); // fix szélességű rekord
  const filename = `${batchId}_${currency}_${dateStr}.txt`;
  saveToDrive(content, filename, 'text/plain');
  appendToKotegek(batchId, currency, invoices, filename);
});
```

---

## 6. Implementációs sorrend

### PRE-0: Előkészítés (1-2 nap, nem kód)

1. `Banki partnerek.xls` megnyitása → adatok ellenőrzése, kiegészítés
2. MagNet batch spec: HUF CS-ÁTUTALÁS ✅ kész (`magnet_batch_spec.md`). Még szükséges: **P9** (jogcím kód Pétertől), **P10** (SEPA formátum), **P11** (IBM 852 ASCII teszt)
3. IT felelős: Google Chat webhook URL-ek létrehozása (3 db: OPS, Finance, Admin)
4. **IT felelős: `szamlazas@armadillo.hu` Google Group → autobot@-ra kézbesít** (forward HELYETT)
5. Shared Drive létrehozása "🏦 Armadillo Pénzügy" — autobot@-ból, Chrome-ban manuálisan
6. Mappastruktúra kialakítása + jogosultságok beállítása

### Fázis 0: SSOT Sheet + Apps Script projekt (1 nap)

- SSOT sheet létrehozása Shared Drive SSOT/ mappájában
- Mind a 7 fül létrehozása (beleértve CONFIG fül)
- Data validation: státusz, kategória, deviza dropdown-ok
- Conditional formatting: státuszok szerint színkódolás
- **SSOT validációs réteg beállítása:** FK referencia (SZÁMLA_TÉTELEK J → PROJEKTEK A), projektszám regex, PO_CONFIDENCE numerikus range, `validateRow()` onEdit trigger
- Apps Script projekt megnyitása **autobot@ fiókból** (container-bound)
- CONFIG object + PropertiesService Gemini key beállítása
- PARTNEREK fül feltöltése `Banki partnerek.xls` adataival

```javascript
const CONFIG = {
  ADMIN_EMAIL: "autobot@armadillo.hu",
  GEMINI_MODEL: "gemini-1.5-pro",
  PO_CONFIDENCE_THRESHOLD: 95,
  INVOICES_FOLDER_ID: "...",      // Shared Drive folder ID-k — élesítéskor
  REJECTED_FOLDER_ID: "...",
  BATCHES_FOLDER_ID: "...",
  CHAT_WEBHOOK_OPS: "...",       // 🟢 Pénzügy-Jóváhagyások (Ági + Márk)
  CHAT_WEBHOOK_FINANCE: "...",   // 🏦 Pénzügy-Utalások (Péter)
  CHAT_WEBHOOK_ADMIN: "...",     // 🤖 IT Rendszerlogok (IT only)
  APPROVAL_DIGEST_HOUR: 9,
  BATCH_GEN_HOUR: 14,
  OVERDUE_CHECK_DAYS: 3,
  REMINDER_DAYS_BEFORE_DUE: 7,
};
// Gemini key: PropertiesService.getScriptProperties() — soha nem hardcode
```

### Fázis 1: Gmail befogadó + Gemini OCR (2-3 nap)

- Time-driven trigger: 15 percenként (autobot@ fiókból létrehozva)
- Gmail filter: `in:inbox is:unread has:attachment` (autobot@ saját inboxát nézi)
- PDF Drive-ra mentés — **első lépés, mindig, még OCR előtt**
- Gemini API hívás: `withRetry(fn, 3, 30000)`, structured JSON — **tétel szintű** `po_confidence` + `po_reasoning` (SZÁMLA_TÉTELEK K, L oszlop); fejléc szinten `po_summary` aggregálva (BEJÖVŐ_SZÁMLÁK N oszlop)
- Státusz-döntés: ha **bármely tétel** PO_VALIDÁLT = NEM → HIÁNYOS_PO; ha minden tétel OK → BEÉRKEZETT
- SSOT írás LockService tranzakcióban (fejléc + tételsorok atomikusan)
- Gmail message ID deduplication (W oszlop)
- Hibakezelés: try-catch → AI_HIBA státusz → notifyAdmin()

### Fázis 2: HIÁNYOS_PO + visszautasító email trigger (1 nap)

- HIÁNYOS_PO routing: legalább 1 tétel PO_VALIDÁLT = NEM (conf < 95 VAGY PO nem szerepel PROJEKTEK-ben)
- ÁLLANDÓ kategória: PO nem szükséges → PO_SUMMARY = N/A → direkt BEÉRKEZETT
- OPS Chat értesítő HIÁNYOS_PO esetén — tétel-szintű bontás:
  ```
  ⚠️ HIÁNYOS_PO: [Szállító neve] — [Összeg]
    sor 1: "[Tétel leírás]" → PO: [érték] | Conf: [%] | [Gemini reasoning]
    sor 2: "[Tétel leírás]" → PO: HIÁNYZIK | Conf: 42% | [Gemini reasoning]
  ```
- onEdit trigger: Q oszlop → VISSZAUTASÍTVA → visszautasító email sablonból
- Chat webhook hiba → Gmail fallback értesítő

### Fázis 3: Szerdai workflow (2 nap)

*Előfeltétel: HUF spec ✅ kész. P9 (jogcím kód) + P11 (ASCII teszt) szükséges a HUF-ághoz. P10 (SEPA) az EUR-ághoz.*

- Szerda 9:00: jóváhagyási digest (ops + finance külön Chat üzenet, 7 napos lejárati figyelmeztetés)
- Szerda 14:00: batch generálás devizánként (HUF + EUR külön kötegállomány .txt)
- Utalás dátum kalkuláció: CONFIG fülről olvas (HOLIDAYS + WORKING_SATURDAYS, csak VERIFIED)
- KÖTEGEK fülre devizánként külön sor
- +3 napos ellenőrző trigger (naponta futó)

### Fázis 4: Looker Studio dashboard (1-2 nap)

- Adatforrás: SSOT sheet (Google Sheets connector)
- Data Blend: BEJÖVŐ_SZÁMLÁK + SZÁMLA_TÉTELEK Left Outer Join Számla ID alapján (projekt P&L)
- Oldalak: Főoldal · Cash flow (30 nap) · ÁFA (havi) · Kintlévőség · Lejárt tételek (15/30/60+)

### Fázis 5: Éves karbantartó scheduled task-ok (schedule skill)

- **Január 1.:** Nager.Date API fetch → HOLIDAYS cache frissítése CONFIG fülön → Chat értesítő
- **December 1.:** WORKING_SATURDAYS emlékeztető → Chat: "Töltsd ki és VERIFIED-re állítsd"

---

## 7. Szükséges inputok összesítve

| Input | Forrás | Mikor kell | Blokkoló? |
|---|---|---|---|
| MagNet batch spec (HUF) | ✅ Kész | Fázis 3 | — |
| Jogcím kód (P9) | Pénzügyi vezető (Péter) | Fázis 3 előtt | Igen — HUF batch |
| SEPA köteg formátum (P10) | Pénzügyi vezető (Péter) | Fázis 3 (EUR) | Csak EUR-hoz |
| IBM 852 ASCII teszt (P11) | Fejlesztő + Péter | Fázis 3 előtt | Igen — HUF batch |
| `Banki partnerek.xls` kiegészítése | Pénzügyi vezető | PRE-0 | Igen — Fázis 0 |
| szamlazas@ Google Group beállítása | IT felelős | PRE-0 | Igen — Fázis 1 |
| Chat webhook URL-ek (3 db: OPS, Finance, Admin) | IT felelős | Fázis 1 előtt | Igen |
| Aktív projektek listája (PROJEKTEK fül) | Operatív vezető (Ági) | Fázis 0 előtt (P12) | Igen — BLOKKOLÓ |
| Jóváhagyási jogosultak listája | Operatív vezető | Fázis 0 | Nem |
| WORKING_SATURDAYS_2026 lista | Magyar Közlöny ellenőrzés | Fázis 0 | Nem |

---

## 8. Ellenőrzési terv

| Fázis | Sikerességi kritérium |
|---|---|
| Fázis 0 | Sheet megnyílik, 7 fül megvan, dropdown-ok működnek, Apps Script projekt elérhető autobot@-ból |
| Fázis 0 | validateRow() trigger hibás projektszámot piros kiemeléssel jelöl |
| Fázis 1 | Tesztszámla feldolgozva: PDF Drive-on, SSOT sorok megjelennek, SZÁMLA_TÉTELEK K/L/M kitöltve, PO_SUMMARY N oszlopban aggregált, státusz korrekt |
| Fázis 2 | HIÁNYOS_PO tétel manuálisan VISSZAUTASÍTVA → email kiküldve |
| Fázis 3 | Kézi trigger → 2 kötegállomány (.txt) generálva (HUF + EUR), MagNet NetBankba importálható |
| Fázis 4 | Dashboard valós adatot mutat, Data Blend projekt szintű P&L-t mutat |
| Fázis 5 | Január 1-jei és december 1-jei scheduled task-ok létrehozva és tesztelve |

---

*Következő lépés: P9 (jogcím kód Pétertől) + P11 (IBM 852 ASCII teszt, 1 Ft-os próba) → HUF batch generátor kód írható. P10 (SEPA) az EUR-ág előtt szükséges.*
