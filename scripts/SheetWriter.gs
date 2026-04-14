/**
 * SheetWriter.gs
 * Armadillo Pénzügyi Automatizáció — Atomikus SSOT írás
 *
 * Felelőssége: LockService tranzakcióban írja a BEJÖVŐ_SZÁMLÁK és SZÁMLA_TÉTELEK
 * fülöket. Ha a lock nem szerezhető meg 10 másodpercen belül → LOCK_TIMEOUT hiba.
 *
 * Publikus függvények (GeminiOCR.gs hívja):
 *   writeInvoiceToSheet(extracted, metadata, poAgg, statusz, kategoria)
 *   writeInvoiceError(metadata, statuszKod, errorMessage)
 */

// ─────────────────────────────────────────────────────────────────────────────
// FŐ BELÉPÉSI PONT — SIKERES FELDOLGOZÁS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atomikusan írja a számlát és tételeit az SSOT sheet-be.
 * LockService védi — párhuzamos triggerek nem írhatnak egyszerre.
 *
 * @param {Object} extracted  - Gemini által kinyert adatok
 * @param {Object} metadata   - { gmailMessageId, driveFileId, driveUrl, date, ... }
 * @param {{ poSummary, poConfidence, poReasoning }} poAgg
 * @param {string} statusz    - 'BEÉRKEZETT' | 'HIÁNYOS_PO'
 * @param {string} kategoria  - Partner kategória (ÁLLANDÓ/PROJEKT/MEGOSZTOTT/null)
 * @returns {string} szamlaId — a GeminiOCR.gs-nek kell a notifyNewInvoice() híváshoz
 */
function writeInvoiceToSheet(extracted, metadata, poAgg, statusz, kategoria) {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const lock  = acquireLock();
  let szamlaId;

  try {
    szamlaId = generateId('INV');

    // ── 1. BEJÖVŐ_SZÁMLÁK sor
    _writeBejovoszamlaRow_(ss, szamlaId, extracted, metadata, poAgg, statusz, kategoria);

    // ── 2. SZÁMLA_TÉTELEK sorok (minden tételhez 1 sor)
    _writeSzamlaTetelek_(ss, szamlaId, extracted.tetelek, kategoria);

    console.log('SheetWriter: ' + szamlaId + ' sikeresen írva (' +
      extracted.tetelek.length + ' tétel)');

  } finally {
    lock.releaseLock();
  }

  // Audit a lockon KÍVÜL — nem kell szeriális az üzleti írással
  logAuditScript_('INVOICE_RECEIVED', szamlaId, 'BEJÖVŐ_SZÁMLÁK', '', statusz);

  return szamlaId;
}

// ─────────────────────────────────────────────────────────────────────────────
// FŐ BELÉPÉSI PONT — HIBÁS FELDOLGOZÁS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AI_HIBA vagy LOCK_TIMEOUT esetén minimális sort ír a BEJÖVŐ_SZÁMLÁK-ba.
 * Lehetővé teszi a manuális javítást és az újrafeldolgozást.
 * LockService védi — konzisztens a writeInvoiceToSheet()-tel, sorrendek nem borulnak fel.
 *
 * @param {Object} metadata      - { gmailMessageId, driveFileId, driveUrl, date, from, subject }
 * @param {string} statuszKod    - 'AI_HIBA' | 'LOCK_TIMEOUT'
 * @param {string} errorMessage
 */
