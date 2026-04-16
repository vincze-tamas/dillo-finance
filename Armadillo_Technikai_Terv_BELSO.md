

| TECHNIKAI MEGVALÓSÍTÁSI TÉRKÉP Armadillo Pénzügyi Automatizáció — Belső referencia BELSŐ DOKUMENTUM — Nem adható át ügyfélnek  |  v1.1 · 2026\. március 29\. |
| :---: |

| Ez a dokumentum az üzleti ajánlathoz tartozó technikai párdokumentum. Az ügyfélnek átadott ajánlatban nem szerepel utalás erre. Tartalom: feladatonkénti technikai spec, blokkolók, tesztelési feltételek. |
| :---- |

# **PRE-0 — Előkészítés (nem kód)**

| Ha P1, P2, P6 nincs kész, a kód hiába fut — nem kap emailt, nem tud írni, nem tud értesíteni. Fejlesztés csak P3–P7 után indul. Kódot írni addig értelmetlen. |
| :---- |

| ID | Feladat | Felelős | Blokkolja | Státusz |
| :---- | :---- | :---- | :---- | :---- |
| P1 | szamlazas@ Google Group → autobot@-ra delivery (nem forward) | IT felelős | Fázis 1 | ✅ KÉSZ |
| P2 | Chat webhook URL-ek (3 db: OPS \+ Finance \+ Admin) | IT felelős | Fázis 1 | ✅ KÉSZ |
| P3 | Shared Drive létrehozás autobot@-ból \+ mappastruktúra | IT felelős | Fázis 1 | ✅ KÉSZ |
| P4 | Jogosultságok beállítása (Content manager / Szerkesztő / Olvasó) | IT felelős | Fázis 1 | ✅ KÉSZ |
| P5 | Gemini API key átadása fejlesztőnek biztonságos csatornán | IT felelős | Fázis 1 | ✅ KÉSZ |
| P6 | Banki partnerek.xls: teljes név \+ IBAN \+ kategória \+ aktív | Péter | Fázis 1 | ✅ KÉSZ |
| P7 | Jóváhagyásra jogosultak listája (név \+ email) | Ági | Fázis 1 | ⬜ |
| P8 | MagNet HUF CS-ÁTUTALÁS spec dokumentálva | Fejlesztő | Fázis 3 | ✅ KÉSZ |
| P9 | Jogcím kód megerősítése (F217, vélhetően K01) | Péter | Fázis 3 | ⬜ |
| P10 | SEPA köteg formátum: .txt/.xml/.csv? — MagNet-ben ellenőrizni | Péter | Fázis 3 EUR | ⬜ |
| P11 | IBM 852 ASCII teszt: 1 Ft próbautalás belső számlára | Fejlesztő \+ Péter | Fázis 3 | ⬜ |

# **Fázis 1 — SSOT \+ Gmail befogadó \+ PDF archiválás**

Az üzleti ajánlatban: 'számla feldolgozás stabilizálása'. Technikailag: Fázis 0 (sheet) \+ Fázis 1 Gmail (feladatlista szerint).

## **01 — SSOT sheet (autobot@ fiókból)**

* Shared Drive → SSOT/ → Új Táblázat: '\[SSOT\] Armadillo Pénzügyi Adatbázis'

* 7 fül ebben a sorrendben: BEJÖVŐ\_SZÁMLÁK · SZÁMLA\_TÉTELEK · PROJEKTEK · PARTNEREK · KÖTEGEK · KIMENŐ\_SZÁMLÁK · CONFIG

* Fejlécek: az Implementációs Terv 3\. fejezet szerint (A–X oszlopok BEJÖVŐ\_SZÁMLÁK-on)

## **02 — Data validation \+ conditional formatting**

* Q oszlop dropdown: BEÉRKEZETT / HIÁNYOS\_PO / VISSZAUTASÍTVA / JÓVÁHAGYVA / UTALVA / AI\_HIBA / LOCK\_TIMEOUT

* L oszlop: HUF / EUR  |  M oszlop: PROJEKT / ÁLLANDÓ

* Sorok színkódja Q oszlop alapján: kék→sárga→piros→zöld→lila→sötétpiros→narancs

* *(BEKÖTEGELT nem státusz — a kötegelt állapot a V oszlop KOTEG\_ID értékéből levezethető)*

## **03 — Apps Script projekt \+ CONFIG**

* Extensions → Apps Script (autobot@ fiókból nyitva)

* CONFIG object: ADMIN\_EMAIL, GEMINI\_MODEL, PO\_CONFIDENCE\_THRESHOLD=95, folder ID-k, CHAT\_WEBHOOK\_OPS, CHAT\_WEBHOOK\_FINANCE, CHAT\_WEBHOOK\_ADMIN

* Gemini key: PropertiesService.getScriptProperties() — soha nem hardcode, soha nem Sheetbe

