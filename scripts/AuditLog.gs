/**
 * AuditLog.gs
 * Armadillo Pénzügyi Automatizáció — Audit napló
 *
 * Minden szerkesztési eseményt naplóz az AUDIT_LOG fülre.
 * Hívja: onEditInstallable (Validation.gs) minden figyelt tab szerkesztésekor.
 *
 * Művelettípusok:
 *   STATUSZ_VALTOZAS          — BEJÖVŐ_SZÁMLÁK Q oszlop
 *   PO_MODOSITAS              — SZÁMLA_TÉTELEK J vagy K oszlop
 *   PROJEKT_MODOSITAS         — PROJEKTEK A oszlop
 *   PARTNER_MODOSITAS         — PARTNEREK H oszlop
 *   CELLAMODOSITAS            — egyéb figyelt mező
 *   KOTEG_ID_OVERWRITE_ATTEMPT — KOTEG_ID felülírási kísérlet (visszaállítva)
 *
 * SOSEM dob kivételt — audit hiba nem törhet el felhasználói szerkesztést.
 */

// ─────────────────────────────────────────────────────────────────────────────
// FŐ NAPLÓZÓ FÜGGVÉNY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Naplóbejegyzést ír az AUDIT_LOG fülre.
 *
 * @param {GoogleAppsScript.Events.SheetsOnEdit} e
 * @param {string} actionType  - Művelettípus konstans (lásd fent)
 */
function logAudit_(e, actionType) {
  try {
    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet  = ss.getSheetByName(CONFIG.TABS.AUDIT_LOG);
    if (!logSheet) return; // fül még nem létezik (pl. setupSSOT előtt)

    const range     = e.range;
    const sheet     = range.getSheet();
    const row       = range.getRow();
    const col       = range.getColumn();

    // Mező azonosító: az oszlop fejléc neve (1. sor)
    const fieldName = _getFieldName_(sheet, col);

    // Sor azonosító: ember által olvasható (számlaazonosító / projekt / partner / sorszám)
    const rowId = _getRowIdentifier_(sheet, row, e);

    // Felhasználó: az aktív munkamenet emailje
    const user = Session.getActiveUser().getEmail() || 'ismeretlen';

    // Értékek: oldValue undefined lehet ha a cella előzőleg üres volt
    const oldVal = (e.oldValue !== undefined && e.oldValue !== null)
      ? String(e.oldValue)
      : '';
    const newVal = (e.value !== undefined && e.value !== null)
      ? String(e.value)
      : String(range.getValue() || '');

    logSheet.appendRow([
      new Date(),   // A: Időbélyeg
      user,         // B: Felhasználó
      actionType,   // C: Művelet
      rowId,        // D: Sor azonosító
      fieldName,    // E: Mező
      oldVal,       // F: Előző érték
      newVal,       // G: Új érték
    ]);

  } catch (err) {
    // Audit hiba: csak konzolra logolunk, sosem dobjuk tovább
    console.error('logAudit_ hiba [' + actionType + ']: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SEGÉDFÜGGVÉNYEK
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
      // Ha az A oszlopot szerkesztjük, az e.value az új érték (még nem mentett a cellában)
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
    // Ha bármilyen hiba: fallback a sorszámra
  }

  return 'sor ' + row;
}
