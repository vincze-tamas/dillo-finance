# MagNet NetBank — Kötegállomány Formátum Spec

**Forrás:** NetBank Felhasználói kézikönyv (2025.08.12.), 14. fejezet — Céges funkciók
**Kiolvasva:** 2026-03-13
**Státusz:** RÉSZLEGES — SEPA formátum megerősítendő Péterrel (HUF GIRO teljesen dokumentált)
**Blokkoló hatás:** HUF batch kód megírható. SEPA marad nyitva.

---

## ⚠️ Kritikus architektúra-javítás

**A formátum NEM CSV.** Az eredeti tervben "CSV generálás" szerepelt — ez téves volt.

A MagNet kötegállomány **fix szélességű rekord formátum**:
- Minden rekordsor pontosan annyi karakterből áll, amennyi a rekord hossza
- Nincs elválasztójel (nem pontosvessző, nem vessző)
- Kódolás: **IBM 852** (DOS Central European — nem UTF-8, nem Windows-1250)
- Fájl kiterjesztés: `.txt`
- Sorvégjelzés: nem specifikált (valószínűleg CR+LF, Windows)

**Ez azt jelenti:** az Apps Script batch generátornak fix szélességű sorokat kell írnia, karakterpozíciókra igazítva, IBM 852 kódolással konvertálva.

---

## Elérhető köteg-típusok (14.1.2 szerint)

| Típus | Mikor kell | Megjegyzés |
|---|---|---|
| Csoportos átutalási megbízás (CS-ÁTUTALÁS) | HUF utalásokhoz | Szabványos GIRO formátum |
| Tömeges átutalási megbízás | HUF, speciális verzió | CS-ÁTUTALÁS variánsa, üzenettípus: TOMEGA |
| Postai kifizetési megbízás | Ha a kedvezményezett nem bankoló | Nem releváns |
| SEPA átutalási megbízás | EUR utalásokhoz | Fájlformátum NEM volt a kézikönyvben ← megerősítendő |

---

## 14.1.5 CS-ÁTUTALÁS kötegállomány (HUF GIRO) — részletes spec

### Fájl felépítése

| Rekord | Kód | Hossz (char) | Darabszám | Kódkészlet |
|---|---|---|---|---|
| FEJ | 01 | 174 | 1 | IBM 852, ékezetes megengedett |
| TÉTEL | 02 | 249 | 1–999.999 | IBM 852, ékezetes megengedett |
| LÁB | 03 | 24 | 1 | Ékezetes **nem** megengedett |

---

### 01 FEJ rekord (hossz: 174)

| Pozíció | Mező | Típus | Hossz | Érték | K/V | Megjegyzés |
|---|---|---|---|---|---|---|
| 1–2 | F210 rekordtípus | N | 2 | `01` | K | |
| 3–8 | F211 üzenettípus | A | 6 | `ATUTAL` | K | TOMEGA = Tömeges variáns |
| 9 | F212 duplum-kód | AN | 1 | 0–9, `@` | K | `@` = aznapi terhelés-jelző |
| 10–22 | F213 kezdeményező azonosítója | AN | 13 | adószám | K | Formátum: `Aaaaaaaaa[Tttt]` vagy EAN kód |
| 23–30 | F214.1 összeállítás dátuma | N | 8 | `ééééhhnn` | K | A batch generálás napja |
| 31–34 | F214.2 sorszám | N | 4 | egyedi | K | Azonos kezdeményezőnél egyedinek kell lennie |
| 35–42 | F215.1 bankszerv | N | 8 | `bbbffff∆` | K | bbb=bankkód, ffff=fiókkód, ∆=CDV |
| 43–58 | F215.2 számlaszám | N | 16 | | K | Ha 8 jegyű: balra igazítva, jobbról szóközzel |
| 59–66 | F216 terhelés dátuma | N | 8 | `ééééhhnn` | K | A CS-ÁTUTALÁST kezdeményező cég számlájának terhelése = az utalás napja |
| 67–69 | F217 jogcím | A | 3 | | K | Lásd jogcím-lista (munkabér: `K00`, szállítói számla: `K01` stb.) |
| 70–104 | F218 kezdeményező neve | AN | 35 | | K | Csak az első 32 karakter dolgozódik fel |
| 105–174 | F219 közlemény | AN | 70 | | V | Szabad szöveg (analógia PKUTAL F319-ből) — **megerősítendő** |

