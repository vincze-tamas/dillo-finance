/**
 * AuditLog.gs
 * Armadillo Pénzügyi Automatizáció — Eseményvezérelt auditnapló
 *
 * Architektúra:
 *   _writeAuditRow_()   — 1 mag: atomikus sor írás az AUDIT_LOG fülre
 *   logAudit_()         — wrapper #1: felhasználói szerkesztés (onEditInstallable hívja)
 *   logAuditScript_()   — wrapper #2: script esemény (BatchGenerator, SheetWriter, GeminiOCR hívja)
 *
 * Minden állapotváltozás → naplóbejegyzés. Nem csak felhasználói szerkesztések.
 *
 * ── AUDIT_MUVELET enum ───────────────────────────────────────────────────────
 * Felhasználói szerkesztés (logAudit_):
 *   STATUSZ_VALTOZAS                 — BEJÖVŐ_SZÁMLÁK Q oszlop (nem fizetés megerősítés)
 *   FIZETES_MEGEROSITVE              — BEJÖVŐ_SZÁMLÁK Q → UTALVA (Péter zárja le)
 *   SZAMLA_MODOSITAS                 — BEJÖVŐ_SZÁMLÁK egyéb oszlop kézzel javítva
 *   PO_MODOSITAS                     — SZÁMLA_TÉTELEK J/K oszlop
 *   TETEL_MODOSITAS                  — SZÁMLA_TÉTELEK egyéb oszlop
 *   PROJEKT_MODOSITAS                — PROJEKTEK A oszlop
 *   PARTNER_MODOSITAS                — PARTNEREK H oszlop
 *   KOTEG_MODOSITAS                  — KÖTEGEK fül bármely oszlop
 *   KIMENO_SZAMLA_MODOSITAS          — KIMENŐ_SZÁMLÁK fül bármely oszlop
 *   KONFIG_MODOSITAS                 — CONFIG fül (⚠️ pénzügyi kockázat — IT figyeli!)
 *   ALLOKACIO_MODOSITAS              — ALLOKÁCIÓK fül bármely oszlop
 *   CELLA_MODOSITAS                  — egyéb (nem kategorizált) üzleti fül
 *   KOTEG_ID_FELULIRAS_KISERLET      — KOTEG_ID felülírási kísérlet (visszaállítva)
 *   AUDITNAPLO_SZERKESZTESI_KISERLET — AUDIT_LOG fül szerkesztési kísérlet (visszaállítva)
 *
 * Script esemény (logAuditScript_):
 *   SZAMLA_BEERKEZETT   — SheetWriter: számla sikeresen beírva
 *   SZAMLA_HIBA         — SheetWriter: AI_HIBA / LOCK_TIMEOUT sor beírva
 *   OCR_KESZ            — GeminiOCR: Gemini sikeresen feldolgozta a PDF-et
 *   OCR_HIBA            — GeminiOCR: Gemini hiba
 *   KOTEG_HOZZARENDELVE — BatchGenerator: KOTEG_ID beírva egy számlára
 *
 * SOSEM dob kivételt — napló hiba nem törhet el felhasználói vagy script műveletet.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ENUM KONSTANSOK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Auditnapló Művelet enum — minden lehetséges eseménytípus.
 * Az 'Művelet' oszlopban csak ezek az értékek szerepelhetnek.
 */
const AUDIT_MUVELET = Object.freeze({
  // ── Felhasználói szerkesztések ─────────────────────────────────────────
  STATUSZ_VALTOZAS:                 'STATUSZ_VALTOZAS',
  FIZETES_MEGEROSITVE:              'FIZETES_MEGEROSITVE',
  SZAMLA_MODOSITAS:                 'SZAMLA_MODOSITAS',
  PO_MODOSITAS:                     'PO_MODOSITAS',
  TETEL_MODOSITAS:                  'TETEL_MODOSITAS',
  PROJEKT_MODOSITAS:                'PROJEKT_MODOSITAS',
  PARTNER_MODOSITAS:                'PARTNER_MODOSITAS',
  KOTEG_MODOSITAS:                  'KOTEG_MODOSITAS',
  KIMENO_SZAMLA_MODOSITAS:          'KIMENO_SZAMLA_MODOSITAS',
  KONFIG_MODOSITAS:                 'KONFIG_MODOSITAS',
  ALLOKACIO_MODOSITAS:              'ALLOKACIO_MODOSITAS',
  CELLA_MODOSITAS:                  'CELLA_MODOSITAS',
  KOTEG_ID_FELULIRAS_KISERLET:      'KOTEG_ID_FELULIRAS_KISERLET',
  AUDITNAPLO_SZERKESZTESI_KISERLET: 'AUDITNAPLO_SZERKESZTESI_KISERLET',
  // ── Script események ───────────────────────────────────────────────────
  SZAMLA_BEERKEZETT:   'SZAMLA_BEERKEZETT',
  SZAMLA_HIBA:         'SZAMLA_HIBA',
  OCR_KESZ:            'OCR_KESZ',
  OCR_HIBA:            'OCR_HIBA',
  KOTEG_HOZZARENDELVE: 'KOTEG_HOZZARENDELVE',
});