function writeInvoiceError(metadata, statuszKod, errorMessage) {
  let szamlaId;
  try {
    const ss   = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const lock = acquireLock();
    try {
      const sheet = ss.getSheetByName(CONFIG.TABS.BEJOVO_SZAMLAK);
      szamlaId    = generateId('ERR');
      const row   = _buildErrorRow_(szamlaId, metadata, statuszKod, errorMessage);
      sheet.appendRow(row);
      console.log('SheetWriter (hiba): ' + szamlaId + ' → ' + statuszKod);
    } finally {
      lock.releaseLock();
    }

    // Audit a lockon KÍVÜL — nem kell szeriális az üzleti írással
    logAuditScript_('INVOICE_ERROR', szamlaId, 'BEJÖVŐ_SZÁMLÁK', '',
      statuszKod + ' | ' + (errorMessage || '').substring(0, 200));

  } catch (e) {
    // Ha ez is hibázik, már csak logolni tudunk
    console.error('writeInvoiceError sikertelen: ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BEJÖVŐ_SZÁMLÁK SOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Összeállítja és appendRow-val írja a BEJÖVŐ_SZÁMLÁK sort.
 * @param {Spreadsheet} ss
 * @param {string}      szamlaId
 * @param {Object}      extracted
 * @param {Object}      metadata
 * @param {Object}      poAgg
 * @param {string}      statusz
 * @param {string}      kategoria
 */
function _writeBejovoszamlaRow_(ss, szamlaId, extracted, metadata, poAgg, statusz, kategoria) {
  const sheet = ss.getSheetByName(CONFIG.TABS.BEJOVO_SZAMLAK);
  const c     = CONFIG.COLS.BEJOVO;

  // 23 oszlopos sor — indexek: c.SZAMLA_ID=1 ... c.GMAIL_MESSAGE_ID=23
  const row = new Array(c.GMAIL_MESSAGE_ID).fill('');

  row[c.SZAMLA_ID          - 1] = szamlaId;
  row[c.SZALLITO_NEV       - 1] = extracted.szallito_nev   || '';
  row[c.ADOSZAM            - 1] = extracted.szallito_adoszam|| '';
  row[c.SZAMLASZAM         - 1] = extracted.szamlaszam      || '';
  row[c.KELT               - 1] = extracted.kelt            || '';
  row[c.OSSZEG_NETTO       - 1] = extracted.osszeg_netto    || 0;
  row[c.TELJESITES         - 1] = extracted.teljesites_datum|| extracted.kelt || '';
  row[c.FIZHATARIDO        - 1] = extracted.fizhatarido     || '';
  row[c.OSSZEG_BRUTTO      - 1] = extracted.osszeg_brutto   || 0;
  row[c.DEVIZA             - 1] = extracted.deviza          || 'HUF';
  row[c.KATEGORIA          - 1] = kategoria                 || '';
  row[c.DRIVE_URL          - 1] = metadata.driveUrl         || '';
  row[c.DRIVE_FILE_ID      - 1] = metadata.driveFileId      || '';
  row[c.PO_SUMMARY         - 1] = poAgg.poSummary           || '';
  row[c.PO_CONFIDENCE      - 1] = poAgg.poConfidence        || 0;
  row[c.PO_REASONING       - 1] = poAgg.poReasoning         || '';
  row[c.STATUSZ            - 1] = statusz;
  // R-V: jóváhagyás, visszautasítás, utalás — üres (workflow tölti ki)
  row[c.GMAIL_MESSAGE_ID   - 1] = metadata.gmailMessageId   || '';

  sheet.appendRow(row);
}

/**
 * Összeállítja a hibasor tömbjét.
 */
function _buildErrorRow_(szamlaId, metadata, statuszKod, errorMessage) {
  const c   = CONFIG.COLS.BEJOVO;
  const row = new Array(c.GMAIL_MESSAGE_ID).fill('');

  row[c.SZAMLA_ID        - 1] = szamlaId;
  row[c.SZALLITO_NEV     - 1] = '(feldolgozás sikertelen)';
  row[c.DRIVE_URL        - 1] = metadata.driveUrl    || '';
  row[c.DRIVE_FILE_ID    - 1] = metadata.driveFileId || '';
  row[c.PO_REASONING     - 1] = errorMessage.substring(0, 500);
  row[c.STATUSZ          - 1] = statuszKod;
  row[c.GMAIL_MESSAGE_ID - 1] = metadata.gmailMessageId || '';

  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// SZÁMLA_TÉTELEK SOROK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minden tételhez 1 sort appendRow-val ír a SZÁMLA_TÉTELEK fülre.
 * PO_VALIDÁLT (M) kiszámítása itt történik — Validation.gs-sel konzisztensen.
 *
 * @param {Spreadsheet} ss
 * @param {string}      szamlaId
 * @param {Object[]}    tetelek
 * @param {string}      kategoria
 */
function _writeSzamlaTetelek_(ss, szamlaId, tetelek, kategoria) {
  const sheet = ss.getSheetByName(CONFIG.TABS.SZAMLA_TETELEK);
  const c     = CONFIG.COLS.TETEL;

  // Érvényes projektek cache — ne olvassuk újra tételenként (Utils.gs megosztott cache)
  const validProjects = loadValidProjects();

  tetelek.forEach(function(tetel, idx) {
    const poValidalt = _computePoValidalt_(tetel, kategoria, validProjects);

    const row = new Array(c.PO_VALIDALT).fill('');

    row[c.SZAMLA_ID      - 1] = szamlaId;
    row[c.TETEL_SZAM     - 1] = idx + 1;
    row[c.LEIRAS         - 1] = tetel.leiras       || '';
    row[c.MENNYISEG      - 1] = tetel.mennyiseg     || 1;
    row[c.EGYSEGAR       - 1] = tetel.egysegar       || 0;
    row[c.NETTO          - 1] = tetel.netto          || 0;
    row[c.AFA_SZAZALEK   - 1] = tetel.afa_szazalek   !== undefined ? tetel.afa_szazalek : 27;
    row[c.AFA_OSSZEG     - 1] = tetel.afa_osszeg     || 0;
    row[c.BRUTTO         - 1] = tetel.brutto         || 0;
    row[c.PO             - 1] = tetel.po             || '';
    row[c.PO_CONFIDENCE  - 1] = tetel.po_confidence  || 0;
    row[c.PO_REASONING   - 1] = tetel.po_reasoning   || '';
    row[c.PO_VALIDALT    - 1] = poValidalt;

    sheet.appendRow(row);
  });
}

/**
 * PO_VALIDÁLT kiszámítása egy tételhez.
 * Konzisztens a Validation.gs _validateTetelRow_() logikájával.
 *
 * @param {Object}   tetel
 * @param {string}   kategoria
 * @param {string[]} validProjects
 * @returns {'IGEN'|'NEM'|'N/A'}
 */
function _computePoValidalt_(tetel, kategoria, validProjects) {
  // KOZ-01: ÁLLANDÓ és MEGOSZTOTT — PO nem kötelező, tételek M oszlopa N/A
  // Konzisztens a _aggregatePO_() (GeminiOCR.gs) és _decideStatusz_() N/A bypass logikájával.
  if (kategoria === CONFIG.KATEGORIAK.ALLANDO ||
      kategoria === CONFIG.KATEGORIAK.MEGOSZTOTT) return 'N/A';

  const po   = tetel.po ? String(tetel.po).trim() : '';
  const conf = Number(tetel.po_confidence) || 0;

  if (!po)                                   return 'NEM'; // nincs PO
  if (conf < CONFIG.PO_CONFIDENCE_THRESHOLD) return 'NEM'; // alacsony konfidencia
  if (validProjects.indexOf(po) === -1)      return 'NEM'; // PO nem szerepel registry-ben
  return 'IGEN';
}

// _loadValidProjectsForWriter_() eltávolítva (KP-02 javítás).
// Helyette: loadValidProjects() — Utils.gs megosztott cache, DRY elvnek megfelelően.

// ─────────────────────────────────────────────────────────────────────────────
// TESZTELŐ FÜGGVÉNYEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Teszt számlát ír a staging sheet-be — valódi PDF nélkül.
 * Futtatás: Script Editor → writeTestInvoice → ▶ Run
 */
function writeTestInvoice() {
  if (!CONFIG.TEST_MODE) {
    throw new Error('writeTestInvoice() csak TEST_MODE=true esetén futtatható!');
  }

  const extracted = {
    szallito_nev:      'Teszt Szállító Kft.',
    szallito_adoszam:  '12345678-2-41',
    szamlaszam:        'TSZ-2026/042',
    kelt:              '2026-04-08',
    teljesites_datum:  '2026-04-05',
    fizhatarido:       '2026-05-08',
    osszeg_netto:      100000,
    osszeg_brutto:     127000,
    deviza:            'HUF',
    tetelek: [
      {
        leiras:        'Szoftverfejlesztési szolgáltatás',
        mennyiseg:     10,
        egysegar:      8000,
        netto:         80000,
        afa_szazalek:  27,
        afa_osszeg:    21600,
        brutto:        101600,
        po:            'TEST2601',
        po_confidence: 97,
        po_reasoning:  'A számlán explicit szerepel a TEST2601 projektszám.',
      },
      {
        leiras:        'Projekt koordináció',
        mennyiseg:     5,
        egysegar:      4000,
        netto:         20000,
        afa_szazalek:  27,
        afa_osszeg:    5400,
        brutto:        25400,
        po:            'TEST2601',
        po_confidence: 88,
        po_reasoning:  'Valószínűsíthetően ugyanahhoz a projekthez tartozik.',
      },
    ],
  };

  const metadata = {
    gmailMessageId: 'TEST_MSG_' + Date.now(),
    subject:        '[TEST] Teszt számla',
    from:           'teszt@tesztszallito.hu',
    date:           new Date(),
    driveFileId:    'FAKE_DRIVE_ID_' + Date.now(),
    driveUrl:       'https://drive.google.com/file/d/FAKE',
    fileName:       'Teszt_Szallito_Kft_20260408_TSZ-2026_042.pdf',
  };

  const kategoria = CONFIG.KATEGORIAK.PROJEKT;

  const poAgg = {
    poSummary:    'TEST2601',
    poConfidence: 88,  // MIN(97, 88)
    poReasoning:  'Valószínűsíthetően ugyanahhoz a projekthez tartozik.',
  };

  // TC: 1 tétel conf=88 < 95 → HIÁNYOS_PO
  const statusz = 'HIÁNYOS_PO';

  console.log('Teszt számla írása...');
  writeInvoiceToSheet(extracted, metadata, poAgg, statusz, kategoria);
  console.log('✅ Teszt számla sikeresen írva. Ellenőrizd:');
  console.log('   BEJÖVŐ_SZÁMLÁK: új sor N=TEST2601, O=88, Q=HIÁNYOS_PO');
  console.log('   SZÁMLA_TÉTELEK: 2 sor, M oszlop: NEM (conf 88<95), NEM (conf 88<95)');
}

/**
 * Teszt hiba-sort ír — ellenőrzi, hogy AI_HIBA szituáció helyesen kerül a sheet-be.
 * Futtatás: Script Editor → writeTestError → ▶ Run
 */
function writeTestError() {
  if (!CONFIG.TEST_MODE) {
    throw new Error('writeTestError() csak TEST_MODE=true esetén futtatható!');
  }

  const metadata = {
    gmailMessageId: 'TEST_ERR_' + Date.now(),
    driveFileId:    'FAKE_ERR_' + Date.now(),
    driveUrl:       'https://drive.google.com/file/d/FAKE_ERR',
    date:           new Date(),
    from:           'ismeretlen@pelda.hu',
    subject:        '[TEST] Hibás feldolgozás teszt',
  };

  console.log('Teszt hiba-sor írása...');
  writeInvoiceError(metadata, 'AI_HIBA', 'Szimulált Gemini API hiba: timeout after 90s');
  console.log('✅ Hiba-sor írva. Ellenőrizd: BEJÖVŐ_SZÁMLÁK Q=AI_HIBA');
}