## **11 — Gmail befogadó \+ PDF Drive-ra mentés**

* Gmail filter: in:inbox is:unread has:attachment — autobot@ saját inbox

* PDF mentés: ELSŐ lépés, mindent megelőz. Ha Drive-mentés sikertelen → megáll, email marad unread

* Célmappa: Bejövő számlák/2026/MM\_Hónap/ — ha a mappa nem létezik, kód hozza létre

* Gmail message ID → W oszlop → deduplikáció: ha már benne van, átugorja

## **Tesztelési feltétel**

| Valós PDF számla → szamlazas@-ra. 15 percen belül: — Drive: PDF megjelent a hónapos mappában — Sheet BEJÖVŐ\_SZÁMLÁK: új sor, korrekt státusz Ha ezek nem teljesülnek: Apps Script → Executions → hiba olvasása. |
| :---- |

# **Fázis 2 — Gemini OCR \+ AI réteg \+ visszautasítás**

Az üzleti ajánlatban: 'automatizáció és AI réteg'. Technikailag: Fázis 1 és Fázis 2 (feladatlista szerint).

## **12 — Gemini OCR \+ Sheet írás**

* withRetry(fn, 3, 30000): 30s → 60s → 90s exponenciális backoff

* Prompt: fejléc mezők \+ tételsorok kinyerése, structured JSON — **tétel szintű** po, po\_confidence (0–100), po\_reasoning minden tételsorhoz
* Fejléc aggregálás: po\_summary (konkrét / MULTI / HIÁNYOS), po\_confidence (aggregált: 1 PO → conf; MULTI → MIN; HIÁNYOS → 0), po\_reasoning (aggregált)
* SZÁMLA\_TÉTELEK K/L/M oszlopok: K=PO\_CONFIDENCE, L=PO\_REASONING, M=PO\_VALIDÁLT (IGEN/NEM — IGEN ha J ∈ PROJEKTEK.A és K ≥ 95)
* BEJÖVŐ\_SZÁMLÁK N/O/P: N=PO\_SUMMARY, O=aggregált PO\_CONFIDENCE, P=aggregált PO\_REASONING

* LockService.getScriptLock() tranzakció: fejléc \+ tételsorok atomikusan — ha lock nem szerezhető 10s-en belül: LOCK\_TIMEOUT → retry

## **21 — HIÁNYOS\_PO routing \+ ÁLLANDÓ bypass**

* Ha **bármely tétel** PO\_VALIDÁLT = NEM (po\_confidence \< 95 VAGY po nem szerepel PROJEKTEK.A-ban) → HIÁNYOS\_PO státusz

* Ha kategória ÁLLANDÓ → PO nem kell → direkt BEÉRKEZETT (soha nem kerül HIÁNYOS\_PO-ba)

* Ez a két ág nem cserélhető fel — sorrendtől függ

## **13 \+ 23 — Hibakezelés \+ onEdit trigger**

* try-catch minden kritikus ponton: AI\_HIBA státusz \+ notifyAdmin() (email \+ stack trace)

* onEdit trigger: Q oszlop → VISSZAUTASÍTVA → visszautasító email (sablon Ágitól, P7)

* Chat webhook hiba → Gmail fallback értesítő ops \+ finance emailre

* Trigger létrehozása autobot@ fiókból — nem személyes fiókból

## **Tesztelési feltétel**

| HIÁNYOS\_PO tételt kézzel VISSZAUTASÍTVA-ra állítani → email kiküldve partnernek? Helyes sablon? AI\_HIBA szimuláció: Gemini key ideiglenesen rossz → AI\_HIBA státusz \+ admin email? |
| :---- |

# **Fázis 3 — Szerdai workflow \+ batch generátor**

Előfeltétel: P8 ✅ KÉSZ. P9 (jogcím kód) \+ P11 (IBM 852 teszt) kötelező a HUF ághoz. P10 az EUR ághoz. Az üzleti ajánlatban: 'Pénzügyi operáció és kifizetési rendszer '. Technikailag: Fázis 3 (feladatlista szerint).

## **31 — Szerda 9:00 digest**

* Time-driven trigger: szerda 9:00, autobot@ fiókból

* BEÉRKEZETT PROJEKT → Chat ops webhook (Ági \+ Márk)

* BEÉRKEZETT ÁLLANDÓ → Chat finance webhook (Péter)

* 7 napon belül lejáró, jóvá nem hagyott tétel: kiemelve mindkét digest-ben

* HIÁNYOS\_PO tételek az ops digest-ben → Ági dönt: PO kézzel beviszi / VISSZAUTASÍTVA. OPS Chat üzenet **tétel-szintű bontással**: sor | PO érték | Conf % | Gemini reasoning

## **32 — Batch generátor (HUF — IBM 852 fix szélességű rekord)**

