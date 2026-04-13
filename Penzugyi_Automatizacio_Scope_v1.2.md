# Projekt Scope — Pénzügyi Folyamat-automatizáció

**Verzió:** 1.2
**Dátum:** 2026. április 8.
**Státusz:** Aktív
**Résztvevők:** Operatív vezető · Pénzügyi vezető · IT felelős · Fejlesztő

**Változásnapló:**
- v1.2 (2026-04-08): Regex pontosítva 3–4 betűs projektszámra; ÁLLANDÓ bypass bekerült a státusztáblába; input státuszok szekció eltávolítva (nem scope-tartalom); timeline frissítve tényleges ütemre
- v1.1 (2026-03-29): Tétel szintű PO logika; 7 fül; SSOT validációs réteg; 3 webhook; aktív projektek input blokkolóként
- v1.0 (2026-03): Első kiadás

---

## 1. Üzleti probléma

A Megbízónál a bejövő számla-feldolgozás jelenleg email + Excel + manuális banki feltöltés kombinációjával működik. Ez három ponton törik meg rendszeresen: befogadáskor (nincs egységes rögzítés), jóváhagyáskor (nincs nyomkövetés), és utaláskor (manuális, késhet).

A rendszer nem azért hibás, mert rossz emberek kezelik. Hanem mert nincs rendszer — csak szokás.

Ez a projekt egyetlen Google Spreadsheet köré épít auditálható, automatizált workflow-t, amely a Megbízó meglévő Google Workspace Standard előfizetésén fut. Nincs külső SaaS, nincs új előfizetés.

---

## 2. Technológiai stack

| Réteg | Technológia |
|---|---|
| Automatizáció | Google Apps Script |
| AI / OCR | Gemini API (GCP projekt, már megvan) |
| Adatbázis | Google Sheets (1 fájl, 7 fül — beleértve CONFIG fül) |
| Értesítés | Google Chat webhook |
| Archiválás | Google Drive |
| Dashboard | Looker Studio |
| Bankkal interfész (1. fázis) | Manuális batch fájl feltöltés (.txt fix szélességű rekord) |

Feltétel: a számla-fogadó emailcím Google infrastruktúrán fut. Ez ellenőrzött.

---

## 3. Hatókör

### Benne van

- Bejövő számlák automatikus befogadása és feldolgozása
- AI-alapú adatkinyerés projektszám-azonosítással és konfidencia-értékeléssel
- Státuszgép teljes életciklus-kezeléssel
- Heti jóváhagyási és kötegelési workflow
- Hibakezelés, audit trail, admin értesítők
- Looker Studio pénzügyi dashboard

### Nincs benne — ez nem alkudozható

- Könyvelési szoftverrel való integráció
- Kimenő számla kiállítás vagy kezelés
- Banki API write integráció (ez jövőbeli fázis, külön scope)
- Mobilalkalmazás bármilyen formában
- NAV-integráció

---

## 4. Funkcionális követelmények

### 4.1 Napi befogadás — teljesen automatikus

**Trigger:** Email érkezik a számla-fogadó postafiókba.

A folyamat sorrendje rögzített, nem cserélhető fel:

1. PDF mentés Google Drive-ra — ez az első lépés, mindig, még AI-hívás előtt
2. Gemini AI OCR: kinyeri a számla fejléc-adatait és tételsorait
3. Projektszám azonosítás **tétel szinten** — minden tételsorhoz: `po` (projektszám), `po_confidence` (0–100), `po_reasoning`. Fejléc szinten: `po_summary` (konkrét / MULTI / HIÁNYOS), `po_confidence` (aggregált), `po_reasoning` (aggregált)
4. Státusz-döntés aggregált tétel-szintű eredmény alapján

**Státuszgép:**

