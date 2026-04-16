# FÁZIS 2 VÉGREHAJTÁSI PLAYBOOK
## Armadillo Pénzügyi Automatizáció — HIÁNYOS_PO kezelés + visszautasítás

**Verzió:** 1.0 · **Dátum:** 2026-03-29
**Státusz:** Végrehajtásra kész

---

## FÜGGŐSÉGI SORREND — MI BLOKKOL MIT

```
Fázis 1 (11–14) kész ─────────────────────────────► Fejlesztő (21, 23)
Ági (22 — visszautasító email sablon) ────────────► Fejlesztő (23 beégeti a sablont)
                                                         └──► Ági + Fejlesztő (24 — teszt)
```

**Ha ezek nincsenek kész, nem szabad elkezdeni Fázis 2-t:**

| Blokkoló | Felelős | Mit blokkol |
|---|---|---|
| Fázis 1 mind a 4 task | Fejlesztő | Task 21, 23 |
| Task 22 — visszautasító sablon szövege | Ági | Task 23 (onEdit trigger email-küldés) |

---

## FEJLESZTŐ — Task 21 — HIÁNYOS_PO routing + ÁLLANDÓ bypass

> Előfeltétel: Fázis 1 kész.

- [ ] `Validation.gs`-ben HIÁNYOS_PO döntési logika implementálása:
  - **1. lépés (ÁLLANDÓ bypass — soha ne kerüljön HIÁNYOS_PO-ba):**
    ```
    Ha BEJÖVŐ_SZÁMLÁK M oszlop = "ÁLLANDÓ":
      → PO_SUMMARY = "N/A"
      → Státusz = BEÉRKEZETT
      → PO ellenőrzés kihagyva
    ```
  - **2. lépés (PROJEKT kategória):**
    ```
    Ha bármely tétel PO_VALIDÁLT = NEM:
      → Státusz = HIÁNYOS_PO
    Ha minden tétel PO_VALIDÁLT = IGEN:
      → Státusz = BEÉRKEZETT
    ```
  - A két ág sorrendje nem cserélhető fel — az ÁLLANDÓ bypass mindig előbb fut

**✅ Kész, ha:** ÁLLANDÓ kategóriájú számla beérkezésekor soha nem kerül HIÁNYOS_PO-ba. PROJEKT kategória esetén helyes döntés születik.

---

## OPERATÍV VEZETŐ (ÁGI) — Task 22 — Visszautasító email sablon

> Nincs technikai előfeltétel. Ági bármikor elvégezheti.

- [ ] Összeállítani a szállítónak küldendő visszautasító email szövegét
- [ ] Kötelező tartalom:
  - [ ] Mi hiányzott (projektszám nem azonosítható)
  - [ ] Hogyan küldje újra a számlát helyesen
  - [ ] Kivel vegye fel a kapcsolatot (Ági email-je)
- [ ] Szöveg átadása a fejlesztőnek (email / Chat)
- [ ] A sablon tartalmaz-e változó mezőket? (pl. szállító neve, számla száma) — ha igen, jelölni `{SZÁLLÍTÓ_NEVE}` formában

**✅ Kész, ha:** Fejlesztő visszaigazolta, hogy megkapta a sablont.

---

## FEJLESZTŐ — Task 23 — onEdit trigger + Chat fallback

> Előfeltétel: Task 22 kész (sablon megvan).

- [ ] `onEdit` trigger implementálása (Apps Script → `Triggers.gs`):
  - Figyeli: BEJÖVŐ_SZÁMLÁK Q oszlop (Státusz)
  - Ha érték `VISSZAUTASÍTVA`-ra változik:
    - Partner email kikeresése PARTNEREK fülről (szállító neve alapján)
    - Visszautasító email küldése `GmailApp.sendEmail()` az Ági által megadott sablonnal
    - Változók behelyettesítése: `{SZÁLLÍTÓ_NEVE}`, `{SZÁMLA_SZÁMA}` stb.
