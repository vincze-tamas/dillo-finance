# Armadillo Pénzügyi Automatizáció — Feladatlista

**Ki dolgozik rajta:** Fejlesztő · IT felelős · Pénzügyi vezető (Péter) · Operatív vezető (Ági)
**Utolsó frissítés:** 2026. március 13.
**⚠️ Architektúra-javítás:** A MagNet kötegállomány formátum NEM CSV — fix szélességű rekord, IBM 852 kódolás. Részletek: `magnet_batch_spec.md`

---

## Összesítő — blokkolók és felelősök

| # | Fázis | Felelős | Feladat (rövid) | Blokkolja |
|---|---|---|---|---|
| P1 | PRE-0 | IT felelős | szamlazas@ Google Group → autobot@ | Fázis 1 |
| P2 | PRE-0 | IT felelős | Chat webhook URL-ek (3 db: OPS, Finance, Admin) | Fázis 1 |
| P3 | PRE-0 | IT felelős | Shared Drive létrehozás + mappastruktúra | Fázis 0 |
| P4 | PRE-0 | IT felelős | Jogosultságok beállítása | Fázis 0 |
| P5 | PRE-0 | IT felelős | Gemini API key átadása fejlesztőnek | Fázis 0 |
| P6 | PRE-0 | Pénzügyi vezető | Banki partnerek.xls kiegészítése | Fázis 0 |
| P7 | PRE-0 | Operatív vezető | Jóváhagyásra jogosultak listája | Fázis 0 |
| P8 | PRE-0 | Fejlesztő | MagNet batch spec kiolvasása | ✅ KÉSZ (HUF) |
| P9 | PRE-0 | Pénzügyi vezető | MagNet jogcím kód szállítói utaláshoz | Fázis 3 |
| P10 | PRE-0 | Pénzügyi vezető | SEPA köteg formátum ellenőrzése MagNet-ben | Fázis 3 (EUR) |
| P11 | PRE-0 | Fejlesztő | IBM 852 ASCII-only teszt fájl generálás | Fázis 3 előtt |
| P12 | PRE-0 | Operatív vezető | Aktív projektek listájának összeállítása | Fázis 0 |
| 01 | Fázis 0 | Fejlesztő | SSOT sheet + 7 fül létrehozása | — |
| 02 | Fázis 0 | Fejlesztő | Data validation + conditional formatting | — |
| 03 | Fázis 0 | Fejlesztő | Apps Script projekt + CONFIG + Gemini key | — |
| 04 | Fázis 0 | Pénzügyi vezető | PARTNEREK fül feltöltése | — |
| 05 | Fázis 0 | Operatív vezető | PROJEKTEK fül feltöltése | — |
| 11 | Fázis 1 | Fejlesztő | Gmail befogadó + PDF Drive-ra mentés | — |
| 12 | Fázis 1 | Fejlesztő | Gemini OCR + SSOT Sheet írás | — |
| 13 | Fázis 1 | Fejlesztő | Hibakezelés + trigger létrehozása | — |
| 14 | Fázis 1 | Mindenki | Tesztszámla küldése + eredmény ellenőrzése | — |
| 21 | Fázis 2 | Fejlesztő | HIÁNYOS_PO logika + ÁLLANDÓ bypass | — |
| 22 | Fázis 2 | Operatív vezető | Visszautasító email sablon szövege | — |
| 23 | Fázis 2 | Fejlesztő | onEdit trigger + fallback értesítő | — |
| 24 | Fázis 2 | Ági + Fejlesztő | Visszautasítás teszt | — |
| 31 | Fázis 3 | Fejlesztő | Szerda 9:00 digest trigger | P8 kell előtte |
| 32 | Fázis 3 | Fejlesztő | getNextWorkday() + batch generátor | P8 kell előtte |
| 33 | Fázis 3 | Pénzügyi vezető | MagNet NetBank teszt import | — |
| 41 | Fázis 4 | Fejlesztő | Looker Studio adatforrás + Data Blend | — |
| 42 | Fázis 4 | Fejlesztő | 5 dashboard oldal | — |
| 43 | Fázis 4 | Péter + Ági | Dashboard review | — |
| 51 | Fázis 5 | Fejlesztő | Január 1. + December 1. scheduled task-ok | — |
| 52 | Fázis 5 | Péter / IT | WORKING_SATURDAYS_2026 VERIFIED-re állítása | Élesítés előtt |

