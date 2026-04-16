/**
 * WednesdayWorkflow.gs
 * Armadillo Pénzügyi Automatizáció — Szerdai munkafolyamat
 *
 * Két time-driven trigger hívja (Triggers.gs állítja be):
 *   wednesdayMorningDigest()   — Minden munkanap 09:00 → fut ha ez a hét digest napja
 *   wednesdayAfternoonBatch()  — Minden munkanap 14:00 → fut ha ez a hét digest napja
 *
 * "Digest nap" definíció: az adott héten az első munkanap, ami szerda vagy azt követi.
 * Ha szerda-péntek mind ünnep → azon a héten nem fut. A beragadt számlák a következő
 * heti digest-ben automatikusan megjelennek.
 *
 * CONFIG fül kulcsai (dupla futás megelőzéséhez):
 *   LAST_DIGEST_DATE  — utolsó digest futás dátuma (YYYY-MM-DD)
 *   LAST_BATCH_DATE   — utolsó batch generálás dátuma (YYYY-MM-DD)
 *
 * Betöltő függvények:
 *   _loadPendingInvoices_()          — JÓVÁHAGYVA + nincs KOTEG_ID (batch + Finance digest)
 *   _loadBeerkzetRows_(kategoria)    — BEÉRKEZETT + adott kategória (OPS/Finance digest)
 *   _loadHianyosPORowsWithTetelek_() — HIÁNYOS_PO + SZÁMLA_TÉTELEK bontással (OPS digest)
 */

// ─────────────────────────────────────────────────────────────────────────────
// SZERDA 09:00 — DIGEST
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minden munkanapon fut 09:00-kor. Digest küldés ha:
 *   1. Ma az adott hét "digest napja" (első munkanap szerda vagy után)
 *   2. Ezen a héten még nem futott digest (ISO hét összehasonlítás)
 * NE nevezd át — Triggers.gs erre a névre hivatkozik.
 */
function wednesdayMorningDigest() {
  const today = new Date();
  console.log('wednesdayMorningDigest: ' + today.toISOString());
  _assertProductionConfig_();

  if (!_isTodayDigestDay_(today)) {
    console.log('Ma nem digest nap — kihagyva. (Várt nap: ' +
      formatDate(_getThisWeeksDigestDay_(today)) + ')');
    return;
  }

  // KRI-02: Check-and-claim atomi — párhuzamos trigger nem futhat le kétszer egy héten.
  // Stratégia: a dátumot LEFOGLALÁS előtt írjuk (claim-before-work), és a
  // lock csak az olvasás+írás minimális szakaszát védi. Így nincs deadlock
  // a _loadPendingInvoices_() belső lockjával.
  const lock = acquireLock();
  let claimed = false;
  try {
    const lastDigest = _readConfigDate_('LAST_DIGEST_DATE');
    if (lastDigest && _isSameISOWeek_(today, lastDigest)) {
      console.log('Digest ezen a héten már futott (' + formatDate(lastDigest) + ') — kihagyva.');
    } else {
      _writeConfigDate_('LAST_DIGEST_DATE', today); // lefoglalás: ha párhuzamos trigger
      claimed = true;                               // is idáig jutott, ő már kihagyja
    }
  } finally {
    lock.releaseLock();
  }
  if (!claimed) return;

  const utalasDate    = getNextWorkday(today, 1);
  console.log('Tervezett utalási nap: ' + formatDate(utalasDate));

  // ── OPS digest (Ági + Márk): BEÉRKEZETT PROJEKT + HIÁNYOS_PO
  const projektRows = _loadBeerkzetRows_(CONFIG.KATEGORIAK.PROJEKT);
  const hianyosRows = _loadHianyosPORowsWithTetelek_();
  console.log('BEÉRKEZETT PROJEKT: ' + projektRows.length +
              ', HIÁNYOS_PO: ' + hianyosRows.length);
  notifyOpsDigest(projektRows, hianyosRows, utalasDate);

  // ── Finance digest (Péter): BEÉRKEZETT ÁLLANDÓ + JÓVÁHAGYVA
  const allandoRows = _loadBeerkzetRows_(CONFIG.KATEGORIAK.ALLANDO);
  const pendingRows = _loadPendingInvoices_();
  console.log('BEÉRKEZETT ÁLLANDÓ: ' + allandoRows.length +
              ', JÓVÁHAGYVA: ' + pendingRows.length);
  notifyWednesdayDigest(pendingRows, utalasDate, allandoRows);

  console.log('✅ Digest elküldve. LAST_DIGEST_DATE → ' + formatDate(today));
}

