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

  const pendingRows = _loadPendingInvoices_();
  console.log('JÓVÁHAGYVA számlák száma: ' + pendingRows.length);

  const utalasDate = getNextWorkday(today, 1);
  console.log('Tervezett utalási nap: ' + formatDate(utalasDate));

  notifyWednesdayDigest(pendingRows, utalasDate);
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
        sheet.getRange(i + 1, 3).setValue('AUTO');
        return;
      }
    }
    // Kulcs nem létezik → új sor
    sheet.appendRow([key, formatDate(date), 'AUTO']);
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
    const adoszam = String(row[c.ADOSZAM - 1] || '').trim();
    pending.push({
      szamlaId:    String(row[c.SZAMLA_ID     - 1] || ''),
      szallitoNev: String(row[c.SZALLITO_NEV  - 1] || ''),
      adoszam:     adoszam,
      szamlaszam:  String(row[c.SZAMLASZAM    - 1] || ''),
      osszeg:      Number(row[c.OSSZEG_BRUTTO - 1] || 0),
      deviza:      String(row[c.DEVIZA         - 1] || 'HUF'),
      fizhatarido: String(row[c.FIZHATARIDO    - 1] || ''),
      bankszamla:  bankMap[adoszam] || '',
      rowIndex:    idx + 2,
    });
  });
  return pending;
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
  const today       = new Date();
  const pendingRows = _loadPendingInvoices_();
  const utalasDate  = getNextWorkday(today, 1);
  console.log('Pending sorok: ' + pendingRows.length + ' | Utalási nap: ' + formatDate(utalasDate));
  notifyWednesdayDigest(pendingRows, utalasDate);
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