---

## PRE-0 — Előkészítés (nem kód)

Ezek nem opcionális lépések. Ha P1, P2, P6 nincs kész, a fejlesztés megáll. Nem érdemes kódot írni, amíg a Google Group nincs beállítva — a trigger fut, de nem kap emailt.

### IT felelős

- [ ] **P1 — Google Group beállítása** *(BLOKKOLÓ — Fázis 1)*
  Google Admin konzol → Groups → Új csoport: `szamlazas@armadillo.hu`
  Tag: `autobot@armadillo.hu`
  Beállítás: minden beérkező email kézbesítődjön a tagnak (nem forward, hanem delivery)
  Ellenőrzés: tesztlevél küldése szamlazas@-ra → megjelenik-e autobot@ inboxában?

- [ ] **P2 — Chat webhook URL-ek** *(BLOKKOLÓ — Fázis 1)*
  Google Chat → érintett space-ek → Manage webhooks → Incoming webhook
  3 URL szükséges:
  — 🟢 Pénzügy-Jóváhagyások (Ági + Márk): másolja át fejlesztőnek
  — 🏦 Pénzügy-Utalások (Péter): másolja át fejlesztőnek
  — 🤖 IT Rendszerlogok (IT only): másolja át fejlesztőnek
  Ezek kerülnek a CONFIG object `CHAT_WEBHOOK_OPS`, `CHAT_WEBHOOK_FINANCE` és `CHAT_WEBHOOK_ADMIN` mezőibe.

- [ ] **P3 — Shared Drive + mappastruktúra**
  Bejelentkezés Chrome-ban: `autobot@armadillo.hu`
  Google Drive → Shared Drives → Új: `🏦 Armadillo Pénzügy`
  Mappák létrehozása:
  ```
  SSOT/
  Bejövő számlák/
    └── 2026/
        ├── 01_Január/
        ├── 02_Február/
        ├── 03_Március/
        └── (többi hónap)
    └── _VISSZAUTASÍTOTT/
  Kötegek/
    └── 2026/
  Dashboard/
  Rendszer/
    └── Dokumentáció/
  ```

- [ ] **P4 — Jogosultságok**
  Shared Drive szinten: Operatív vezető + Pénzügyi vezető = Content manager
  SSOT/ mappa: mindkettő Szerkesztő
  Rendszer/ mappa: csak IT felelős + autobot@ Szerkesztő, a többiek Olvasó

- [ ] **P5 — Gemini API key átadása**
  Biztonságos csatornán (nem emailben) átadja a fejlesztőnek.
  A fejlesztő PropertiesService-be menti — nem kerül kódba, nem kerül Sheetbe.

### Pénzügyi vezető (Péter)

- [ ] **P6 — Banki partnerek.xls kiegészítése** *(BLOKKOLÓ — Fázis 0)*
  Megnyitni a meglévő fájlt. Minden partnerhez szükséges:
  — Teljes név (pontosan, ahogy a számlán szerepel)
  — IBAN bankszámlaszám
  — Kategória: `PROJEKT` vagy `ÁLLANDÓ`
  — Aktív: `IGEN` vagy `NEM`
  Ha valamelyik hiányzik, azt a sort nem lehet importálni. Nincs részleges feltöltés.

### Operatív vezető (Ági)

- [ ] **P7 — Jóváhagyásra jogosultak listája**
  Ki hagyhat jóvá PROJEKT kategóriájú számlát? Névsor + email cím.
  Ez kerül a szerdai digest értesítőbe. Ha nincs listán valaki, nem kap értesítést.

- [ ] **P12 — Aktív projektek listájának összeállítása** *(BLOKKOLÓ — Fázis 0)*
  Minden aktív projekthez szükséges adatok összeállítása (Excel / Google Sheet formában),
  hogy task 05-kor az SSOT PROJEKTEK fülre importálható legyen.
  **Formátum kötelező:** 4 nagybetű + 4 szám (pl. IMME2601, BUDA2602 — XXXX + ÉÉ + SS)
  Ez a Gemini PO matching alapja — ha egy projekt nem szerepel benne, a rá hivatkozó
  tételek automatikusan HIÁNYOS_PO státuszt kapnak.
  Átadja: fejlesztőnek, vagy közvetlenül az SSOT PROJEKTEK fülre task 05-kor.

### Fejlesztő