// ─────────────────────────────────────────────────────────────────────────────
// SZERDA 14:00 — BATCH GENERÁLÁS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minden munkanapon fut 14:00-kor. Batch generálás ha:
 *   1. Ma az adott hét "digest napja"
 *   2. Ezen a héten még nem futott batch
 * NE nevezd át — Triggers.gs erre a névre hivatkozik.
 */
function wednesdayAfternoonBatch() {
  const today = new Date();
  console.log('wednesdayAfternoonBatch: ' + today.toISOString());
  _assertProductionConfig_();

  if (!_isTodayDigestDay_(today)) {
    console.log('Ma nem digest nap — batch kihagyva.');
    return;
  }

  // KRI-02: Check-and-claim atomi — azonos minta mint a digest-nél.
  const lock = acquireLock();
  let claimed = false;
  try {
    const lastBatch = _readConfigDate_('LAST_BATCH_DATE');
    if (lastBatch && _isSameISOWeek_(today, lastBatch)) {
      console.log('Batch ezen a héten már futott (' + formatDate(lastBatch) + ') — kihagyva.');
    } else {
      _writeConfigDate_('LAST_BATCH_DATE', today); // claim-before-work
      claimed = true;
    }
  } finally {
    lock.releaseLock();
  }
  if (!claimed) return;

  const pendingRows = _loadPendingInvoices_();
  console.log('JÓVÁHAGYVA számlák száma: ' + pendingRows.length);

  if (pendingRows.length === 0) {
    console.log('Nincs utalandó számla — batch generálás kihagyva.');
    return;
  }

  const utalasDate = getNextWorkday(today, 1);
  const result     = generateAndSaveBatch(pendingRows, utalasDate);

  if (result) {
    console.log('✅ Batch kész: ' + result.kotegId + ' (' + pendingRows.length + ' számla)');
    notifyBatchReady(
      result.kotegId,
      pendingRows.length,
      result.osszesenHuf,
      result.driveUrl,
      formatDate(utalasDate)
    );
  } else {
    console.error('Batch generálás sikertelen — lásd a korábbi hiba logokat.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DIGEST NAP LOGIKA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Megadja az adott héten a "digest napot":
 * az első munkanapot, ami szerda (dayOfWeek=3) vagy azt követi.
 * Ha szerda-péntek mind ünnep → null (azon a héten nincs digest nap).
 *
 * @param {Date} date
 * @returns {Date|null}
 */
function _getThisWeeksDigestDay_(date) {
  // Megkeressük az adott ISO hét szerdáját
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // ISO heti napszám: hétfő=1 … szombat=6, vasárnap=7 (ISO vasárnap a hét UTOLSÓ napja)
  // getDay() vasárnapra 0-t ad — ez +3 offset-tel a KÖVETKEZŐ hét szerdájára ugrana (bug)
  const dow    = d.getDay();
  const isoDay = (dow === 0) ? 7 : dow; // getDay() 0=vasárnap → ISO 7

  // ISO-konform szerda: hétfő - 1 + 3 = hétfő + 2 = szerda
  const wednesday = new Date(d);
  wednesday.setDate(d.getDate() - isoDay + 3); // negatív offset vasárnapra helyes

  // Végigpróbáljuk szerda → csütörtök → péntek
  for (let offset = 0; offset <= 2; offset++) {
    const candidate = new Date(wednesday);
    candidate.setDate(wednesday.getDate() + offset);
    // Ha a candidate még az adott héten belül van (nem lépünk a következő hétfőre)
    if (_isSameISOWeek_(candidate, wednesday) && _isWorkdaySimple_(candidate)) {
      return candidate;
    }
  }
  return null; // szerda-péntek mind ünnep
}

/**
 * Igaz, ha a mai nap az adott hét digest napja.
 * @param {Date} today
 * @returns {boolean}
 */
function _isTodayDigestDay_(today) {
  const digestDay = _getThisWeeksDigestDay_(today);
  if (!digestDay) return false;
  return formatDate(today) === formatDate(digestDay);
}

/**
 * Egyszerű munkanap ellenőrzés — csak hétvége + a CONFIG-ból olvasott ünnepnapok.
 * Újrahasználja a Utils.gs getNextWorkday() belső logikáját indirekt módon:
 * ha getNextWorkday(date, 0) == date → munkanap.
 * @param {Date} date
 * @returns {boolean}
 */
function _isWorkdaySimple_(date) {
  const next = getNextWorkday(date, 0);
  return formatDate(date) === formatDate(next);
}

// ─────────────────────────────────────────────────────────────────────────────
// ISO HÉT SEGÉDFÜGGVÉNYEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Visszaadja a dátum ISO hét számát (1–53).
 * ISO 8601: hét hétfőn kezdődik, az év első hete az, amelyik csütörtököt tartalmaz.
 * @param {Date} date
 * @returns {number}
 */
function _getISOWeek_(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // Csütörtökra igazítjuk (ISO hét csütörtök alapján van definiálva)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 4); // jan 4. mindig az 1. hétben van
  return 1 + Math.round(((d - yearStart) / 86400000 - 3 + ((yearStart.getDay() + 6) % 7)) / 7);
}

/**
 * Visszaadja a dátum ISO évét.
 * Az ISO év a hét csütörtökjének naptári éve — ez különbözhet a getFullYear()-tól
 * évváltás közelében (pl. dec 31 és jan 1 ugyanabban az ISO hétben lehetnek).
 * @param {Date} date
 * @returns {number}
 */
function _getISOYear_(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // Csütörtökra igazítjuk (ISO hét csütörtök alapján van definiálva)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  return d.getFullYear();
}

/**
 * Igaz, ha a két dátum ugyanabban az ISO évben és hétben van.
 * ISO évet használ (nem naptári évet) — helyesen kezeli az évhatárt.
 * Pl. 2026-12-31 és 2027-01-01 azonos ISO héten lehet: _getISOYear_ mindkettőnél 2026.
 * @param {Date} a
 * @param {Date} b
 * @returns {boolean}
 */
function _isSameISOWeek_(a, b) {
  return _getISOYear_(a) === _getISOYear_(b) &&
         _getISOWeek_(a)  === _getISOWeek_(b);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG DÁTUM READ/WRITE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kiolvas egy dátum értéket a CONFIG fülről.
 * @param {string} key  - pl. 'LAST_DIGEST_DATE'
 * @returns {Date|null}
 */
function _readConfigDate_(key) {
  try {
    const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.TABS.CONFIG);
    const data  = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === key) {
        const val = data[i][1];
        if (!val) return null;
        const d = new Date(val);
        return isNaN(d) ? null : d;
      }
    }
  } catch (e) {
    console.warn('_readConfigDate_(' + key + ') hiba: ' + e.message);
  }
  return null;
}

/**
 * Beírja vagy frissíti a dátum értéket a CONFIG fülön.
 * Ha a kulcs már létezik → frissíti. Ha nem → új sort fűz hozzá.
 * @param {string} key
 * @param {Date}   date
 */
function _writeConfigDate_(key, date) {
  try {
    const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.TABS.CONFIG);
    const data  = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === key) {
        sheet.getRange(i + 1, 2).setValue(formatDate(date));
        // Státusz oszlopot (C) NEM írjuk felül — LAST_DIGEST_DATE és LAST_BATCH_DATE
        // nem ELLENŐRZENDŐ/VERIFIED típusú sorok, a dropdown validáció "AUTO"-t nem fogad el.
        return;
      }
    }
    // Kulcs nem létezik → új sor (státusz oszlop üresen marad)
    sheet.appendRow([key, formatDate(date)]);
  } catch (e) {
    console.warn('_writeConfigDate_(' + key + ') hiba: ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JÓVÁHAGYVA SZÁMLÁK BETÖLTÉSE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kiolvassa a BEJÖVŐ_SZÁMLÁK fülről a JÓVÁHAGYVA státuszú sorokat.
 * @returns {Array<{szamlaId, szallitoNev, adoszam, szamlaszam, osszeg, deviza,
 *                  fizhatarido, bankszamla, rowIndex}>}
 */
function _loadPendingInvoices_() {
  const ss      = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const bejovo  = ss.getSheetByName(CONFIG.TABS.BEJOVO_SZAMLAK);
  const partner = ss.getSheetByName(CONFIG.TABS.PARTNEREK);
  const c       = CONFIG.COLS.BEJOVO;

  // Snapshot olvasás LockService-szel: BEJÖVŐ és PARTNEREK konzisztensen kerül olvasásra.
  // Megakadályozza, hogy egy párhuzamos OCR writeInvoiceToSheet() a két getValues() között írjon.
  let data, bankMap;
  const lock = acquireLock();
  try {
    const lastRow = bejovo.getLastRow();
    if (lastRow < 2) return [];
    data    = bejovo.getRange(2, 1, lastRow - 1, c.GMAIL_MESSAGE_ID).getValues();
    bankMap = _buildBankMap_(partner);
  } finally {
    lock.releaseLock();
  }

  const pending = [];
  data.forEach(function(row, idx) {
    if (String(row[c.STATUSZ  - 1] || '').trim() !== 'JÓVÁHAGYVA') return;
    // KOZ-02 GUARDRAIL: Ha már van KOTEG_ID, ne kerüljön újra kötegbe.
    // Hibás batch utáni manuális újrafeldolgozás lépései:
    //   1. Töröld a V (KOTEG_ID) oszlop értékét az érintett sorban (autobot@ jogosultság kell)
    //   2. Állítsd a Q (STATUSZ) oszlopot visszautasítva → JÓVÁHAGYVA-ra
    //   3. A következő szerdai digest automatikusan felveszi a számlát
    if (String(row[c.KOTEG_ID - 1] || '').trim() !== '')            return;
    const adoszam    = String(row[c.ADOSZAM - 1] || '').trim();
    // KOZ-05: bankMap kulcsok csak számjegyeket tartalmaznak (_buildBankMap_ normalizálja).
    // A BEJÖVŐ_SZÁMLÁK adószám mezőjében kötőjelek lehetnek (pl. "11111111-1-11") →
    // ugyanúgy normalizálni kell a lookup előtt, különben a keresés mindig üres találatot ad.
    const adoszamKey = adoszam.replace(/[^0-9]/g, '');

    // Fizetési határidő: a Sheet Date cella String()-gel csúnya formátumot ad.
    // formatDate() YYYY-MM-DD stringet ad — ezt használjuk.
    const fizHatarido = row[c.FIZHATARIDO - 1];
    const fizHataridoStr = fizHatarido
      ? formatDate(new Date(fizHatarido))
      : '';

    pending.push({
      szamlaId:    String(row[c.SZAMLA_ID     - 1] || ''),
      szallitoNev: String(row[c.SZALLITO_NEV  - 1] || ''),
      adoszam:     adoszam,
      szamlaszam:  String(row[c.SZAMLASZAM    - 1] || ''),
      osszeg:      Number(row[c.OSSZEG_BRUTTO - 1] || 0),
      deviza:      String(row[c.DEVIZA         - 1] || 'HUF'),
      fizhatarido: fizHataridoStr,
      bankszamla:  bankMap[adoszamKey] || '',
      rowIndex:    idx + 2,
    });
  });
  return pending;
}

// ─────────────────────────────────────────────────────────────────────────────
// BEÉRKEZETT SZÁMLÁK BETÖLTÉSE (OPS + Finance digest)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BEJÖVŐ_SZÁMLÁK fülről olvassa a BEÉRKEZETT + adott kategóriájú sorokat.
 * OPS digest: CONFIG.KATEGORIAK.PROJEKT
 * Finance digest: CONFIG.KATEGORIAK.ALLANDO
 *
 * @param {string} kategoria  - CONFIG.KATEGORIAK.PROJEKT | .ALLANDO | .MEGOSZTOTT
 * @returns {Array<{szamlaId, szallitoNev, osszeg, deviza, fizhatarido, rowIndex}>}
 */
function _loadBeerkzetRows_(kategoria) {
  const ss     = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const bejovo = ss.getSheetByName(CONFIG.TABS.BEJOVO_SZAMLAK);
  const c      = CONFIG.COLS.BEJOVO;

  let data;
  const lock = acquireLock();
  try {
    const lastRow = bejovo.getLastRow();
    if (lastRow < 2) return [];
    data = bejovo.getRange(2, 1, lastRow - 1, c.GMAIL_MESSAGE_ID).getValues();
  } finally {
    lock.releaseLock();
  }

  const result = [];
  data.forEach(function(row, idx) {
    if (String(row[c.STATUSZ   - 1] || '').trim() !== 'BEÉRKEZETT') return;
    if (String(row[c.KATEGORIA - 1] || '').trim() !== kategoria)     return;
    const fizHatarido = row[c.FIZHATARIDO - 1];
    result.push({
      szamlaId:    String(row[c.SZAMLA_ID    - 1] || ''),
      szallitoNev: String(row[c.SZALLITO_NEV - 1] || ''),
      osszeg:      Number(row[c.OSSZEG_BRUTTO- 1] || 0),
      deviza:      String(row[c.DEVIZA        - 1] || 'HUF'),
      fizhatarido: fizHatarido ? formatDate(new Date(fizHatarido)) : '',
      kategoria:   kategoria,
      rowIndex:    idx + 2,
    });
  });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// HIÁNYOS_PO SZÁMLÁK BETÖLTÉSE TÉTEL-SZINTŰ BONTÁSSAL (OPS digest)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BEJÖVŐ_SZÁMLÁK fülről olvassa a HIÁNYOS_PO státuszú sorokat,
 * és hozzájuk olvassa a SZÁMLA_TÉTELEK sorokat (PO | Conf | Reasoning).
 * Az OPS digest tétel-szintű bontáshoz szükséges (spec §4.2 + Technikai Terv §31).
 *
 * @returns {Array<{szamlaId, szallitoNev, osszeg, deviza, fizhatarido, poSummary,
 *                  tetelek: [{tetelSzam, leiras, po, poConfidence, poReasoning, poValidalt}]}>}
 */
function _loadHianyosPORowsWithTetelek_() {
  const ss          = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const bejovo      = ss.getSheetByName(CONFIG.TABS.BEJOVO_SZAMLAK);
  const tetelSheet  = ss.getSheetByName(CONFIG.TABS.SZAMLA_TETELEK);
  const c           = CONFIG.COLS.BEJOVO;
  const ct          = CONFIG.COLS.TETEL;

  let bejData, tetelData;
  const lock = acquireLock();
  try {
    const lastBej = bejovo.getLastRow();
    if (lastBej < 2) return [];
    bejData = bejovo.getRange(2, 1, lastBej - 1, c.GMAIL_MESSAGE_ID).getValues();

    const lastTetel = tetelSheet ? tetelSheet.getLastRow() : 1;
    tetelData = (tetelSheet && lastTetel > 1)
      ? tetelSheet.getRange(2, 1, lastTetel - 1, ct.PO_VALIDALT).getValues()
      : [];
  } finally {
    lock.releaseLock();
  }

  // SZÁMLA_TÉTELEK indexelése számla ID szerint
  const tetelMap = {};
  tetelData.forEach(function(row) {
    const szId = String(row[ct.SZAMLA_ID - 1] || '').trim();
    if (!szId) return;
    if (!tetelMap[szId]) tetelMap[szId] = [];
    tetelMap[szId].push({
      tetelSzam:    row[ct.TETEL_SZAM    - 1],
      leiras:       String(row[ct.LEIRAS      - 1] || ''),
      po:           String(row[ct.PO          - 1] || '–'),
      poConfidence: row[ct.PO_CONFIDENCE  - 1],
      poReasoning:  String(row[ct.PO_REASONING - 1] || ''),
      poValidalt:   String(row[ct.PO_VALIDALT  - 1] || ''),
    });
  });

  const result = [];
  bejData.forEach(function(row, idx) {
    if (String(row[c.STATUSZ - 1] || '').trim() !== 'HIÁNYOS_PO') return;
    const szamlaId    = String(row[c.SZAMLA_ID   - 1] || '');
    const fizHatarido = row[c.FIZHATARIDO - 1];
    result.push({
      szamlaId:    szamlaId,
      szallitoNev: String(row[c.SZALLITO_NEV  - 1] || ''),
      osszeg:      Number(row[c.OSSZEG_BRUTTO - 1] || 0),
      deviza:      String(row[c.DEVIZA         - 1] || 'HUF'),
      fizhatarido: fizHatarido ? formatDate(new Date(fizHatarido)) : '',
      poSummary:   String(row[c.PO_SUMMARY    - 1] || ''),
      tetelek:     tetelMap[szamlaId] || [],
      rowIndex:    idx + 2,
    });
  });
  return result;
}

/**
 * Adószám → bankszámlaszám keresőtábla a PARTNEREK fülről.
 * @param {Sheet} partnerSheet
 * @returns {Object}
 */
function _buildBankMap_(partnerSheet) {
  const lastRow = partnerSheet.getLastRow();
  if (lastRow < 2) return {};
  const cp   = CONFIG.COLS.PARTNER;
  const data = partnerSheet.getRange(2, 1, lastRow - 1, cp.BANKSZAMLA).getValues();
  const result = {};
  data.forEach(function(row) {
    // KOZ-04: csak számjegyek — konzisztens a GeminiOCR _getPartnerKategoria_() normalizálásával
    const adoszam    = String(row[cp.ADOSZAM    - 1] || '').trim().replace(/[^0-9]/g, '');
    const bankszamla = String(row[cp.BANKSZAMLA - 1] || '').trim();
    if (adoszam && bankszamla) result[adoszam] = bankszamla;
  });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// MANUÁLIS FUTTATÓK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Azonnal futtatja a digest küldést — minden ellenőrzés kihagyva.
 * Futtatás: Script Editor → runDigestNow → ▶ Run
 */
function runDigestNow() {
  if (!CONFIG.TEST_MODE) {
    throw new Error('runDigestNow() csak TEST_MODE=true esetén futtatható! ' +
      'Éles adatbázison való véletlen futás megelőzéséért.');
  }
  console.log('Digest manuális futtatás (ellenőrzések kihagyva)...');
  const today      = new Date();
  const utalasDate = getNextWorkday(today, 1);
  console.log('Utalási nap: ' + formatDate(utalasDate));

  // OPS digest
  const projektRows = _loadBeerkzetRows_(CONFIG.KATEGORIAK.PROJEKT);
  const hianyosRows = _loadHianyosPORowsWithTetelek_();
  console.log('BEÉRKEZETT PROJEKT: ' + projektRows.length + ', HIÁNYOS_PO: ' + hianyosRows.length);
  notifyOpsDigest(projektRows, hianyosRows, utalasDate);

  // Finance digest
  const allandoRows = _loadBeerkzetRows_(CONFIG.KATEGORIAK.ALLANDO);
  const pendingRows = _loadPendingInvoices_();
  console.log('BEÉRKEZETT ÁLLANDÓ: ' + allandoRows.length + ', JÓVÁHAGYVA: ' + pendingRows.length);
  notifyWednesdayDigest(pendingRows, utalasDate, allandoRows);

  _writeConfigDate_('LAST_DIGEST_DATE', today);
  console.log('✅ Digest elküldve (manuális).');
}

/**
 * Azonnal generálja a batch-et — csak TEST_MODE-ban.
 * Futtatás: Script Editor → runBatchNow → ▶ Run
 */
function runBatchNow() {
  if (!CONFIG.TEST_MODE) {
    throw new Error('runBatchNow() csak TEST_MODE=true esetén futtatható!');
  }
  console.log('Batch manuális futtatás (TEST_MODE)...');
  const today       = new Date();
  const pendingRows = _loadPendingInvoices_();
  const utalasDate  = getNextWorkday(today, 1);
  if (pendingRows.length === 0) {
    console.log('Nincs JÓVÁHAGYVA számla.');
    return;
  }
  const result = generateAndSaveBatch(pendingRows, utalasDate);
  if (result) {
    _writeConfigDate_('LAST_BATCH_DATE', today);
    console.log('✅ ' + result.kotegId + ' | ' + result.osszesenHuf + ' HUF | ' + result.driveUrl);
    notifyBatchReady(result.kotegId, pendingRows.length, result.osszesenHuf,
      result.driveUrl, formatDate(utalasDate));
  }
}

/**
 * Listázza a pending számlákat és hiányzó bankszámlaszámokat.
 * Futtatás: Script Editor → listPendingInvoices → ▶ Run
 */
function listPendingInvoices() {
  const rows = _loadPendingInvoices_();
  if (rows.length === 0) { console.log('Nincs JÓVÁHAGYVA számla.'); return; }
  console.log('JÓVÁHAGYVA számlák (' + rows.length + ' db):');
  rows.forEach(function(r) {
    console.log('  [' + r.szamlaId + '] ' + r.szallitoNev +
      ' | ' + r.osszeg + ' ' + r.deviza +
      ' | határidő: ' + (r.fizhatarido || '–') +
      ' | bankszámla: ' + (r.bankszamla || '⚠️ HIÁNYZIK'));
  });
  const missing = rows.filter(function(r) { return !r.bankszamla; });
  if (missing.length > 0) {
    console.log('\n⚠️  ' + missing.length + ' partner bankszámlaszáma HIÁNYZIK:');
    missing.forEach(function(r) {
      console.log('   → ' + r.szallitoNev + ' (' + r.adoszam + ')');
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// +3 NAPOS ELLENŐRZŐ TRIGGER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Naponta fut (Triggers.gs állítja be — wednesdayMorningDigest-tel azonos time trigger).
 * Megkeresi a JÓVÁHAGYVA státuszú, KOTEG_ID-vel rendelkező számlákat, ahol az utalás
 * dátuma (KÖTEGEK fülön) több mint 3 napja lejárt, de a státusz még nem UTALVA.
 *
 * Ha talál ilyent → Chat figyelmeztetés Finance webhook-ra (Péternek).
 *
 * Logika:
 *   "kötegelt" = JÓVÁHAGYVA státuszú + KOTEG_ID nem üres
 *   "késedelmes" = a KOTEG_ID-hez tartozó KÖTEGEK sor utalás dátuma > 3 napja múlt el
 *   "nem teljesített" = a Q oszlop még nem UTALVA
 *
 * NE nevezd át — Triggers.gs erre a névre hivatkozik.
 */
function checkOverdueKotegek() {
  const today   = new Date();
  today.setHours(0, 0, 0, 0);
  const limit3  = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 nappal ezelőtt

  console.log('checkOverdueKotegek: ' + formatDate(today));

  try {
    const ss       = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const bejovo   = ss.getSheetByName(CONFIG.TABS.BEJOVO_SZAMLAK);
    const kotegek  = ss.getSheetByName(CONFIG.TABS.KOTEGEK);
    const c        = CONFIG.COLS.BEJOVO;

    if (!bejovo || !kotegek) {
      console.warn('checkOverdueKotegek: BEJÖVŐ_SZÁMLÁK vagy KÖTEGEK fül nem található.');
      return;
    }

    // KÖTEGEK fülből utalás dátum keresőtábla: kotegId → utalas dátum
    // KÖTEGEK oszlopok: A=KötegID, B=GenerálásDátum, C=UtalásDátum, D=Összeg, E=DriveURL
    const kotegData   = kotegek.getLastRow() > 1
      ? kotegek.getRange(2, 1, kotegek.getLastRow() - 1, 3).getValues()
      : [];
    const utalasMap = {};
    kotegData.forEach(function(row) {
      const kid  = String(row[0] || '').trim();
      const udat = row[2]; // C oszlop — utalás dátuma
      if (kid && udat) utalasMap[kid] = new Date(udat);
    });

    // BEJÖVŐ_SZÁMLÁK végigpásztázás
    const lastRow = bejovo.getLastRow();
    if (lastRow < 2) return;
    const data = bejovo.getRange(2, 1, lastRow - 1, c.GMAIL_MESSAGE_ID).getValues();

    const overdue = [];
    data.forEach(function(row) {
      const statusz  = String(row[c.STATUSZ  - 1] || '').trim();
      const kotegId  = String(row[c.KOTEG_ID - 1] || '').trim();

      // Csak JÓVÁHAGYVA + KOTEG_ID megvan + még nem UTALVA
      if (statusz !== 'JÓVÁHAGYVA' || !kotegId) return;

      // Utalás dátuma ellenőrzés
      const utalasDate = utalasMap[kotegId];
      if (!utalasDate) return; // KÖTEGEK fülön nincs bejegyzés — kihagyja

      const utalasNorm = new Date(utalasDate);
      utalasNorm.setHours(0, 0, 0, 0);
      if (utalasNorm > limit3) return; // nem késedelmes még

      overdue.push({
        szamlaId:    String(row[c.SZAMLA_ID    - 1] || ''),
        szallitoNev: String(row[c.SZALLITO_NEV - 1] || ''),
        osszeg:      Number(row[c.OSSZEG_BRUTTO- 1] || 0),
        deviza:      String(row[c.DEVIZA        - 1] || 'HUF'),
        kotegId:     kotegId,
        utalasDate:  formatDate(utalasNorm),
        napjaKesik:  Math.floor((today - utalasNorm) / (24 * 60 * 60 * 1000)),
      });
    });

    if (overdue.length === 0) {
      console.log('Nincs késedelmes utalás.');
      return;
    }

    console.log('⚠️  ' + overdue.length + ' késedelmes utalás találva.');

    // Chat figyelmeztetés — Finance webhook (Péter)
    const prefix = CONFIG.TEST_MODE ? '[TEST] ' : '';
    const lines  = overdue.map(function(r) {
      return '  • ' + r.szallitoNev +
             ' — ' + r.osszeg.toLocaleString() + ' ' + r.deviza +
             ' | Köteg: `' + r.kotegId + '`' +
             ' | Utalás: ' + r.utalasDate +
             ' | *' + r.napjaKesik + ' napja késedelmes*';
    }).join('\n');

    const text = '⚠️ *' + prefix + 'Késedelmes utalás — azonnali intézkedés szükséges*\n' +
                 overdue.length + ' számla nem lett UTALVA a tervezett napon:\n\n' +
                 lines + '\n\n' +
                 '*Teendő:* MagNet → ellenőrizd az utalást, majd a sheet Q oszlopát → UTALVA';

    _sendToWebhook_(CONFIG.CHAT_WEBHOOK_FINANCE, text);
    console.log('✅ Figyelmeztetés elküldve (' + overdue.length + ' tétel).');

  } catch (e) {
    console.error('checkOverdueKotegek hiba: ' + e.message);
    notifyAdmin('checkOverdueKotegek hiba', e.message, e);
  }
}

/**
 * Direkt teszt: checkOverdueKotegek() manuális futtatása — TEST_MODE-ban.
 * A teszt egy JÓVÁHAGYVA + KOTEG_ID sorhoz kell, ahol a KÖTEGEK fülön az utalás dátuma
 * 4+ napja múlt el. Legegyszerűbb: a runBatchNow() után a KÖTEGEK sor utalás dátumát
 * kézzel módosítani 4 nappal korábbra, majd ezt futtatni.
 * Futtatás: Script Editor → testCheckOverdue → ▶ Run
 */
function testCheckOverdue() {
  if (!CONFIG.TEST_MODE) throw new Error('testCheckOverdue() csak TEST_MODE=true esetén!');
  console.log('checkOverdueKotegek() manuális futtatás...');
  checkOverdueKotegek();
}

// ─────────────────────────────────────────────────────────────────────────────
// DIGEST NAP LOGIKA TESZT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Digest nap logika tesztelése különböző dátumokra — sheet hozzáférés nélkül.
 * Futtatás: Script Editor → testDigestDayLogic → ▶ Run
 */
function testDigestDayLogic() {
  console.log('══════════════════════════════════════');
  console.log('Digest nap logika tesztek');
  console.log('══════════════════════════════════════');

  const cases = [
    { date: new Date(2026, 3, 13), label: 'Hétfő' },    // hétfő → nem digest nap
    { date: new Date(2026, 3, 14), label: 'Kedd'  },    // kedd → nem digest nap
    { date: new Date(2026, 3, 15), label: 'Szerda'},    // szerda → digest nap (ha munkanap)
    { date: new Date(2026, 3, 16), label: 'Csüt'  },    // csüt → csak ha szerda ünnep
    { date: new Date(2026, 3, 17), label: 'Péntek'},    // péntek → csak ha szer+csüt ünnep
  ];

  cases.forEach(function(c) {
    const digestDay = _getThisWeeksDigestDay_(c.date);
    const isToday   = digestDay ? formatDate(c.date) === formatDate(digestDay) : false;
    console.log(c.label + ' (' + formatDate(c.date) + '): digest nap = ' +
      (digestDay ? formatDate(digestDay) : 'NINCS') +
      ' | ma digest nap? ' + (isToday ? 'IGEN ✓' : 'nem'));
  });

  console.log('──────────────────────────────────────');
  console.log('ISO hét tesztek:');
  const d1 = new Date(2026, 3, 13); // hétfő
  const d2 = new Date(2026, 3, 17); // péntek — ugyanaz a hét
  const d3 = new Date(2026, 3, 20); // következő hétfő
  console.log('Hétfő 04-13 hét: ' + _getISOWeek_(d1));
  console.log('Péntek 04-17 hét: ' + _getISOWeek_(d2) +
    (_isSameISOWeek_(d1, d2) ? ' ✓ (ugyanaz)' : ' ✗ HIBA'));
  console.log('Hétfő 04-20 hét: ' + _getISOWeek_(d3) +
    (!_isSameISOWeek_(d1, d3) ? ' ✓ (különböző)' : ' ✗ HIBA'));
}