- [ ] Chat webhook hiba esetén fallback:
  ```javascript
  try {
    sendChatMessage(CHAT_WEBHOOK_OPS, payload);
  } catch(e) {
    GmailApp.sendEmail(CONFIG.ADMIN_EMAIL, "Chat webhook hiba", e.toString());
  }
  ```
- [ ] `validateRow()` onEdit trigger — ha SZÁMLA_TÉTELEK J oszlopba nem létező projektszám kerül:
  - Cella háttere piros
  - Hibalog a CONFIG fülre (timestamp + sor + érték)

**✅ Kész, ha:** HIÁNYOS_PO státuszú sort manuálisan VISSZAUTASÍTVA-ra állítva → email kiküldve a partner email-jére.

---

## ÁGI + FEJLESZTŐ — Task 24 — Visszautasítás teszt

- [ ] Kiválasztani egy `HIÁNYOS_PO` státuszú tesztsort a BEJÖVŐ_SZÁMLÁK-ban
- [ ] Q oszlopban manuálisan átállítani: `HIÁNYOS_PO` → `VISSZAUTASÍTVA`
- [ ] Ellenőrizni:
  - [ ] Email megérkezett a partner email-jére? (tesztnél saját email-cím is használható)
  - [ ] Helyes sablon szöveg? Változók behelyettesítve?
  - [ ] Helyes partner email? (PARTNEREK fülről vette?)
- [ ] Szimulálni AI hibát: Gemini key ideiglenesen hibásra cserélni →
  - [ ] `AI_HIBA` státusz megjelenik-e?
  - [ ] Admin email kiküldve az ADMIN_EMAIL-re?

**✅ Kész, ha:** Email kézbesítve, sablon helyes, AI_HIBA szimulációban admin értesítő megérkezett.

---

## FÁZIS 2 ZÁRÁSI KRITÉRIUM

Fázis 2 csak akkor zárható, ha **mind a 4 task** kész:

| Task | Felelős | Státusz |
|---|---|---|
| 21 — HIÁNYOS_PO routing + ÁLLANDÓ bypass | Fejlesztő | ✅ 2026-04-16 |
| 22 — Visszautasító email sablon | Ági | ☐ |
| 23 — onEdit trigger + Chat fallback | Fejlesztő | ✅ 2026-04-16 |
| 24 — Visszautasítás teszt | Ági + Fejlesztő | ✅ 2026-04-16 |

**Ellenőrzés:**

- [ ] ÁLLANDÓ kategóriájú számla → soha nem HIÁNYOS_PO
- [ ] PROJEKT kategória, minden tétel PO_VALIDÁLT=IGEN → BEÉRKEZETT
- [ ] PROJEKT kategória, 1 tétel rossz PO → HIÁNYOS_PO
- [ ] VISSZAUTASÍTVA átállítás → visszautasító email kiküldve, sablon helyes
- [ ] AI_HIBA → admin email értesítő
- [ ] Chat webhook hiba → Gmail fallback aktiválódik

Ha bármelyik nem teljesül: **Fázis 3 nem indul el.**

---

## MI TÖRTÉNIK, HA VALAMI HIÁNYZIK

| Mi hiányzik | Következmény |
|---|---|
| Task 22 sablon késik | Task 23 nem zárható le — onEdit trigger emailt nem tud küldeni |
| PARTNEREK fül hiányos email-ek | Visszautasító email nem megy ki — partner értesítetlen marad |
| onEdit trigger személyes fiókból | Fiók inaktívvá válásakor leáll — visszautasítások csendben elmaradnak |
| Chat webhook hiba kezeletlen | Ha OPS webhook leáll, Ági és Márk nem kap értesítést |

---

*Következő fázis: Fázis 3 — Szerdai workflow + batch generátor. Előfeltétel: P9 (jogcím kód) + P11 (IBM 852 ASCII teszt) kész.*