- [x] **P8 — MagNet batch formátum dokumentálása** ✅ KÉSZ
  Forrás: NetBank kézikönyv p.130–139 + felhasználói screenshot.
  Eredmény: `magnet_batch_spec.md` — HUF CS-ÁTUTALÁS teljesen dokumentált.
  **Kritikus megállapítás: a formátum NEM CSV — fix szélességű rekord, IBM 852 kódolás.**
  Rekordok: 01 FEJ (174 char) + 02 TÉTEL (249 char) + 03 LÁB (24 char).
  SEPA formátum nincs a kézikönyvben → P10 feladata.

- [ ] **P9 — Jogcím kód megerősítése** *(Pénzügyi vezető — Fázis 3 előtt)*
  A FEJ rekord F217 mezője 3 karakteres jogcím kódot vár.
  Szállítói számlánál a feltételezett kód: `K01` — de Péternek kell megerősítenie.
  Ellenőrzés: MagNet NetBank → Kötegek → Köteg rögzítés → ATUTAL típus → Jogcím legördülő.
  A helyes kódot átadja a fejlesztőnek → bekerül a CONFIG fülre.

- [ ] **P10 — SEPA kötegállomány formátum** *(Pénzügyi vezető — Fázis 3 EUR-ághoz)*
  MagNet NetBank → Kötegek → Köteg rögzítés → Típus: SEPA átutalási megbízás
  Kérdések: Milyen fájlt vár? (.txt fix széles, .xml pain.001, .csv?)
  Ha van minta: letölteni és elküldeni a fejlesztőnek.
  Ha nincs EUR partner, ez a fázis elhalasztható — a HUF batch blokkoló nélkül indul.

- [ ] **P11 — IBM 852 kódolás teszt** *(Fejlesztő + Pénzügyi vezető — Fázis 3 előtt)*
  Az Apps Script UTF-8-ban ír fájlt, a bank IBM 852-t vár. Fix szélességű formátumnál az ékezetes karakterek bájt-hossza elcsúsztatja a pozíciókat.
  Stratégia: ASCII-only mező kitöltés (á→a, é→e, ő→o, ű→u stb. transzliteráció).
  Teszt lépései:
  1. Fejlesztő generál 1 tételes ASCII-only tesztfájlt (cégnév, közlemény: ékezet nélkül)
  2. Péter feltölti MagNet NetBank-ba (1 Ft teszt egy belső számlára)
  3. Ha átmegy: ASCII stratégia végleges, kódolás kérdés lezárva
  4. Ha visszautasítja: IBM 852 konverziós függvény szükséges

---

## Fázis 0 — SSOT Sheet + Apps Script alap *(1 nap)*

Előfeltétel: P3, P4, P5, P6, P7 kész.

### Fejlesztő (autobot@ fiókból végrehajtva)

- [ ] **01 — SSOT sheet létrehozása**
  Drive → SSOT/ mappa → Új Google Táblázat
  Név: `[SSOT] Armadillo Pénzügyi Adatbázis`
  7 fül létrehozása ebben a sorrendben:
  `BEJÖVŐ_SZÁMLÁK` · `SZÁMLA_TÉTELEK` · `PROJEKTEK` · `PARTNEREK` · `KÖTEGEK` · `KIMENŐ_SZÁMLÁK` · `CONFIG`
  Fejlécek beírása minden fülre (az Implementációs tervben definiált oszlopok szerint).

- [ ] **02 — Data validation + conditional formatting**
  BEJÖVŐ_SZÁMLÁK Q oszlop (Státusz) dropdown:
  `BEÉRKEZETT, HIÁNYOS_PO, VISSZAUTASÍTVA, JÓVÁHAGYVA, BEKÖTEGELT, TELJESÍTVE, AI_HIBA`
  L oszlop (Deviza) dropdown: `HUF, EUR`
  M oszlop (Kategória) dropdown: `PROJEKT, ÁLLANDÓ`
  Conditional formatting soronként a Q oszlop értéke alapján:
  — BEÉRKEZETT = kék háttér
  — HIÁNYOS_PO = sárga
  — VISSZAUTASÍTVA = piros
  — JÓVÁHAGYVA = zöld
  — BEKÖTEGELT = lila
  — TELJESÍTVE = szürke
  — AI_HIBA = sötétpiros

