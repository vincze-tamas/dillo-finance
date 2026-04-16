# FÁZIS 0 VÉGREHAJTÁSI PLAYBOOK
## Armadillo Pénzügyi Automatizáció

**Verzió:** 1.1 · **Dátum:** 2026-03-29
**Státusz:** Végrehajtásra kész

---

## FÜGGŐSÉGI SORREND — MI BLOKKOL MIT

```
IT felelős (P3, P4) ──────┐
IT felelős (P5)  ─────────┼──► Fejlesztő (01, 02, 03)
Péter (P6)  ──────────────┼──► Péter (04)
Ági (P12)  ───────────────┴──► Ági (05)
```

**Ha ezek nincsenek kész, nem szabad elkezdeni Fázis 0-t:**

| Blokkoló | Felelős | Mit blokkol |
|---|---|---|
| P3 — Shared Drive létrehozás | IT felelős | 01, 02, 03 |
| P4 — Jogosultságok | IT felelős | 01, 02, 03 |
| P5 — Gemini API key | IT felelős | 03 |
| P6 — Banki partnerek.xls | Péter | 04 |
| P12 — Aktív projektek lista | Ági | 05 |

**Ha P1 vagy P2 is hiányzik:** Fázis 0 elindul, de Fázis 1 NEM. Időpazarlás előbb startolni.

---

## IT FELELŐS — PRE-0 feladatok

> ⚠️ Ezeket Fázis 0 ELŐTT kell elvégezni. P3 és P4 nélkül a fejlesztő nem tud dolgozni.

### P3 — Shared Drive létrehozás + mappastruktúra

- [ ] Chrome → bejelentkezés: `autobot@armadillo.hu`
- [ ] drive.google.com → bal oldalt: **Shared drives** → **+ New**
- [ ] Név: `🏦 Armadillo Pénzügy` → **Create**
- [ ] Belépés a Drive-ba → mappák létrehozása ebben a sorrendben:
  - [ ] `SSOT/`
  - [ ] `Bejövő számlák/`
  - [ ] `Bejövő számlák/2026/`
  - [ ] `Bejövő számlák/2026/01_Január/`
  - [ ] `Bejövő számlák/2026/02_Február/`
  - [ ] `Bejövő számlák/2026/03_Március/`
  - [ ] `Bejövő számlák/2026/04_Április/`
  - [ ] `Bejövő számlák/2026/05_Május/`
  - [ ] `Bejövő számlák/2026/06_Június/`
  - [ ] `Bejövő számlák/2026/07_Július/`
  - [ ] `Bejövő számlák/2026/08_Augusztus/`
  - [ ] `Bejövő számlák/2026/09_Szeptember/`
  - [ ] `Bejövő számlák/2026/10_Október/`
  - [ ] `Bejövő számlák/2026/11_November/`
  - [ ] `Bejövő számlák/2026/12_December/`
  - [ ] `Bejövő számlák/_VISSZAUTASÍTOTT/`
  - [ ] `Kötegek/`
  - [ ] `Kötegek/2026/`
  - [ ] `Dashboard/`
  - [ ] `Rendszer/`
  - [ ] `Rendszer/Dokumentáció/`

**✅ Kész, ha:** `🏦 Armadillo Pénzügy` megjelenik a Shared drives-ban, mind a 21 mappa látható.

---

### P4 — Jogosultságok beállítása

> Előfeltétel: P3 kész.

- [ ] `🏦 Armadillo Pénzügy` Shared Drive → jobb klikk → **Manage members**
- [ ] Operatív vezető (Ági) hozzáadása: **Content manager**
- [ ] Pénzügyi vezető (Péter) hozzáadása: **Content manager**
- [ ] `Rendszer/` mappa → jobb klikk → **Share** → Ági és Péter jogosultságát **Viewer**-re csökkenteni
- [ ] `Rendszer/` mappán marad: csak IT felelős + `autobot@armadillo.hu` mint Szerkesztő

**✅ Kész, ha:** Ági és Péter belépnek a Shared Drive-ba, látják a mappákat. `Rendszer/`-ben NEM tudnak írni.

---

### P5 — Gemini API key átadása fejlesztőnek

- [ ] GCP projekt → API Keys → a már meglévő key kimásolása
- [ ] Biztonságos csatornán átadja a fejlesztőnek (nem emailben, nem Sheetben)
- [ ] Jelzi a fejlesztőnek, hogy az átadás megtörtént

**✅ Kész, ha:** Fejlesztő visszajelzett, hogy megkapta.

---

