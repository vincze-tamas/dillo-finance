/**
 * AuditLog.gs
 * Armadillo Pénzügyi Automatizáció — Event-driven audit ledger
 *
 * Architektúra:
 *   _writeAuditRow_()   — 1 core: atomikus sor írás az AUDIT_LOG fülre
 *   logAudit_()         — wrapper #1: user szerkesztés (onEditInstallable hívja, e event alapján)
 *   logAuditScript_()   — wrapper #2: script esemény (BatchGenerator, SheetWriter, GeminiOCR hívja)
 *
 * Minden állapotváltozás → audit event. Nem csak user editek.
 *
 * User edit action típusok (logAudit_):
 *   STATUSZ_VALTOZAS          — BEJÖVŐ_SZÁMLÁK Q oszlop (nem UTALVA)
 *   PAYMENT_CONFIRMED         — BEJÖVŐ_SZÁMLÁK Q → UTALVA
 *   PO_MODOSITAS              — SZÁMLA_TÉTELEK J vagy K oszlop
 *   PROJEKT_MODOSITAS         — PROJEKTEK A oszlop
 *   PARTNER_MODOSITAS         — PARTNEREK H oszlop
 *   CELLAMODOSITAS            — egyéb figyelt mező
 *   KOTEG_ID_OVERWRITE_ATTEMPT — KOTEG_ID felülírási kísérlet (visszaállítva)
 *
 * Script event action típusok (logAuditScript_):
 *   INVOICE_RECEIVED          — SheetWriter: számla sikeresen beírva
 *   INVOICE_ERROR             — SheetWriter: AI_HIBA / LOCK_TIMEOUT sor beírva
 *   OCR_COMPLETED             — GeminiOCR: Gemini sikeresen feldolgozta a PDF-et
 *   OCR_FAILED                — GeminiOCR: Gemini hiba
 *   BATCH_ASSIGNED            — BatchGenerator: KOTEG_ID beírva egy számlára
 *
 * SOSEM dob kivételt — audit hiba nem törhet el felhasználói vagy script műveletet.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CORE — egyetlen belépési pont az AUDIT_LOG fülre
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Egyetlen sor beírása az AUDIT_LOG fülre.
 * Minden más naplózó függvény ezt hívja.
 * openById-t használ (trigger és script kontextusból egyaránt működik).
 *
 * @param {string} user       - email vagy 'script' / 'ismeretlen'
 * @param {string} actionType - esemény típus konstans (lásd fent)
 * @param {string} rowId      - ember által olvasható sor azonosító
 * @param {string} fieldName  - oszlop neve vagy esemény forrása
 * @param {string} oldVal     - előző érték (script eventnél '' ha n/a)
 * @param {string} newVal     - új érték
 */