- [ ] **03 — Apps Script projekt + CONFIG + Gemini key**
  Sheet megnyitva autobot@-ból → Extensions → Apps Script
  CONFIG object létrehozása a kódfájlban (folder ID-k, webhook URL-ek, küszöbértékek).
  Gemini API key mentése: `PropertiesService.getScriptProperties().setProperty('GEMINI_KEY', '...')`
  Ezt egyszer kézzel kell futtatni a Script Editorból. Utána a kód onnan olvassa.
  CONFIG fül feltöltése: WORKING_SATURDAYS_2026, HOLIDAYS_2026 sorok (státusz: ELLENŐRZENDŐ).

### Pénzügyi vezető (Péter)

- [ ] **04 — PARTNEREK fül feltöltése**
  A kiegészített partnerlistát bemásolja a PARTNEREK fülre.
  Minden sor: név, adószám, IBAN, kategória, email, határidő (nap), aktív.
  Ha egy partner IBAN-ja hiányzik, azt a sort üresen hagyja — a rendszer nem tudja kifizetni.

### Operatív vezető (Ági)

- [ ] **05 — PROJEKTEK fül feltöltése**
  Forrás: P12 alatt összeállított lista. Aktív projektek felvitele: projektszám, projekt neve, ügyfél, státusz.
  **Projektszám formátum ellenőrzése importálás előtt:** `^[A-Z]{4}[0-9]{4}$` (pl. IMME2601)
  Eltérő formátumú sort nem szabad felvenni — a Gemini matching és az FK validáció csak ezen a formátumon működik.
  Lezárt projektek is felvihetők LEZÁRT státusszal — a rendszer nem utasítja el a számlákat, de a riportokban elkülönülnek.

---

## Fázis 1 — Gmail befogadó + Gemini OCR *(2–3 nap)*

Előfeltétel: P1, P2 kész (Google Group + webhook URL-ek).

### Fejlesztő

- [ ] **11 — Gmail befogadó + PDF Drive-ra mentés**
  Gmail keresési filter: `in:inbox is:unread has:attachment`
  Az autobot@ saját inboxát nézi — ez csak akkor működik, ha P1 kész.
  PDF kimentése Drive-ra az **első lépés**, még mielőtt bármi más történik.
  Célmappa: `Bejövő számlák/2026/MM_Hónap/` — ha a hónapos almappa nem létezik, a kód hozza létre.
  Ha a Drive-mentés sikertelen, a feldolgozás megáll. Az email marad unread, a retry-trigger újra megtalálja.

- [ ] **12 — Gemini OCR + Sheet írás**
  Gemini API hívás `withRetry(fn, 3, 30000)` wrapperrel.
  Prompt: fejléc mezők + tételsorok kinyerése, structured JSON válasz kényszerítéssel.
  **Tétel szintű PO kezelés:** minden tételsorhoz `po` (projektszám), `po_confidence` (0–100), `po_reasoning`.
  **Fejléc aggregálás:**
  — `po_summary`: konkrét PO / MULTI (ha több különböző PO) / HIÁNYOS (ha ≥1 tétel nem azonosítható)
  — `po_confidence` (aggregált): 1 PO → annak conf.; MULTI → MIN(tételek); HIÁNYOS → 0
  — `po_reasoning` (aggregált): 1 PO → AI reasoning; MULTI → "MULTI_TETEL – lásd SZÁMLA_TÉTELEK"; HIÁNYOS → "NINCS_PO"
  Sheet írás `LockService.getScriptLock()` tranzakcióban:
  — `BEJÖVŐ_SZÁMLÁK.appendRow(fejlécAdatok)` (beleértve PO_SUMMARY, PO_CONFIDENCE, PO_REASONING)
  — tételsorok ciklusban: `SZÁMLA_TÉTELEK.appendRow(tétel)` (beleértve K/L/M: po_confidence, po_reasoning, po_validált)
  Státusz-döntés: ha **bármely tétel** PO_VALIDÁLT = NEM → HIÁNYOS_PO; minden tétel OK → BEÉRKEZETT
  Ha a lock nem szerezhető meg 10 másodpercen belül: `LOCK_TIMEOUT` hiba → retry.
  Gmail message ID mentése W oszlopba — deduplikáció: ha már szerepel, az emailt átugorja.