/**
 * Auditnapló Forrás enum — ki indította az eseményt.
 * A 'Forrás' oszlopban csak ezek az értékek szerepelhetnek.
 */
const AUDIT_FORRAS = Object.freeze({
  FELHASZNALO: 'FELHASZNALO',
  RENDSZER:    'RENDSZER',
});

/**
 * Auditnapló Entitás enum — melyik üzleti entitást érintette az esemény.
 * Az 'Entitás' oszlopban csak ezek az értékek szerepelhetnek.
 * Megfelel a CONFIG.TABS fül → entitás típus leképzésnek.
 */
const AUDIT_ENTITAS = Object.freeze({
  SZAMLA:        'SZAMLA',         // BEJÖVŐ_SZÁMLÁK
  SZAMLA_TETEL:  'SZAMLA_TETEL',   // SZÁMLA_TÉTELEK
  PROJEKT:       'PROJEKT',        // PROJEKTEK
  PARTNER:       'PARTNER',        // PARTNEREK
  KOTEG:         'KOTEG',          // KÖTEGEK
  KIMENO_SZAMLA: 'KIMENO_SZAMLA',  // KIMENŐ_SZÁMLÁK
  KONFIG:        'KONFIG',         // CONFIG
  ALLOKACIO:     'ALLOKACIO',      // ALLOKÁCIÓK
});

// ─────────────────────────────────────────────────────────────────────────────
// CORE — egyetlen belépési pont az AUDIT_LOG fülre
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Egyetlen sor beírása az AUDIT_LOG fülre.
 * Minden más naplózó függvény ezt hívja.
 * openById-t használ (trigger és script kontextusból egyaránt működik).
 *
 * @param {string} user      - email vagy 'rendszer' / 'ismeretlen'
 * @param {string} forras    - AUDIT_FORRAS.xxx értéke
 * @param {string} entitas   - AUDIT_ENTITAS.xxx értéke
 * @param {string} muvelet   - AUDIT_MUVELET.xxx értéke
 * @param {string} sorAzonId - ember által olvasható sor azonosító
 * @param {string} mezoNev   - oszlop neve vagy esemény forrása
 * @param {string} regiErtek - előző érték (script eventnél '' ha n/a)
 * @param {string} ujErtek   - új érték
 */