### P1 — Google Group beállítása *(nem blokkol Fázis 0-t, de Fázis 1-et igen)*

- [ ] admin.google.com → **Groups** → **Create group**
- [ ] Csoport email: `szamlazas@armadillo.hu`
- [ ] Tag hozzáadása: `autobot@armadillo.hu`
- [ ] **Email delivery settings** → **Each email** (nem Digest, nem Abridged)
- [ ] Ellenőrzés: tesztlevél küldése `szamlazas@armadillo.hu`-ra → megjelenik-e `autobot@` inboxában?

**✅ Kész, ha:** A tesztlevél csatolmánnyal együtt megjelenik az `autobot@` fiókban.

---

### P2 — Chat webhook URL-ek *(nem blokkol Fázis 0-t, de Fázis 1-et igen)*

- [ ] Google Chat → **Pénzügy-Jóváhagyások** space → jobb felül ▼ → **Apps & integrations** → **Add webhooks** → Név: `Armadillo Bot OPS` → **Save** → URL másolás
- [ ] Google Chat → **Pénzügy-Utalások** space → ugyanígy → Név: `Armadillo Bot Finance` → URL másolás
- [ ] Google Chat → **IT Rendszerlogok** space → ugyanígy → Név: `Armadillo Bot Admin` → URL másolás
- [ ] Mind a 3 URL-t átadja a fejlesztőnek (biztonságos csatornán)

**✅ Kész, ha:** Fejlesztő visszaigazolta a 3 URL-t.

---

## PÉNZÜGYI VEZETŐ — PÉTER — PRE-0 + Fázis 0

### P6 — Banki partnerek.xls kiegészítése *(BLOKKOLÓ — Task 04 előfeltétele)*

- [ ] Megnyitni: `Banki partnerek.xls`
- [ ] Minden partnernél kitölteni — ha bármelyik hiányzik, a sort nem lehet importálni:
  - [ ] Teljes név — **pontosan**, ahogy a számlán szerepel
  - [ ] IBAN bankszámlaszám
  - [ ] Kategória: `PROJEKT` vagy `ÁLLANDÓ` (csak ez a két érték)
  - [ ] Aktív: `IGEN` vagy `NEM`
- [ ] Ha egy partnernél az IBAN hiányzik: sort meghagyni, de az IBAN cellát üresen hagyni (nem törölni a sort)
- [ ] Mentés → átadja a fejlesztőnek, vagy várja, amíg a fejlesztő megnyitja Task 04-hez

**✅ Kész, ha:** Minden aktív partner sorában a 4 kötelező mező ki van töltve. Ági visszajelzett, hogy P12 is kész (ne induljon be Task 04 előbb, mint Task 05 adatai is megvannak).

---

### Task 04 — PARTNEREK fül feltöltése *(Fázis 0)*

> Előfeltétel: P3, P4 kész (Sheet elérhető) + P6 kész. Fejlesztő elvégezte Task 01-et.

- [ ] Megnyitni az SSOT sheetet: `[SSOT] Armadillo Pénzügyi Adatbázis`
- [ ] Fül: **PARTNEREK**
- [ ] A kiegészített `Banki partnerek.xls` adatait bemásolni az alábbi oszloprendben:

| Oszlop | Tartalom |
|---|---|
| A | Partner neve |
| B | Adószám |
| C | Bankszámlaszám (IBAN) |
| D | Kategória (`PROJEKT` / `ÁLLANDÓ`) |
| E | Kapcsolattartó email |
| F | Alapértelmezett fizetési határidő (napokban) |
| G | Aktív (`IGEN` / `NEM`) |

- [ ] Ha egy sor D oszlopa nem `PROJEKT` vagy `ÁLLANDÓ` → javítani, másolás előtt
- [ ] Ha egy sor C oszlopa (IBAN) üres → sort felvenni, de megjegyezni Péternek: ez a partner nem fizethető ki

**✅ Kész, ha:** PARTNEREK fülön minden aktív partner szerepel, D és G oszlop értékei csak a megengedett értékeket tartalmazzák.

---

### P9 — MagNet jogcím kód megerősítése *(nem blokkol Fázis 0-t, de Fázis 3-at igen)*

- [ ] MagNet NetBank → **Kötegek** → **Köteg rögzítés** → Típus: **ATUTAL**
- [ ] FEJ rekordnál: megkeresni a **Jogcím** legördülőt
- [ ] Szállítói utaláshoz a helyes kód kikeresése (feltételezett: `K01`)
- [ ] A pontos kódot átadja a fejlesztőnek

**✅ Kész, ha:** Fejlesztő visszaigazolta.