- [ ] **13 — Hibakezelés + trigger**
  try-catch minden kritikus ponton. Hiba esetén:
  — Számla státusza → `AI_HIBA`
  — `notifyAdmin()` → email az ADMIN_EMAIL-re a hibaüzenettel és stack trace-szel
  Trigger létrehozása **autobot@ fiókból** (Script Editor → Triggers → Time-driven, 15 perc).
  Ha a triggert személyes fiókból hozzák létre, az a fiók kompromittálódásakor leáll — hibaüzenet nélkül.

### Mindenki

- [ ] **14 — Tesztszámla éles teszt**
  Valós PDF számla küldése `szamlazas@armadillo.hu`-ra.
  15 percen belül ellenőrizni:
  — Drive: megjelent-e a PDF a megfelelő hónapos mappában?
  — Sheet BEJÖVŐ_SZÁMLÁK: van-e új sor?
  — Sheet SZÁMLA_TÉTELEK: megjelentek-e a tételsorok?
  — Státusz: BEÉRKEZETT vagy HIÁNYOS_PO? (PO konfidencia alapján)
  Ha valami nem stimmel: Apps Script → Executions nézet → hiba olvasása.

---

## Fázis 2 — HIÁNYOS_PO logika + visszautasító email *(1 nap)*

### Fejlesztő

- [ ] **21 — HIÁNYOS_PO routing + ÁLLANDÓ bypass**
  Ha **bármely tétel** `PO_VALIDÁLT = NEM` (po_confidence < 95 VAGY po nem szerepel PROJEKTEK.A-ban) → státusz: `HIÁNYOS_PO`
  Ha minden tétel `PO_VALIDÁLT = IGEN` → státusz: `BEÉRKEZETT`
  Ha kategória `ÁLLANDÓ` → PO nem szükséges → `PO_SUMMARY = N/A` → direkt `BEÉRKEZETT` (PO ellenőrzés kihagyva)
  Ez a két ág nem cserélhető fel. Az ÁLLANDÓ számlák soha nem kerülnek HIÁNYOS_PO-ba.

- [ ] **23 — onEdit trigger + fallback**
  `onEdit` trigger figyeli a BEJÖVŐ_SZÁMLÁK Q oszlopát.
  Ha az érték `VISSZAUTASÍTVA`-ra változik: visszautasító email küldése a Partner email-jére (PARTNEREK fülről) az Operatív vezető által megadott sablonból.
  Ha Chat webhook hiba: `try-catch` → Gmail küldés fallbackként az ops és finance emailekre.

### Operatív vezető (Ági)

- [ ] **22 — Visszautasító email sablon szövege**
  Mit kapjon a szállító, ha visszautasítják a számláját?
  Minimum tartalom: mi hiányzott (projektszám), hogyan küldje újra, kivel vegye fel a kapcsolatot.
  Ezt Ági adja meg — a fejlesztő beégeti a kódba sablonként.

### Ági + Fejlesztő

- [ ] **24 — Visszautasítás teszt**
  Egy HIÁNYOS_PO státuszú tételt manuálisan átállítani VISSZAUTASÍTVA-ra a Sheet Q oszlopában.
  Ellenőrizni: megérkezett-e az email a szállítónak? Helyes sablon? Helyes partner email?

---

## Fázis 3 — Szerdai workflow *(2 nap)*

Előfeltétel: P8 ✅ kész. P9, P10, P11 kell a teljes kódhoz — de HUF ág P9+P11 után indítható.

### Fejlesztő

- [ ] **31 — Szerda 9:00 jóváhagyási digest**
  Time-driven trigger: szerda 9:00.
  BEÉRKEZETT státuszú számlák lekérdezése kategória szerint:
  — PROJEKT → Chat üzenet ops webhook-ra (Ági + Márk)
  — ÁLLANDÓ → Chat üzenet finance webhook-ra (Péter)
  Ha van 7 napon belül lejáró, jóvá nem hagyott tétel: külön kiemelt figyelmeztetés mindkét értesítőben.
  HIÁNYOS_PO tételek szintén megjelennek az ops digest-ben — Ági itt dönt.