function _writeAuditRow_(user, actionType, rowId, fieldName, oldVal, newVal) {
  try {
    const ss       = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const logSheet = ss.getSheetByName(CONFIG.TABS.AUDIT_LOG);
    if (!logSheet) return; // setupSSOT előtt — csendesen kihagyja

    logSheet.appendRow([
      new Date(),    // A: Időbélyeg
      user,          // B: Felhasználó
      actionType,    // C: Művelet
      rowId,         // D: Sor azonosító
      fieldName,     // E: Mező
      oldVal,        // F: Előző érték
      newVal,        // G: Új érték
    ]);
  } catch (err) {
    console.error('_writeAuditRow_ hiba [' + actionType + ']: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WRAPPER #1 — User edit (onEditInstallable trigger hívja)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User szerkesztés naplózása. Csak onEditInstallable-ből hívandó.
 * Az `e` event objektumból kinyeri a szükséges adatokat.
 *
 * @param {GoogleAppsScript.Events.SheetsOnEdit} e
 * @param {string} actionType
 */
function logAudit_(e, actionType) {
  try {
    const range     = e.range;
    const sheet     = range.getSheet();
    const row       = range.getRow();
    const col       = range.getColumn();
    const fieldName = _getFieldName_(sheet, col);
    const rowId     = _getRowIdentifier_(sheet, row, e);
    const user      = Session.getActiveUser().getEmail() || 'ismeretlen';

    const oldVal = (e.oldValue !== undefined && e.oldValue !== null)
      ? String(e.oldValue) : '';
    const newVal = (e.value !== undefined && e.value !== null)
      ? String(e.value) : String(range.getValue() || '');

    _writeAuditRow_(user, actionType, rowId, fieldName, oldVal, newVal);
  } catch (err) {
    console.error('logAudit_ hiba [' + actionType + ']: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WRAPPER #2 — Script event (BatchGenerator, SheetWriter, GeminiOCR hívja)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Script által indított esemény naplózása. Nincs `e` event objektum.
 * A "user" mező az effektív script tulajdonos emailje (autobot@armadillo.hu).
 *
 * @param {string} actionType - esemény típus konstans
 * @param {string} rowId      - pl. szamlaId, kotegId, fájlnév
 * @param {string} fieldName  - pl. 'KOTEG_ID', 'Gemini OCR', 'BEJÖVŐ_SZÁMLÁK'
 * @param {string} [oldVal]   - előző érték (elhagyható, default '')
 * @param {string} [newVal]   - új érték / eredmény leírása
 */
function logAuditScript_(actionType, rowId, fieldName, oldVal, newVal) {
  try {
    const user = Session.getEffectiveUser().getEmail() || 'script';
    _writeAuditRow_(user, actionType,
      rowId    || '',
      fieldName|| '',
      oldVal   || '',
      newVal   || '');
  } catch (err) {
    console.error('logAuditScript_ hiba [' + actionType + ']: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SEGÉDFÜGGVÉNYEK (logAudit_ belsőleg hívja)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Az oszlop fejléc nevét adja vissza (1. sor értéke).
 * Ha üres: "oszlop_N" formátum.
 *
 * @param {Sheet}  sheet
 * @param {number} col
 * @returns {string}
 */
function _getFieldName_(sheet, col) {
  try {
    const header = sheet.getRange(1, col).getValue();
    return header ? String(header) : ('oszlop_' + col);
  } catch (_) {
    return 'oszlop_' + col;
  }
}

/**
 * Ember által olvasható sor azonosítót ad vissza a fül típusa alapján.
 *
 * BEJÖVŐ_SZÁMLÁK  → számla ID (A oszlop), pl. "INV-20260408-001"
 * SZÁMLA_TÉTELEK  → "INV-20260408-001 / 2. tétel"
 * PROJEKTEK       → projektszám (A oszlop), pl. "IMME2601"
 * PARTNEREK       → partner neve (A oszlop), pl. "Alpha Kft."
 * egyéb           → "sor N"
 *
 * @param {Sheet}  sheet
 * @param {number} row
 * @param {GoogleAppsScript.Events.SheetsOnEdit} e
 * @returns {string}
 */
function _getRowIdentifier_(sheet, row, e) {
  if (row === 1) return 'fejléc';

  try {
    const tabName = sheet.getName();

    if (tabName === CONFIG.TABS.BEJOVO_SZAMLAK) {
      const szamlaId = sheet.getRange(row, CONFIG.COLS.BEJOVO.SZAMLA_ID).getValue();
      return szamlaId ? String(szamlaId) : ('sor ' + row);
    }

    if (tabName === CONFIG.TABS.SZAMLA_TETELEK) {
      const ab = sheet.getRange(row, 1, 1, 2).getValues()[0];
      const szamlaId  = ab[0] ? String(ab[0]) : null;
      const tetelSzam = ab[1] ? String(ab[1]) : null;
      if (szamlaId && tetelSzam) return szamlaId + ' / ' + tetelSzam + '. tétel';
      if (szamlaId)              return szamlaId;
      return 'sor ' + row;
    }

    if (tabName === CONFIG.TABS.PROJEKTEK) {
      // Ha az A oszlopot szerkesztjük, e.value az új érték (cellában még nem látszik)
      const col = e.range.getColumn();
      if (col === 1) return String(e.value || e.oldValue || ('sor ' + row));
      const val = sheet.getRange(row, 1).getValue();
      return val ? String(val) : ('sor ' + row);
    }

    if (tabName === CONFIG.TABS.PARTNEREK) {
      const nev = sheet.getRange(row, CONFIG.COLS.PARTNER.NEV).getValue();
      return nev ? String(nev) : ('sor ' + row);
    }

  } catch (_) {
    // fallback a sorszámra
  }

  return 'sor ' + row;
}