| Státusz | Feltétel |
|---|---|
| BEÉRKEZETT | Minden számlatétel: PO ≥95% konfidenciával azonosítható a PROJEKTEK regiszterből |
| BEÉRKEZETT | ÁLLANDÓ kategória: PO ellenőrzés teljesen kimarad → közvetlen BEÉRKEZETT státusz |
| HIÁNYOS_PO | Legalább 1 számlatétel: PO nem található a PROJEKTEK-ben, vagy konfidencia <95% |
| VISSZAUTASÍTVA | Manuális döntés után (nem automatikus) |
| JÓVÁHAGYVA | Operatív jóváhagyás megérkezett |
| BEKÖTEGELT | Szerdai kötegbe bekerült |
| TELJESÍTVE | Pénzügyi vezető megerősítette az utalást |
| AI_HIBA | Gemini API 3× sikertelen hívás után |

**HIÁNYOS_PO kezelés:**
A rendszer nem utasít vissza automatikusan. A HIÁNYOS_PO státuszú tételek szerdai manuális review-ra kerülnek. Ez tudatos döntés: az OCR-ba vetett bizalom fokozatosan épül, nem feltételezik el.
Az OPS Chat értesítő tartalmazza a **tétel-szintű bontást**: melyik sorban mi a probléma (hiányzó PO, alacsony konfidencia) és miért (Gemini reasoning).

**Hibakezelés:**
- Retry ×3, exponenciális backoff: 30s → 60s → 90s
- Ha mind a három sikertelen: AI_HIBA státusz + email az admin email címre (konfigurálható paraméter a kódban)
- LockService tranzakció-védelem: fejléc és tételsorok írása atomikusan, nem külön

### 4.2 Szerdai workflow — két lépés, automatikus triggerrel

**9:00 — Jóváhagyási digest**

- Google Chat értesítő az Operatív vezetőnek és projekt-felelősnek: PROJEKT kategóriájú, BEÉRKEZETT státuszú számlák
- Google Chat értesítő a Pénzügyi vezetőnek: ÁLLANDÓ kategóriájú számlák
- Külön figyelmeztetés: ha bármelyik tétel 7 napon belül lejár és még nem jóváhagyott
- HIÁNYOS_PO tételek review-ja is szerdán történik — az Operatív vezető dönt: PO kézzel beviszi (→ BEÉRKEZETT) vagy visszautasítja (→ VISSZAUTASÍTVA, ezt triggeri az email-küldés)

**14:00 — Batch generálás**

- Jóváhagyott számlák összegyűjtése
- Utalás-dátum kalkuláció: hétvége vagy ünnepnap esetén következő munkanap
- Batch fájl (.txt fix szélességű rekord) generálása devizánként (HUF: CS-ÁTUTALÁS; EUR: SEPA — P10 után)
- Fájl Drive-ra mentve + Google Chat értesítő Pénzügyi vezetőnek

**+3 napos ellenőrző trigger:**
Ha egy BEKÖTEGELT státuszú tétel 3 napja nem kerül TELJESÍTVE státuszba, automatikus figyelmeztetés megy a Pénzügyi vezetőnek.

### 4.3 Dashboard — Looker Studio

Folyamatosan frissül a Sheets adataiból:

- Banki egyenleg
- Cash flow előrejelzés (30 napos)
- Havi ÁFA (teljesítési dátum alapján)
- Kintlévőség (ki, mennyit, mióta)
- Lejárt követelések (15 / 30 / 60+ napos bontásban)

### 4.4 SSOT validációs réteg

A rendszer 4 típusú validációt alkalmaz a manuális adatbevitel hibáinak megelőzésére:

| Típus | Alkalmazás |
|---|---|
| Dropdown | Státusz, deviza, kategória mezők legördülő listával rögzítve |
| FK referencia | SZÁMLA_TÉTELEK projektszám → PROJEKTEK.A — eltérés piros kiemeléssel jelezve |
| Formátum regex | PROJEKTEK projektszám: `^[A-Z]{3,4}[0-9]{4}$` |
| Numerikus range | PO_CONFIDENCE: 0–100 |