- [ ] **32 — getNextWorkday() + batch generátor**
  `getNextWorkday(date)`: CONFIG fülről olvassa a HOLIDAYS és WORKING_SATURDAYS sorokat.
  Csak VERIFIED státuszú sor alkalmazandó. Ha ELLENŐRZENDŐ: logol + admin email, de fut tovább.
  Szerda 14:00 trigger:
  — JÓVÁHAGYVA státuszú számlák összegyűjtése
  — Devizánként csoportosítás: HUF → CS-ÁTUTALÁS fix szélességű rekord fájl, EUR → SEPA (P10 után)
  — **Fájlformátum HUF:** 01 FEJ (174 char) + N×02 TÉTEL (249 char) + 03 LÁB (24 char), IBM 852 / ASCII
  — **Közlemény korlát:** T219 mező, 70 char van, de csak az első 18 jut el a kedvezményezetthez
  — Fájlnév: `BATCH-2026-W{hét}-HUF_{dátum}.txt` / `BATCH-2026-W{hét}-EUR_{dátum}.txt`
  — Drive mentés: `Kötegek/2026/` mappába
  — KÖTEGEK fülre devizánként külön sor felvétele
  — BEKÖTEGELT státusz update az érintett számlákra
  — Chat értesítő Péternek: Drive fájl link(ek)
  +3 napos ellenőrző: naponta fut, BEKÖTEGELT státuszú tételek ahol az utalás dátuma > 3 napja lejárt és nem TELJESÍTVE → Chat figyelmeztetés Péternek.

### Pénzügyi vezető (Péter)

- [ ] **33 — MagNet NetBank teszt import**
  A generált kötegállomány `.txt` fájlt letölteni Drive-ról.
  MagNet NetBank → Kötegek → Köteg rögzítés → Típus: Csoportos átutalás → Állomány feltöltése.
  Ha hibát jelez: visszajelzés a fejlesztőnek (melyik mező, milyen hiba, hányadik sor).
  Ez a fázis zárásának feltétele. Addig nincs kész a Fázis 3.

---

## Fázis 4 — Looker Studio dashboard *(1–2 nap)*

### Fejlesztő

- [ ] **41 — Adatforrás + Data Blend**
  Looker Studio → Adatforrás hozzáadása → Google Sheets → SSOT sheet kiválasztása.
  Két adatforrás: BEJÖVŐ_SZÁMLÁK és SZÁMLA_TÉTELEK.
  Data Blend: Left Outer Join, kulcs: Számla ID.
  Csak akkor lesz helyes, ha BEJÖVŐ_SZÁMLÁK Számla ID-ja és SZÁMLA_TÉTELEK FK-ja pontosan egyezik.

- [ ] **42 — 5 dashboard oldal**
  — **Főoldal:** státuszok szerinti bontás, nyitott tételek összesítve, lejáró számlák kiemelve
  — **Cash flow:** következő 30 nap fizetési határidői, összesített várható kiadás
  — **ÁFA:** havi bontás teljesítési dátum alapján (nem fizetési dátum)
  — **Kintlévőség:** KIMENŐ_SZÁMLÁK — ki, mennyit, mióta nem fizetett
  — **Lejárt tételek:** 15 / 30 / 60+ napos buckets, partnerenként

### Pénzügyi vezető + Operatív vezető

- [ ] **43 — Dashboard review**
  Megnézni éles adatokon. Visszajelzés: mi hiányzik, mi félrevezető, mi felesleges.
  Ha nincs visszajelzés 3 munkanapon belül, a dashboard lezártnak tekinthető.

---

## Fázis 5 — Éves karbantartó task-ok

### Fejlesztő

- [ ] **51 — Scheduled task-ok létrehozása (schedule skill)**
  **Január 1. — Ünnepnap cache frissítés:**
  Nager.Date API fetch (withRetry) → HOLIDAYS_{ÉV+1} sor írása CONFIG fülre, státusz: ELLENŐRZENDŐ
  Chat értesítő: "Ellenőrizd és állítsd VERIFIED-re: [Sheet link]"

  **December 1. — Áthelyezett munkanapok emlékeztető:**
  Chat üzenet: "Töltsd ki a WORKING_SATURDAYS_{ÉV+1} sort a CONFIG fülön, majd VERIFIED-re állítsd. Forrás: Magyar Közlöny (október–november). [Sheet link]"

### Pénzügyi vezető / IT felelős

- [ ] **52 — WORKING_SATURDAYS_2026 VERIFIED-re állítása** *(élesítés előtt kötelező)*
  CONFIG fül → WORKING_SATURDAYS_2026 sor → Státusz oszlop → `VERIFIED`
  Ha ez nem történik meg élesítés előtt, a getNextWorkday() logol, de téves utalási dátumot adhat.

---

*A lista akkor zárul, ha az összes checkbox ki van pipálva és Fázis 3 teszt importja sikeres volt MagNet NetBankban.*