> **⚠️ Pozíciók 105–174 becslés** — a kézikönyv táblázata a 104. pozíciónál vágódott, az analóg PKUTAL rekordból következtetve közlemény mező.

---

### 02 TÉTEL rekord (hossz: 249)

| Pozíció | Mező | Típus | Hossz | Érték | K/V | Megjegyzés |
|---|---|---|---|---|---|---|
| 1–2 | T210 rekordtípus | N | 2 | `02` | K | |
| 3–8 | T211 tételsorszám | N | 6 | | K | Egyedi üzeneten belül |
| 9–16 | T212 fenntartott terület | N | 8 | | V | Csoportos összhanggal (nem kitöltendő) |
| 17–26 | T213 összeg | N | 10 | | K | **Csak Ft, egész szám — tizedesrész NEM használható** |
| 27–34 | T214.1 bankszerv | N | 8 | `bbbffff∆` | K | Kedvezményezett bankja |
| 35–50 | T214.2 számlaszám | N | 16 | | K | Ha 8 jegyű: balra igazítva, jobbról szóközzel |
| 51–74 | T215 ügyfélazonosító a kezdeményezőnél | AN | 24 | | K | Ha rövidebb: balra igazítva, jobbról szóközzel = számla ID-t ide |
| 75–109 | T216 az ügyfél neve | AN | 35 | | V | Csak az első 32 karakter dolgozódik fel |
| 110–144 | T217 az ügyfél címe | AN | 35 | | V | Csak az első 32 karakter jut el a jogosult bankjához |
| 145–179 | T218 számlatulajdonos neve | AN | 35 | | K | Csak az első 32 karakter jut el a jogosult bankjához |
| 180–249 | T219 közlemény | AN | 70 | | V | **Csak az első 18 karakter jut el a jogosult bankjához** |

> **Megjegyzés a közlemény mezőhöz:** T219 pozíció 180–249, 70 char, de a kedvezményezett bankja csak az első 18 karaktert kapja meg. A számlahivatkozás (pl. számla ID) ide kerül, de 18 karakteren belül kell lennie.

---

### 03 LÁB rekord (hossz: 24)

| Pozíció | Mező | Típus | Hossz | K/V | Megjegyzés |
|---|---|---|---|---|---|
| 1–2 | Z210 rekordtípus | N | 2 | K | Érték: `03` |
| 3–8 | Z211 tételek száma | N | 6 | K | A fájlban lévő TÉTEL sorok száma |
| 9–24 | Z212 tételek összértéke | N | 16 | K | Az összes tétel összegének összege (Ft, egész) |

---

## 14.1.6 Tömeges átutalás — eltérések a CS-ÁTUTALÁSTÓL

| Eltérés | Érték |
|---|---|
| FEJ üzenettípus (F211) | `TOMEGA` (nem `ATUTAL`) |
| FEJ jogcím | Érdektelen |
| TÉTEL 9–16 (fenntartott terület) | Ide kerül az **értéknap** `ééééhhnn` formátumban |
| TÉTEL 51–74 (ügyfélazonosító) | Érdektelen |
| TÉTEL ügyfél neve | Az ellenpartner nevét tartalmazza (mind 35 karakter értékes) |
| TÉTEL közlemény max | 96 karakter |
| TÉTEL rekord hossza | **275** (nem 249!) |

---

## SEPA (EUR) kötegállomány — NEM DOKUMENTÁLT