---

## OPERATÍV VEZETŐ — ÁGI — PRE-0 + Fázis 0

### P12 — Aktív projektek listájának összeállítása *(BLOKKOLÓ — Task 05 előfeltétele)*

- [ ] Összegyűjteni minden aktív projektet
- [ ] Minden projekthez kitölteni:
  - [ ] **Projektszám** — KÖTELEZŐ formátum: `XXXX + ÉÉ + SS` → pl. `IMME2601`, `BUDA2602`
    - X = nagybetű, ÉÉ = évszám utolsó 2 jegye, SS = sorszám 2 jeggyel
    - Eltérő formátum = nem importálható. Nem kivétel.
  - [ ] Projekt neve
  - [ ] Ügyfél neve
  - [ ] Kezdés dátuma
  - [ ] Befejezés dátuma (ha ismert)
  - [ ] Státusz: `AKTÍV` vagy `LEZÁRT`
  - [ ] Projekt vezető neve
- [ ] Lezárt projektek is felvehetők `LEZÁRT` státusszal — a rendszer nem utasítja el a számlákat, de a riportokban elkülönülnek
- [ ] Elkészített listát átadni a fejlesztőnek, vagy közvetlenül Task 05-kor bevinni

**✅ Kész, ha:** Az összes aktív projekt szerepel, minden projektszám megfelel a `^[A-Z]{4}[0-9]{4}$` formátumnak.

---

### P7 — Jóváhagyásra jogosultak listája *(nem BLOKKOLÓ, de szerdai digest-hez kell)*

- [ ] Összeállítani: ki hagyhat jóvá `PROJEKT` kategóriájú számlát
- [ ] Minden személyhez: teljes név + munkahelyi email
- [ ] Átadja a fejlesztőnek

**✅ Kész, ha:** Lista átadva. Ha ez késik, a szerdai digest értesítők hiányos személyeknek nem mennek el.

---

### Task 05 — PROJEKTEK fül feltöltése *(Fázis 0)*

> Előfeltétel: P3, P4 kész + P12 kész. Fejlesztő elvégezte Task 01-et.

- [ ] Megnyitni: `[SSOT] Armadillo Pénzügyi Adatbázis` → fül: **PROJEKTEK**
- [ ] P12 alatti listát bemásolni az alábbi oszloprendben:

| Oszlop | Tartalom |
|---|---|
| A | Projektszám (pl. `IMME2601`) |
| B | Projekt neve |
| C | Ügyfél neve |
| D | Kezdés dátuma |
| E | Befejezés dátuma |
| F | Státusz (`AKTÍV` / `LEZÁRT`) |
| G | Projekt vezető |

- [ ] Másolás előtt projektszám formátum ellenőrzése minden sornál: `XXXX + ÉÉ + SS`
- [ ] Ha egy sor nem felel meg: javítani, nem felvenni. Félformátumú projektszám = Gemini matching törött.

**✅ Kész, ha:** PROJEKTEK fülön minden aktív projekt szerepel, A oszlopban nincs hibás formátumú érték.

---

## FEJLESZTŐ — Fázis 0 *(autobot@ fiókból elvégezve)*

> Előfeltétel: P3 + P4 kész (Drive elérhető), P5 kész (Gemini key megvan).
> Task 01 nélkül Task 02 és 03 nem indítható.

### Task 01 — SSOT Sheet létrehozása

- [ ] Chrome → bejelentkezés: `autobot@armadillo.hu`
- [ ] drive.google.com → Shared drives → `🏦 Armadillo Pénzügy` → `SSOT/` mappa
- [ ] **+ New → Google Sheets**
- [ ] Sheet neve: `[SSOT] Armadillo Pénzügyi Adatbázis`
- [ ] 7 fül létrehozása **ebben a sorrendben** (fül neve pontosan így):
  - [ ] `BEJÖVŐ_SZÁMLÁK`
  - [ ] `SZÁMLA_TÉTELEK`
  - [ ] `PROJEKTEK`
  - [ ] `PARTNEREK`
  - [ ] `KÖTEGEK`
  - [ ] `KIMENŐ_SZÁMLÁK`
  - [ ] `CONFIG`
- [ ] Fejlécek beírása minden fülre (Implementációs terv **3. fejezet** oszlopai szerint)

**✅ Kész, ha:** Sheet megnyílik `autobot@` fiókból, 7 fül látható, fejlécek kint vannak.

---

### Task 02 — Data validation + conditional formatting

> Előfeltétel: Task 01 kész.

**BEJÖVŐ_SZÁMLÁK fül:**

