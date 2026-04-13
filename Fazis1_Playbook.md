# FÁZIS 1 VÉGREHAJTÁSI PLAYBOOK
## Armadillo Pénzügyi Automatizáció — Gmail befogadó + Gemini OCR

**Verzió:** 1.0 · **Dátum:** 2026-03-29
**Státusz:** Végrehajtásra kész

---

## FÜGGŐSÉGI SORREND — MI BLOKKOL MIT

```
Fázis 0 (01–05) kész ─────┐
P1 — szamlazas@ Group ────┼──► Fejlesztő (11, 12, 13)
P2 — webhook URL-ek ──────┘
                                └──► Mindenki (14 — éles teszt)
```

**Ha ezek nincsenek kész, nem szabad elkezdeni Fázis 1-et:**

| Blokkoló | Felelős | Mit blokkol |
|---|---|---|
| Fázis 0 mind az 5 task | Fejlesztő + Péter + Ági | Task 11, 12, 13 |
| P1 — szamlazas@ Google Group | IT felelős | Task 11 (email nem érkezik be) |
| P2 — webhook URL-ek (3 db) | IT felelős | Task 13 (Chat értesítők nem mennek ki) |

**Ha P2 hiányzik:** Task 11 és 12 elvégezhető, de Task 13 nem zárható le — a Chat értesítők nem működnek.

---

## FEJLESZTŐ — Fázis 1 *(autobot@ fiókból elvégezve)*

> Előfeltétel: Fázis 0 kész. P1 kész (szamlazas@ Group működik).

### Task 11 — Gmail befogadó + PDF Drive-ra mentés

- [ ] Apps Script megnyitása: SSOT sheet → **Extensions → Apps Script**
- [ ] `GmailDrive.gs` fájl létrehozása
- [ ] Gmail filter implementálása: `in:inbox is:unread has:attachment`
  - Autobot@ saját inboxát vizsgálja (P1 előfeltétele!)
- [ ] **PDF mentés az ELSŐ lépés** — minden más előtt
  - Célmappa: `Bejövő számlák/2026/MM_Hónap/` (pl. `03_Március/`)
  - Ha az almappa nem létezik: kód hozza létre automatikusan (`DriveApp.createFolder()`)
  - Ha a Drive-mentés sikertelen: feldolgozás MEGÁLL, email marad `unread` → retry-trigger újra megtalálja
- [ ] Gmail message ID kinyerése (`GmailMessage.getId()`) → W oszlopba mentés (deduplikáció)
  - Ha az ID már szerepel a W oszlopban: email kihagyása

**✅ Kész, ha:** Tesztlevél PDF-fel küldve → Drive `Bejövő számlák/2026/MM_Hónap/` mappában megjelent a fájl.

---

### Task 12 — Gemini OCR + SSOT Sheet írás

- [ ] `GeminiOCR.gs` és `SheetWriter.gs` fájlok létrehozása
- [ ] Gemini API hívás `withRetry(fn, 3, 30000)` wrapperrel (30s → 60s → 90s backoff)
- [ ] Prompt felépítése — kötelező elemek:
  - Fejléc mezők kinyerése (szállító neve, adószám, számla száma, kelt, teljesítés, határidő, összegek, deviza)
  - **Tételsorok** kinyerése (leírás, mennyiség, egységár, nettó, ÁFA, bruttó)
  - **Minden tételsorhoz:** `po` (projektszám), `po_confidence` (0–100), `po_reasoning`
  - Structured JSON response kényszerítés
- [ ] Fejléc aggregálás a kód által (nem Gemini):
  - `po_summary`: ha 1 egyedi PO → konkrét PO; ha több → `MULTI`; ha ≥1 nem azonosítható → `HIÁNYOS`
  - `po_confidence` (aggregált): 1 PO → annak confidence értéke; MULTI → `MIN(tételek conf.)`; HIÁNYOS → `0`
  - `po_reasoning` (aggregált): 1 PO → AI reasoning; MULTI → `"MULTI_TETEL – lásd SZÁMLA_TÉTELEK"`; HIÁNYOS → `"NINCS_PO"`
- [ ] Státusz-döntés:
  - Ha kategória `ÁLLANDÓ` → `PO_SUMMARY = N/A` → státusz: `BEÉRKEZETT` (PO ellenőrzés kihagyva)
  - Ha **bármely tétel** `PO_VALIDÁLT = NEM` (conf < 95 VAGY PO nem szerepel PROJEKTEK.A-ban) → `HIÁNYOS_PO`
  - Ha minden tétel `PO_VALIDÁLT = IGEN` → `BEÉRKEZETT`
- [ ] SSOT írás `LockService.getScriptLock()` tranzakcióban — **atomikusan**:
  - `BEJÖVŐ_SZÁMLÁK.appendRow(fejlécAdatok)` — N=PO_SUMMARY, O=agg.conf, P=agg.reasoning, Q=státusz
  - Tételsorok ciklusban: `SZÁMLA_TÉTELEK.appendRow(tétel)` — J=projektszám, K=conf, L=reasoning, M=PO_VALIDÁLT
  - Ha lock nem szerezhető 10 másodpercen belül: `LOCK_TIMEOUT` → retry

**✅ Kész, ha:** Tesztszámla után BEJÖVŐ_SZÁMLÁK-ban új sor, SZÁMLA_TÉTELEK-ben tételsorok K/L/M oszlopokkal kitöltve, PO_SUMMARY N oszlopban aggregált érték.