A kézikönyv 14.1.2-ben megemlíti a "SEPA átutalási megbízás" köteg típust, de **nem tartalmaz részletes kötegállomány-formátumot** a SEPA-hoz.

### Valószínű forgatókönyvek (megerősítendő Péterrel)

| Lehetőség | Valószínűség | Következmény |
|---|---|---|
| pain.001.001.03 XML (ISO 20022 SEPA standard) | Közepes–magas | Apps Script XML generátort kell írni |
| Egyedi MagNet CSV formátum | Közepes | CSV generátor elég |
| Online egyedi bevitel (nem batch-elhető) | Alacsony | Nem kell generátor, Péter kézzel viszi fel |

### Teendő (P8 — Blokkoló)

**Péternek kell MagNet NetBank-ban ellenőriznie:**
1. Kötegek → Köteg rögzítés → Típus: SEPA átutalási megbízás
2. Állomány mezőnél: milyen fájlt vár? (.txt, .xml, .csv?)
3. Ha van mintafájl: letölteni és küldeni a fejlesztőnek

---

## Összesítő — mi kell még a Fázis 3 előtt

| Input | Státusz | Felelős |
|---|---|---|
| CS-ÁTUTALÁS FEJ mezők 1–104 | ✅ Dokumentált | — |
| CS-ÁTUTALÁS LÁB mezők | ✅ Dokumentált | — |
| CS-ÁTUTALÁS TÉTEL mezők 1–249 (teljes) | ✅ Dokumentált | — |
| CS-ÁTUTALÁS FEJ mezők 105–174 (közlemény) | ⚠️ Becslés — analógia PKUTAL-ból | Péter: megerősítés |
| CS-ÁTUTALÁS jogcím lista | ❌ HIÁNYZIK | Péter: helyes kód szállítói utaláshoz |
| SEPA kötegállomány formátum | ❌ HIÁNYZIK | Péter: MagNet-ben ellenőrizni |
| IBM 852 → Apps Script konverzió lehetséges? | ⚠️ Technikai kockázat | Fejlesztő: UrlFetchApp charset teszt |

---

## Technikai kockázat: IBM 852 kódolás Apps Script-ben

Az Apps Script (V8 JavaScript engine) natívan **nem kezeli az IBM 852 kódolást**.

A megoldás:
```javascript
// Apps Script nem tud natívan IBM 852-t írni
// Lehetséges megkerülés:
// 1. A mező tartalmát csak ASCII karakterekre korlátozni
//    (ékezet nélkül) — az IBM 852 ékezetes mezők "V" (választható) jelzésűek
// 2. Vagy: UrlFetchApp-on keresztül egy Node.js konverziós microservice-t hívni
// 3. Vagy: a bank elfogadja-e UTF-8-ban? — Péternek tesztelnie kell

// Ideiglenes stratégia: ASCII + szóköz pótlás az ékezetes karaktereknél
// 'á' → 'a', 'é' → 'e' stb. — elfogadható banki mezőkben
```

**Ez a kockázat valódi.** Ha a bank visszautasítja a kódolatlan fájlt, a batch generátor nem fog működni. Péternek tesztelnie kell egy mintafájllal mielőtt a kód véglegesedik.

---

## Oldalszámok a kézikönyvben

| Tartalom | Oldal |
|---|---|
| 14 Céges funkciók — bevezető | 130 |
| 14.1.2 Köteg típusok | 131 |
| 14.1.5 CS-ÁTUTALÁS kötegállomány felépítése | 135 |
| ATUTAL FEJ rekord táblázat | 136 |
| ATUTAL TÉTEL rekord táblázat (teljes, 1–249) | 137 + screenshot |
| ATUTAL LÁB + 14.1.6 Tömeges eltérések | 138 |
| Tömeges LÁB | 139 |
| PKUTAL (postai) — nem releváns | 140–141 |