* Szerda 14:00 trigger — csak JÓVÁHAGYVA státuszú számlákat dolgoz fel

* Rekord struktúra: 01 FEJ (174 char) \+ N×02 TÉTEL (249 char) \+ 03 LÁB (24 char)

* T213 összeg: egész forint, tizedes TILOS  |  T218 tulajdonos neve: 35 char, első 32 jut el

* T219 közlemény: 70 char, de csak első 18 jut el kedvezményezetthez

* IBM 852 stratégia: ASCII transzliteráció (á→a, é→e, ő→o, ű→u) — P11 validálja

* Fájlnév: BATCH-2026-W{hét}-HUF\_{dátum}.txt  |  Drive: Kötegek/2026/ mappába

* KÖTEGEK fülre sor \+ érintett számlák V oszlopa (KOTEG\_ID) kitöltve \+ Chat értesítő Péternek (Drive link)

## **getNextWorkday() — ünnepnap logika**

* CONFIG fülről olvas: HOLIDAYS \+ WORKING\_SATURDAYS, csak VERIFIED státuszú sor

* Ha sor ELLENŐRZENDŐ: logol \+ admin email, de fut tovább (nem áll meg)

* \+3 napos ellenőrző: naponta fut, JÓVÁHAGYVA \+ KOTEG\_ID nem üres \+ utalás dátuma \> 3 napja → Chat Péternek

## **Tesztelési feltétel**

| Kézi trigger → 2 kötegállomány (.txt) generálva (HUF \+ EUR ha van EUR partner) Péter feltölti MagNet NetBankba (Kötegek → Köteg rögzítés → Csoportos átutalás) Ha importálható: fázis kész. Ha hibát jelez: melyik mező, hányadik sor. |
| :---- |

# **Fázis 4 — Looker Studio dashboard**

Az üzleti ajánlatban: 'Dashboard és kontroll réteg '. Technikailag: Fázis 4 (feladatlista szerint).

## **41 — Adatforrás \+ Data Blend**

* Looker Studio → Adatforrás → Google Sheets → SSOT sheet

* 2 adatforrás: BEJÖVŐ\_SZÁMLÁK \+ SZÁMLA\_TÉTELEK

* Data Blend: Left Outer Join, kulcs: Számla ID — csak akkor helyes, ha FK pontosan egyezik

## **42 — 5 dashboard oldal**

* Főoldal: státuszok, nyitott tételek összesítve, lejáró számlák kiemelve

* Cash flow: következő 30 nap fizetési határidői, összesített kiadás

* ÁFA: havi bontás teljesítési dátum alapján (nem fizetési dátum)

* Kintlévőség: KIMENŐ\_SZÁMLÁK — ki, mennyit, mióta

* Lejárt tételek: 15/30/60+ napos buckets, partnerenként

## **Tesztelési feltétel**

| Dashboard valós adatot mutat — nem sample adatot Péter \+ Ági review: 3 munkanapon belül visszajelzés. Ha nincs: lezártnak tekinthető. |
| :---- |

# **Fázis 5 — Éves karbantartó scheduled task-ok**

* Január 1.: Nager.Date API fetch (withRetry) → HOLIDAYS\_{ÉV+1} CONFIG fülre, státusz: ELLENŐRZENDŐ → Chat értesítő

* December 1.: Chat emlékeztető WORKING\_SATURDAYS\_{ÉV+1} kitöltésre \+ VERIFIED-re állításra

* WORKING\_SATURDAYS\_2026 VERIFIED-re állítása kötelező élesítés előtt (Péter / IT felelős)

| Ha WORKING\_SATURDAYS\_2026 nem VERIFIED élesítéskor, getNextWorkday() logol, de téves utalási dátumot adhat. Ez jogi következménnyel járhat — nem kihagyható lépés. |
| :---- |

# **Architektúra összefoglaló**

| Réteg | Technológia | Megjegyzés |
| :---- | :---- | :---- |
| Automatizáció | Google Apps Script (GAS) | Container-bound, autobot@ fiókból |
| AI / OCR | Gemini API (GCP) | gemini-1.5-pro, structured JSON, withRetry |
| Adatbázis | Google Sheets — 1 fájl, 7 fül | SSOT — más adatbázis nem keletkezik |
| Értesítés | Google Chat webhook \+ Gmail fallback | 3 webhook: OPS \+ Finance \+ Admin |
| Archiválás | Google Drive (Shared Drive) | autobot@ tulajdonában |
| Dashboard | Looker Studio | Google Sheets connector, Data Blend |
| Bankkal interfész | Manuális batch feltöltés | Fix szélességű rekord, IBM 852 |
| Kódolás | IBM 852 / ASCII transzliteráció | Apps Script nem kezeli natívan — ASCII stratégia |