- [ ] Q oszlop (Státusz) → **Data → Data validation → Dropdown (from a list):**
  `BEÉRKEZETT,HIÁNYOS_PO,VISSZAUTASÍTVA,JÓVÁHAGYVA,UTALVA,AI_HIBA,LOCK_TIMEOUT`
- [ ] L oszlop (Deviza) → **Data validation → Dropdown:** `HUF,EUR`
- [ ] M oszlop (Kategória) → **Data validation → Dropdown:** `PROJEKT,ÁLLANDÓ`
- [ ] Conditional formatting — soronként, Q oszlop értéke alapján:
  - [ ] `BEÉRKEZETT` → sor háttere: **kék** (`#cfe2f3`)
  - [ ] `HIÁNYOS_PO` → sor háttere: **sárga** (`#fff2cc`)
  - [ ] `VISSZAUTASÍTVA` → sor háttere: **piros** (`#f4cccc`)
  - [ ] `JÓVÁHAGYVA` → sor háttere: **zöld** (`#d9ead3`)
  - [ ] `UTALVA` → sor háttere: **lila** (`#d9d2e9`)
  - [ ] `AI_HIBA` → sor háttere: **sötétpiros** (`#990000`, fehér betű)
  - [ ] `LOCK_TIMEOUT` → sor háttere: **narancs** (`#f9cb9c`)
  *(BEKÖTEGELT nem státusz — a V oszlop KOTEG_ID értékéből levezethető)*

**PROJEKTEK fül:**

- [ ] A oszlop → **Data validation → Custom formula:**
  `=REGEXMATCH(A2,"^[A-Z]{4}[0-9]{4}$")`
  Beállítás: **Reject input** (nem figyelmeztetés, hanem elutasítás)

**SZÁMLA_TÉTELEK fül:**

- [ ] J oszlop (Projektszám FK) → Conditional formatting → Custom formula:
  `=AND(J2<>"",ISNA(MATCH(J2,PROJEKTEK!$A:$A,0)))`
  → cella háttere: **piros** (ha a beírt projektszám nem szerepel a PROJEKTEK fülön)
- [ ] K oszlop (PO_CONFIDENCE) → **Data validation → Number → between 0 and 100**

**✅ Kész, ha:** Tesztsor felvitelekor a dropdownok megjelennek, hibás projektszám piros kiemelést kap, Q oszlop értéke szerint a sor színeződik.

---

### Task 03 — Apps Script projekt + CONFIG + Gemini key beállítása

> Előfeltétel: Task 01 kész + P5 kész (Gemini key megvan).

- [ ] SSOT sheet megnyitva `autobot@` fiókból → **Extensions → Apps Script**
- [ ] Projekt neve (bal felül): `Armadillo Pénzügyi Bot`
- [ ] Új `.gs` fájl: `Config.gs`
- [ ] CONFIG object beírása (folder ID-k kitöltése a ténylegesen létrehozott Drive mappák ID-jával):

```javascript
const CONFIG = {
  ADMIN_EMAIL: "autobot@armadillo.hu",
  GEMINI_MODEL: "gemini-1.5-pro",
  PO_CONFIDENCE_THRESHOLD: 95,
  INVOICES_FOLDER_ID: "",      // Bejövő számlák/2026/ mappa ID
  REJECTED_FOLDER_ID: "",      // _VISSZAUTASÍTOTT/ mappa ID
  BATCHES_FOLDER_ID: "",       // Kötegek/2026/ mappa ID
  CHAT_WEBHOOK_OPS: "",        // IT felelős adja meg (P2)
  CHAT_WEBHOOK_FINANCE: "",    // IT felelős adja meg (P2)
  CHAT_WEBHOOK_ADMIN: "",      // IT felelős adja meg (P2)
  APPROVAL_DIGEST_HOUR: 9,
  BATCH_GEN_HOUR: 14,
  OVERDUE_CHECK_DAYS: 3,
  REMINDER_DAYS_BEFORE_DUE: 7,
};
```

- [ ] Folder ID-k kiderítése: Drive-ban az adott mappára jobb klikk → **Get link** → az URL-ből a `folders/` utáni rész az ID
- [ ] Gemini API key mentése — **CSAK ÍGY, sehol máshol:**

```javascript
function saveGeminiKey() {
  PropertiesService.getScriptProperties().setProperty('GEMINI_KEY', 'IDE_A_KULCS');
}
```

- [ ] Futtatás: Script Editorban `saveGeminiKey` kiválasztása → ▶ Run → engedélyezés megerősítése
- [ ] A `saveGeminiKey` function ezután **törlendő** a kódból (a key PropertiesService-ben marad)
- [ ] CONFIG fül kitöltése (Sheet-ben, `CONFIG` fülön):