---

### Task 13 — Hibakezelés + triggerek

- [ ] `try-catch` minden kritikus ponton:
  - Hiba esetén: számla státusza → `AI_HIBA`
  - `notifyAdmin()` → email `ADMIN_EMAIL`-re hibaüzenettel + stack trace-szel
  - Chat webhook hiba esetén: Gmail fallback az ops + finance email-ekre
- [ ] **15 perces time-driven trigger létrehozása — CSAK autobot@ fiókból!**
  - Script Editor → bal oldalt: ⏰ Triggers → + Add Trigger
  - Függvény: `processNewInvoices`
  - Event source: Time-driven
  - Type: Minutes timer → Every 15 minutes
  - Hiba értesítés: email az autobot@-ra ha a trigger hibázik
- [ ] `validateRow()` onEdit trigger beállítása (Validation.gs-ből meghívva):
  - Figyeli: SZÁMLA_TÉTELEK J oszlop (PO FK), K oszlop (0–100 range), PROJEKTEK A oszlop (regex)
  - Hibás sor → piros háttér + CONFIG fülre hibalog

> ⚠️ KRITIKUS: Ha a triggert személyes fiókból hozzák létre, az fiók kompromittálódásakor hibaüzenet nélkül leáll.

**✅ Kész, ha:** Trigger látható az autobot@ fiók Triggers listájában, 15 percenként fut, Executions nézetben sikeres futás látható.

---

## MINDENKI — Task 14 — Éles tesztszámla

> Előfeltétel: Task 11, 12, 13 mind kész. P1 kész.

- [ ] Valós PDF számla küldése `szamlazas@armadillo.hu`-ra csatolmányként
- [ ] 15 percen belül ellenőrizni:
  - [ ] **Drive:** megjelent-e a PDF a `Bejövő számlák/2026/MM_Hónap/` mappában?
  - [ ] **BEJÖVŐ_SZÁMLÁK:** van-e új sor? N/O/P oszlopok kitöltve?
  - [ ] **SZÁMLA_TÉTELEK:** megjelentek-e a tételsorok? K/L/M oszlopok kitöltve?
  - [ ] **Státusz (Q oszlop):** `BEÉRKEZETT` vagy `HIÁNYOS_PO`? (PO_CONFIDENCE értéke alapján várható)
  - [ ] **W oszlop:** Gmail message ID mentve?
- [ ] Ha valami nem stimmel: Apps Script → **Executions** nézet → hiba olvasása
- [ ] Második küldés ugyanazzal az emailünkkel: **deduplikáció teszt** — nem szabad második sort felvennie

**✅ Kész, ha:** PDF Drive-on, SSOT sorok helyesek, státusz logikus, duplikáció nem keletkezett.

---

## FÁZIS 1 ZÁRÁSI KRITÉRIUM

Fázis 1 csak akkor zárható, ha **mind a 4 task** kész:

| Task | Felelős | Státusz |
|---|---|---|
| 11 — Gmail befogadó + PDF Drive-ra | Fejlesztő | ☐ |
| 12 — Gemini OCR + Sheet írás | Fejlesztő | ☐ |
| 13 — Hibakezelés + triggerek | Fejlesztő | ☐ |
| 14 — Éles tesztszámla | Mindenki | ☐ |

**Ellenőrzés — fejlesztő + Ági/Péter együtt:**

- [ ] PDF Drive-on megjelent a megfelelő mappában
- [ ] BEJÖVŐ_SZÁMLÁK: N=PO_SUMMARY helyes érték (konkrét PO / MULTI / HIÁNYOS)
- [ ] BEJÖVŐ_SZÁMLÁK: O=PO_CONFIDENCE aggregált szám (0–100)
- [ ] SZÁMLA_TÉTELEK: minden tételsorhoz K (conf), L (reasoning), M (IGEN/NEM) kitöltve
- [ ] Státusz logikus: ha minden tétel jó PO-val → BEÉRKEZETT; ha valamelyik nem → HIÁNYOS_PO
- [ ] ÁLLANDÓ kategóriájú számla: PO ellenőrzés nélkül BEÉRKEZETT
- [ ] Trigger autobot@ fiókból fut (nem személyes fiókból)
- [ ] Duplikált email: nem vesz fel új sort

Ha bármelyik nem teljesül: **Fázis 2 nem indul el.**

---

## MI TÖRTÉNIK, HA VALAMI HIÁNYZIK

| Mi hiányzik | Következmény |
|---|---|
| P1 (szamlazas@ Group) nincs kész | Email nem érkezik autobot@-ba — a trigger fut, de üres inboxot lát |
| P2 (webhook URL-ek) nincs kész | Task 13 nem zárható le — Chat értesítők hiányoznak, Gmail fallback sem inicializálható |
| Trigger személyes fiókból lett létrehozva | Fiók inaktívvá válásakor leáll, hibaüzenet nélkül |
| PROJEKTEK fül üres (P12 nem kész) | Minden bejövő számla HIÁNYOS_PO lesz — Fázis 1 "működik", de értéktelen kimenetet ad |
| Fázis 0 Task 01 nem kész | Apps Script projekt nem létezik — Fázis 1 nem indítható |

---

*Következő fázis: Fázis 2 — HIÁNYOS_PO logika + visszautasítás. Előfeltétel: Fázis 1 teljesen lezárva.*