function _writeAuditRow_(user, forras, entitas, muvelet, sorAzonId, mezoNev, regiErtek, ujErtek) {
  try {
    const ss       = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const logSheet = ss.getSheetByName(CONFIG.TABS.AUDIT_LOG);
    if (!logSheet) return; // setupSSOT előtt — csendesen kihagyja

    logSheet.appendRow([
      new Date(),  // A: Időbélyeg
      user,        // B: Felhasználó
      forras,      // C: Forrás      (FELHASZNALO / RENDSZER)
      entitas,     // D: Entitás     (SZAMLA / PROJEKT / stb.)
      muvelet,     // E: Művelet     (AUDIT_MUVELET értéke)
      sorAzonId,   // F: Sor azonosító
      mezoNev,     // G: Mező
      regiErtek,   // H: Előző érték
      ujErtek,     // I: Új érték
    ]);
  } catch (err) {
    console.error('_writeAuditRow_ hiba [' + muvelet + ']: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WRAPPER #1 — Felhasználói szerkesztés (onEditInstallable trigger hívja)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Felhasználói szerkesztés naplózása. Csak onEditInstallable-ből hívandó.
 * Az `e` event objektumból kinyeri a szükséges adatokat.
 * Forrás automatikusan FELHASZNALO, entitás a fül neve alapján.
 *
 * @param {GoogleAppsScript.Events.SheetsOnEdit} e
 * @param {string} muvelet - AUDIT_MUVELET.xxx értéke
 */
function logAudit_(e, muvelet) {
  try {
    const range     = e.range;
    const sheet     = range.getSheet();
    const row       = range.getRow();
    const col       = range.getColumn();
    const mezoNev   = _getFieldName_(sheet, col);
    const sorAzonId = _getRowIdentifier_(sheet, row, e);
    const entitas   = _getEntityType_(sheet.getName());
    const user      = Session.getActiveUser().getEmail() || 'ismeretlen';

    const regiErtek = (e.oldValue !== undefined && e.oldValue !== null)
      ? String(e.oldValue) : '';
    const ujErtek = (e.value !== undefined && e.value !== null)
      ? String(e.value) : String(range.getValue() || '');

    _writeAuditRow_(user, AUDIT_FORRAS.FELHASZNALO, entitas, muvelet,
      sorAzonId, mezoNev, regiErtek, ujErtek);
  } catch (err) {
    console.error('logAudit_ hiba [' + muvelet + ']: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WRAPPER #2 — Script esemény (BatchGenerator, SheetWriter, GeminiOCR hívja)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Script által indított esemény naplózása. Nincs `e` event objektum.
 * A "Felhasználó" mező az effektív script tulajdonos emailje (autobot@armadillo.hu).
 * Forrás automatikusan RENDSZER.
 *
 * ── Miért getEffectiveUser() és NEM getActiveUser()? ──────────────────────
 * Ez a wrapper kizárólag script kontextusból hívódik (time-based triggerek,
 * pl. 15 perces Gmail figyelő, szerda 9:00 digest, szerda 14:00 batch).
 * Ezekben a kontextusokban NINCS aktív felhasználói munkamenet, ezért:
 *
 *   Session.getActiveUser().getEmail()    → ''  (üres string — nincs session)
 *   Session.getEffectiveUser().getEmail() → 'autobot@armadillo.hu'  (script tulajdonos)
 *
 * A getActiveUser() csak interaktív (felhasználó által kiváltott) trigger
 * futtatásokban ad vissza emailt — pl. onEditInstallable. Ezért a logAudit_()
 * wrapper getActiveUser()-t, ez a wrapper getEffectiveUser()-t használ.
 * Ne cseréld fel a kettőt.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * @param {string} muvelet     - AUDIT_MUVELET.xxx értéke
 * @param {string} entitas     - AUDIT_ENTITAS.xxx értéke
 * @param {string} sorAzonId   - pl. szamlaId, kotegId, fájlnév
 * @param {string} mezoNev     - pl. 'KOTEG_ID', 'Gemini OCR', 'BEJÖVŐ_SZÁMLÁK'
 * @param {string} [regiErtek] - előző érték (elhagyható, default '')
 * @param {string} [ujErtek]   - új érték / eredmény leírása
 */
function logAuditScript_(muvelet, entitas, sorAzonId, mezoNev, regiErtek, ujErtek) {
  try {
    const user = Session.getEffectiveUser().getEmail() || 'rendszer';
    _writeAuditRow_(user, AUDIT_FORRAS.RENDSZER, entitas || '',
      muvelet,
      sorAzonId  || '',
      mezoNev    || '',
      regiErtek  || '',
      ujErtek    || '');
  } catch (err) {
    console.error('logAuditScript_ hiba [' + muvelet + ']: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SEGÉDFÜGGVÉNYEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fül neve → AUDIT_ENTITAS értéke.
 * Ismeretlen fül esetén 'ISMERETLEN' — nem dob kivételt.
 *
 * @param {string} tabName
 * @returns {string}
 */
function _getEntityType_(tabName) {
  const terkep = {};
  terkep[CONFIG.TABS.BEJOVO_SZAMLAK]  = AUDIT_ENTITAS.SZAMLA;
  terkep[CONFIG.TABS.SZAMLA_TETELEK]  = AUDIT_ENTITAS.SZAMLA_TETEL;
  terkep[CONFIG.TABS.PROJEKTEK]       = AUDIT_ENTITAS.PROJEKT;
  terkep[CONFIG.TABS.PARTNEREK]       = AUDIT_ENTITAS.PARTNER;
  terkep[CONFIG.TABS.KOTEGEK]         = AUDIT_ENTITAS.KOTEG;
  terkep[CONFIG.TABS.KIMENO_SZAMLAK]  = AUDIT_ENTITAS.KIMENO_SZAMLA;
  terkep[CONFIG.TABS.CONFIG]          = AUDIT_ENTITAS.KONFIG;
  terkep[CONFIG.TABS.ALLOKACIOK_TAB]  = AUDIT_ENTITAS.ALLOKACIO;
  return terkep[tabName] || 'ISMERETLEN';
}

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
 * KÖTEGEK         → köteg ID (A oszlop), pl. "KOTEG-20260409-1"
 * KIMENŐ_SZÁMLÁK  → számla azonosító (A oszlop)
 * CONFIG          → paraméter neve (A oszlop), pl. "PO_CONFIDENCE_THRESHOLD"
 * ALLOKÁCIÓK      → allokáció ID (A oszlop), pl. "ALK-20260408-001-1"
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

    if (tabName === CONFIG.TABS.KOTEGEK) {
      const kotegId = sheet.getRange(row, 1).getValue();
      return kotegId ? String(kotegId) : ('sor ' + row);
    }

    if (tabName === CONFIG.TABS.KIMENO_SZAMLAK) {
      const szamlaId = sheet.getRange(row, 1).getValue();
      return szamlaId ? String(szamlaId) : ('sor ' + row);
    }

    if (tabName === CONFIG.TABS.CONFIG) {
      const paramNev = sheet.getRange(row, 1).getValue();
      return paramNev ? String(paramNev) : ('sor ' + row);
    }

    if (tabName === CONFIG.TABS.ALLOKACIOK_TAB) {
      const allocId = sheet.getRange(row, CONFIG.COLS.ALLOKACIO.ALLOKACIO_ID).getValue();
      return allocId ? String(allocId) : ('sor ' + row);
    }

  } catch (_) {
    // fallback a sorszámra
  }

  return 'sor ' + row;
}