| Kulcs | Érték | Státusz |
|---|---|---|
| HOLIDAYS_2026 | `2026-01-01,2026-03-15,2026-04-06,2026-04-07,2026-05-01,2026-05-21,2026-06-19,2026-08-20,2026-10-23,2026-11-01,2026-12-25,2026-12-26` | `VERIFIED` |
| HOLIDAYS_2027 | *(üresen hagyni)* | `ELLENŐRZENDŐ` |
| WORKING_SATURDAYS_2026 | `2026-03-28,2026-10-10` | `VERIFIED` |
| WORKING_SATURDAYS_2027 | *(üresen hagyni)* | `ELLENŐRZENDŐ` |
| PO_CONFIDENCE_THRESHOLD | `95` | — |
| ADMIN_EMAIL | `autobot@armadillo.hu` | — |

- [ ] Péterrel ellenőriztetni a `WORKING_SATURDAYS_2026` sort — ha a Magyar Közlöny alapján más dátumok szerepelnek, javítani és `VERIFIED`-re állítani

**✅ Kész, ha:** Apps Script projekt megnyílik `autobot@` fiókból, CONFIG object fenn van, Gemini key `PropertiesService`-ben tárolva (ellenőrzés: `PropertiesService.getScriptProperties().getProperty('GEMINI_KEY')` a konzolban nem null-t ad vissza), CONFIG fül kitöltve.

---

## FÁZIS 0 ZÁRÁSI KRITÉRIUM

Fázis 0 csak akkor zárható, ha **mind az 5 task** kész:

| Task | Felelős | Státusz |
|---|---|---|
| 01 — SSOT sheet + 7 fül | Fejlesztő | ☐ |
| 02 — Validációk + conditional formatting | Fejlesztő | ☐ |
| 03 — Apps Script + CONFIG + Gemini key | Fejlesztő | ☐ |
| 04 — PARTNEREK fül feltöltése | Péter | ☐ |
| 05 — PROJEKTEK fül feltöltése | Ági | ☐ |

**Ellenőrzés — fejlesztő végzi el Task 05 után:**

- [ ] Sheet megnyílik `autobot@` fiókból
- [ ] Mind a 7 fül elérhető
- [ ] BEJÖVŐ_SZÁMLÁK: Q, L, M dropdown működik
- [ ] Hibás projektszám (`IMME26` → nem felel meg) beírása PROJEKTEK A oszlopba → elutasítja
- [ ] Helyes projektszám (`IMME2601`) beírása PROJEKTEK A oszlopba → elfogadja
- [ ] SZÁMLA_TÉTELEK J oszlopba nem létező projektszám írása → piros kiemelés megjelenik
- [ ] PARTNEREK fül: minden aktív partner szerepel, D és G oszlop értékei helyesek
- [ ] PROJEKTEK fül: minden aktív projekt szerepel, formátum helyes
- [ ] Apps Script: `PropertiesService.getScriptProperties().getProperty('GEMINI_KEY')` → nem null
- [ ] CONFIG fül: 6 sor kitöltve, HOLIDAYS_2026 és WORKING_SATURDAYS_2026 státusza `VERIFIED`

Ha bármelyik nem teljesül: **Fázis 1 nem indul el.**

---

## MI TÖRTÉNIK, HA VALAMI HIÁNYZIK

| Mi hiányzik | Következmény |
|---|---|
| P3 nincs kész | Fejlesztő nem tud sheetet létrehozni — Fázis 0 megáll |
| P5 nincs kész | Task 03 nem zárható le — Fázis 1 nem indul |
| P6 nincs kész | PARTNEREK fül üres marad — a rendszer nem tud kifizetni senkit |
| P12 nincs kész | PROJEKTEK fül üres — minden bejövő számla `HIÁNYOS_PO` státuszba kerül |
| P1 nincs kész | Fázis 0 indul, de Fázis 1 nem — az automatizáció nem kap emailt |
| P2 nincs kész | Fázis 0 indul, de Fázis 1 Chat értesítők nem mennek ki |
| P9 nincs kész (Péter) | Fázis 3 HUF batch nem zárható le |
| WORKING_SATURDAYS nem VERIFIED | `getNextWorkday()` logol, de téves utalási dátumot adhat — **élesítés előtt kötelező** |

---

*Következő fázis: Fázis 1 — Gmail befogadó + Gemini OCR. Előfeltétel: P1 + P2 is kész.*