Hibás sor: piros háttérszín + hibalog a CONFIG fülön. Validáció nem blokkol — csak jelez.

---

## 5. Adatstruktúra

Egyetlen Google Spreadsheet. Más adatbázis nem keletkezik, nem marad fenn párhuzamosan. A rendszer 7 fülből áll.

| Fül | Tartalom |
|---|---|
| BEJÖVŐ_SZÁMLÁK | Fejléc-adatok, aggregált PO_SUMMARY/PO_CONFIDENCE/PO_REASONING, státuszok |
| SZÁMLA_TÉTELEK | Tételsorok tétel szintű PO, PO_CONFIDENCE, PO_REASONING, PO_VALIDÁLT mezőkkel — elsődleges forrás |
| KIMENŐ_SZÁMLÁK | Kintlévőség-követés |
| PROJEKTEK | Projektszám MASTER REGISTRY — formátum: XXXX + ÉÉ + SS (pl. IMME2601) |
| PARTNEREK | Bankszámlaszám + PROJEKT / ÁLLANDÓ kategória |
| KÖTEGEK | Heti utalási csomagok, dátumokkal, devizánként |
| CONFIG | Rendszerparaméterek, ünnepnapok cache, WORKING_SATURDAYS |

---

## 6. Szükséges inputok — Megbízó feladata

A blokkoló inputok nyomon követése a Feladatlistában (PRE-0 szekció) történik. Ez a dokumentum nem tartalmaz státuszokat — azok gyorsan változnak és ott naprakészek.

---

## 7. Implementációs ütemterv

| Fázis | Tartalom | Idő |
|---|---|---|
| 0 | Spreadsheet struktúra, validációk, legördülők | 1 nap |
| 1 | Gmail befogadó + Gemini OCR + Drive archiválás | 2–3 nap |
| 2 | HIÁNYOS_PO logika + visszautasító email státusz-trigger | 1 nap |
| 3 | Szerdai értesítők + batch generátor | 2 nap |
| 4 | Looker Studio dashboard | 1–2 nap |
| **Összesen** | | **~14 munkanap (ápr. 7–24.)** |

A PRE-0 előkészítés (P1–P12) párhuzamosan fut a fejlesztéssel, ahol lehetséges.

---

## 8. Kockázatok és mitigáció

| Kockázat | Valószínűség | Mitigáció |
|---|---|---|
| OCR tévedés (PO félreolvas) | Közepes | HIÁNYOS_PO státusz + human review — nem automatikus elutasítás |
| Gemini API leállás | Alacsony | Retry ×3 + AI_HIBA státusz + admin email |
| Párhuzamos írási hiba (két email egyszerre) | Alacsony | LockService — atomikus tranzakció |
| Chat webhook leállás | Alacsony | Gmail fallback értesítő automatikusan |
| Banki formátum változás | Alacsony | Batch generátor konfigurálható sémával épül |

---

## 9. Jövőbeli fázis — külön scope

Ha az Ügyfél bankja elérhetővé teszi az API write funkciót:

- Automatikus utalásindítás Apps Script-ből
- A Pénzügyi vezető feladata csak a jóváhagyás marad, nem a manuális feltöltés
- A batch .txt fix szélességű rekord logika megmarad fallback-ként

Ez nem része a jelenlegi projektnek. Akkor nyílik meg, amikor a bank API-ja írásra is képes lesz.

---

## 10. Elfogadási feltételek

A projekt lezártnak tekinthető, ha:

- Mind az 5 fázis átadásra és tesztelésre kerül éles adatokkal
- Legalább egy teljes szerdai workflow sikeres lefutott (9:00 digest + 14:00 batch)
- A dashboard valós adatot mutat
- Az admin email értesítők teszteltek
- Az átadási dokumentáció tartalmazza a konfigurálható paraméterek listáját

---

*Ez a dokumentum az első egyeztetési alap. Bármelyik sor, amelyik félreérthető, pontosítandó — nem végrehajtandó.*
