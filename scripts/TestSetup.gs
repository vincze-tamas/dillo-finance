/**
 * TestSetup.gs
 * Armadillo Pénzügyi Automatizáció — Teszt környezet létrehozó
 *
 * MIKOR FUTTATNI: egyszer, Fázis 0 legelején, MIELŐTT bármilyen más scriptet telepítenél.
 * HOGYAN: Apps Script Editor → válaszd ki a createTestEnvironment() függvényt → ▶ Run
 * EREDMÉNY: a konzolban (View → Logs) megjelennek az ID-k, amiket Config.gs-be kell másolni.
 *
 * FIGYELEM: autobot@armadillo.hu fiókból kell futtatni!
 */

// ─────────────────────────────────────────────────────────────────────────────
// FŐ BELÉPÉSI PONT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Létrehozza a teljes teszt környezetet egy futtatással.
 * A konzolra kiírja az összes ID-t, amelyeket Config.gs-be kell másolni.
 */
function createTestEnvironment() {
  console.log('════════════════════════════════════════');
  console.log('Armadillo TEST környezet létrehozása...');
  console.log('════════════════════════════════════════');

  // 1. Gyökér TEST mappa létrehozása a My Drive-ban
  const rootFolder = _getOrCreateFolder_(DriveApp.getRootFolder(), '🧪 Armadillo TEST');
  console.log('✓ Gyökér mappa: ' + rootFolder.getName() + ' (ID: ' + rootFolder.getId() + ')');

  // 2. Almappák
  const invoicesFolder    = _getOrCreateFolder_(rootFolder, 'Bejövő számlák TEST');
  const rejectedFolder    = _getOrCreateFolder_(rootFolder, 'Visszautasított TEST');
  const batchesFolder     = _getOrCreateFolder_(rootFolder, 'Kötegek TEST');

  // Hónap-almappa az aktuális hónapra (a GmailDrive.gs is így csinálja majd)
  const now = new Date();
  const monthName = hungarianMonth(now); // MI-03: Utils.gs hungarianMonth() — nincs duplikált implementáció;
  const yearFolder   = _getOrCreateFolder_(invoicesFolder, String(now.getFullYear()));
  _getOrCreateFolder_(yearFolder, monthName);

  console.log('✓ Bejövő számlák TEST mappa ID: ' + invoicesFolder.getId());
  console.log('✓ Visszautasított TEST mappa ID: ' + rejectedFolder.getId());
  console.log('✓ Kötegek TEST mappa ID: '         + batchesFolder.getId());

  // 3. Staging Google Sheet létrehozása
  const sheet = _createStagingSheet_(rootFolder);
  console.log('✓ Staging sheet ID: ' + sheet.getId());
  console.log('✓ Staging sheet URL: ' + sheet.getUrl());

  // 4. Összefoglaló — ezt kell Config.gs-be másolni
  console.log('');
  console.log('════════════════════════════════════════');
  console.log('MÁSOLD BE EZEKET A Config.gs-BE:');
  console.log('════════════════════════════════════════');
  console.log('TEST_SPREADSHEET_ID:    "' + sheet.getId() + '"');
  console.log('TEST_INVOICES_FOLDER_ID:"' + invoicesFolder.getId() + '"');
  console.log('TEST_REJECTED_FOLDER_ID:"' + rejectedFolder.getId() + '"');
  console.log('TEST_BATCHES_FOLDER_ID: "' + batchesFolder.getId() + '"');
  console.log('════════════════════════════════════════');
  console.log('✅ Teszt környezet sikeresen létrehozva!');
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGING SHEET LÉTREHOZÁSA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Létrehozza a staging Google Sheet-et a rootFolder-ben.
 * Ha már létezik azonos nevű, nem duplikálja — visszaadja a meglévőt.
 * @param {Folder} rootFolder
 * @returns {Spreadsheet}
 */
function _createStagingSheet_(rootFolder) {
  const SHEET_NAME = '[TEST] Armadillo Pénzügyi Adatbázis';

  // Keresés: létezik-e már?
  const existing = rootFolder.getFilesByName(SHEET_NAME);
  if (existing.hasNext()) {
    const existingFile = existing.next();
    console.log('ℹ️  Staging sheet már létezik, nem duplikálom: ' + existingFile.getId());
    return SpreadsheetApp.openById(existingFile.getId());
  }

  // Új sheet létrehozása
  const ss = SpreadsheetApp.create(SHEET_NAME);

  // Áthelyezés a TEST mappába (Drive-ban alapból a My Drive gyökerében jön létre)
  const file = DriveApp.getFileById(ss.getId());
  file.moveTo(rootFolder);

  // 8 fül létrehozása — csak a struktúra, fejlécek nélkül (Setup.gs fogja kitölteni)
  const tabNames = [
    'BEJÖVŐ_SZÁMLÁK',
    'SZÁMLA_TÉTELEK',
    'PROJEKTEK',
    'PARTNEREK',
    'KÖTEGEK',
    'KIMENŐ_SZÁMLÁK',
    'CONFIG',
    'ALLOKÁCIÓK',
  ];

  // Az első fül neve átírása
  ss.getSheets()[0].setName(tabNames[0]);

  // Többi fül hozzáadása
  for (let i = 1; i < tabNames.length; i++) {
    ss.insertSheet(tabNames[i]);
  }

  // CONFIG fülre alap sorok (hogy a getNextWorkday() ne essen el)
  const configSheet = ss.getSheetByName('CONFIG');
  configSheet.getRange('A1:C1').setValues([['Kulcs', 'Érték', 'Státusz']]);
  // MIN-07: LAST_BATCH_DATE hozzáadva + tartomány javítva A2:C10-re (9 adatsor = sorok 2–10)
  configSheet.getRange('A2:C10').setValues([
    ['HOLIDAYS_2026',           '2026-01-01,2026-01-02,2026-03-15,2026-04-03,2026-04-06,2026-05-01,2026-05-21,2026-08-20,2026-08-21,2026-10-23,2026-11-01,2026-12-24,2026-12-25,2026-12-26', 'ELLENŐRZENDŐ'],
    ['HOLIDAYS_2027',           '', 'ELLENŐRZENDŐ'],
    ['WORKING_SATURDAYS_2026',  '2026-01-10,2026-08-08,2026-12-12', 'ELLENŐRZENDŐ'],
    ['WORKING_SATURDAYS_2027',  '', 'ELLENŐRZENDŐ'],
    ['PO_CONFIDENCE_THRESHOLD', '95', ''],
    ['ADMIN_EMAIL',             'autobot@armadillo.hu', ''],
    ['ARMADILLO_BANKSZAMLA',    'ELLENŐRZENDŐ — add meg az Armadillo MagNet számlaszámát', 'ELLENŐRZENDŐ'],
    ['LAST_DIGEST_DATE',        '', 'AUTO'],
    ['LAST_BATCH_DATE',         '', 'AUTO'],
  ]);

  // PROJEKTEK fülre néhány teszt projektszám (a Validation.gs FK ellenőrzéséhez)
  const projektek = ss.getSheetByName('PROJEKTEK');
  projektek.getRange('A1:G1').setValues([['Projektszám','Projekt neve','Ügyfél neve','Kezdés dátuma','Befejezés dátuma','Státusz','Projekt vezető']]);
  projektek.getRange('A2:G4').setValues([
    ['TEST2601', 'Teszt Projekt 1', 'Teszt Ügyfél Kft.', '2026-01-01', '', 'AKTÍV', 'test@armadillo.hu'],
    ['TEST2602', 'Teszt Projekt 2', 'Másik Ügyfél Zrt.', '2026-02-01', '', 'AKTÍV', 'test@armadillo.hu'],
    ['FCA2601',  'FCA Teszt',       'F Automobil',       '2026-03-01', '', 'AKTÍV', 'test@armadillo.hu'],
  ]);

  // PARTNEREK fülre 1 teszt partner (a ChatNotifier és SheetWriter tesztekhez)
  const partnerek = ss.getSheetByName('PARTNEREK');
  partnerek.getRange('A1:H1').setValues([['Teljes név','Adószám','Bankszámlaszám','Kategória','Kapcsolattartó email','Alapértelmezett fizetési határidő (napokban)','Aktív','Allokációs sablon']]);
  partnerek.getRange('A2:H4').setValues([
    ['Teszt Szállító Kft.',    '11111111-2-41', '11111111-22222222-33333333', 'PROJEKT',    'teszt@tesztszallito.hu', '30', 'IGEN', ''],
    ['Állandó Teszt Kft.',     '22222222-2-41', '44444444-55555555-66666666', 'ÁLLANDÓ',    'allando@teszt.hu',       '30', 'IGEN', ''],
    ['Megosztott Irodaház Kft.','33333333-2-41', '77777777-88888888-99999999', 'MEGOSZTOTT', 'iroda@megosztott.hu',    '30', 'IGEN', 'TEST2601:50;FCA2601:30;ÁLTALÁNOS:20'],
  ]);

  console.log('✓ Staging sheet létrehozva és TEST mappába helyezve');
  return ss;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEGÉDFÜGGVÉNYEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Megkeres vagy létrehoz egy almappát a parentFolder-ben.
 * Ha már létezik azonos nevű, visszaadja az elsőt (nem duplikál).
 * @param {Folder} parentFolder
 * @param {string} folderName
 * @returns {Folder}
 */
function _getOrCreateFolder_(parentFolder, folderName) {
  const existing = parentFolder.getFoldersByName(folderName);
  if (existing.hasNext()) {
    return existing.next();
  }
  return parentFolder.createFolder(folderName);
}

// MI-03: _getHungarianMonthFolder_() eltávolítva — duplikálta a Utils.gs hungarianMonth()-ot.
// Helyette: hungarianMonth(date) hívható közvetlenül (Utils.gs, megosztott függvény).

// ─────────────────────────────────────────────────────────────────────────────
// REPAIR (egyszer futtatandó javítók)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helyreállítja az AUDIT_LOG fejlécsorát, ha az elveszett vagy adatsor írta felül.
 *
 * Mikor kell futtatni: ha az AUDIT_LOG sor 1-ben nem fejléc, hanem audit adat van.
 * Mit csinál: sor 1 ELÉ illeszt egy új sort, majd beírja a 9 fejléc cellát.
 * Meglévő adatok NEM vesznek el — mindenki eggyel lejjebb tolódik.
 *
 * Futtatás: Script Editor → repairAuditLogHeaders → ▶ Run
 */
function repairAuditLogHeaders() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.TABS.AUDIT_LOG);

  if (!sheet) {
    console.error('AUDIT_LOG fül nem található!');
    return;
  }

  // Ellenőrzés: ha A1 már a helyes fejléc, nem kell javítani
  const a1 = sheet.getRange('A1').getValue();
  if (String(a1).trim() === 'Időbélyeg') {
    console.log('ℹ️  Fejléc rendben van (A1 = "Időbélyeg") — nincs szükség javításra.');
    return;
  }

  console.log('Jelenlegi A1 érték: "' + a1 + '" — fejléc hiányzik, javítás...');

  // Sor 1 ELÉ új sor beszúrása (meglévő adatok nem vesznek el)
  sheet.insertRowBefore(1);

  // Fejléc beírása
  const headers = [
    'Időbélyeg',      // A
    'Felhasználó',    // B
    'Forrás',         // C
    'Entitás',        // D
    'Művelet',        // E
    'Sor azonosító',  // F
    'Mező',           // G
    'Előző érték',    // H
    'Új érték',       // I
  ];
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);

  // Formázás — megegyezik a Setup.gs _setHeaders_() stílusával (#4a86e8 kék, félkövér)
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4a86e8');

  // A oszlop datetime formátum az adatsorokra
  sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 999), 1)
       .setNumberFormat('yyyy-mm-dd hh:mm:ss');

  // Sor 1 befagyasztása
  sheet.setFrozenRows(1);

  console.log('✅ AUDIT_LOG fejléc helyreállítva — ' + headers.length + ' oszlop, sor 1 befagyasztva.');
  console.log('   A meglévő ' + (sheet.getLastRow() - 1) + ' audit sor érintetlen.');
}

// ─────────────────────────────────────────────────────────────────────────────
// F1-S1b TESZT SEGÉD — egyetlen email feldolgozása Message ID alapján
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Egyetlen emailt dolgoz fel Gmail Message ID alapján.
 * Így a többi (éles) számla-email nem érintett a teszt alatt.
 *
 * Használat:
 *   1. Küldd el a teszt PDF-et a szamlazas@armadillo.hu-ra
 *   2. Futtasd checkInbox() → konzolban megjelenik a message ID: pl. [195abc3f...]
 *   3. Másold be a message ID-t MSG_ID változóba lent
 *   4. Futtasd ezt a függvényt: processInvoiceById
 *
 * Futtatás: Script Editor → processInvoiceById → ▶ Run
 */
function processInvoiceById() {
  if (!CONFIG.TEST_MODE) {
    throw new Error('processInvoiceById() csak TEST_MODE=true esetén futtatható!');
  }

  // ← Ide írd be a checkInbox() által megmutatott message ID-t
  const MSG_ID = '';

  if (!MSG_ID) {
    throw new Error(
      'MSG_ID üres!\n' +
      '1. Futtasd checkInbox()-ot → konzolban látod: [195abc3f...] "Tárgy"\n' +
      '2. Másold be a szögletes zárójelek közötti ID-t ide:\n' +
      '   const MSG_ID = "195abc3f...";'
    );
  }

  const message = GmailApp.getMessageById(MSG_ID);
  if (!message) {
    throw new Error('Üzenet nem található: ' + MSG_ID);
  }

  console.log('════════════════════════════════════════');
  console.log('processInvoiceById: [' + MSG_ID + ']');
  console.log('Tárgy: "' + message.getSubject() + '"');
  console.log('Feladó: ' + message.getFrom());
  console.log('Dátum: ' + message.getDate().toISOString());
  console.log('════════════════════════════════════════');

  // Deduplikáció-ellenőrzés (ha már benne van a W oszlopban — ne dolgozzuk fel kétszer)
  const processedIds = _loadProcessedMessageIds_();
  if (processedIds.has(MSG_ID)) {
    console.log('ℹ️  Ez az üzenet már szerepel a BEJÖVŐ_SZÁMLÁK W oszlopában.');
    console.log('   Duplikáció teszt: ✅ rendben — nem dolgozza fel újra.');
    return;
  }

  // Feldolgozás — ugyanaz a pipeline mint processNewInvoices()-ban
  const result = _processMessage_(message, processedIds);

  if (result === 'OK') {
    message.markRead();
    _applyProcessedLabel_(message); // Gmail label: "Armadillo/Feldolgozva"
    console.log('✅ Feldolgozás sikeres! Ellenőrizd:');
    console.log('   • Drive: Bejövő számlák TEST / 2026 / 04_Április /');
    console.log('   • BEJÖVŐ_SZÁMLÁK: legújabb sor (N/O/P/Q/W kitöltve)');
    console.log('   • SZÁMLA_TÉTELEK: tétel sorok (J/K/L/M kitöltve)');
    console.log('   • Admin Chat: értesítő üzenet megérkezett');
  } else if (result === 'NO_PDF') {
    console.log('⚠️  Nincs PDF csatolmány az üzenetben. Ellenőrizd a feladott emailt.');
  } else if (result === 'DRIVE_ERROR') {
    console.log('❌ Drive mentési hiba. Email olvasatlan maradt (retry következő körben).');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 24 TESZT SEGÉD — visszautasítás email + PDF áthelyezés önálló teszt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Task 24 direkt teszt: visszautasítás email + Drive áthelyezés, onEdit trigger nélkül.
 *
 * Ez a függvény nem az onEdit úton megy végig — közvetlenül hívja a belső
 * _sendRejectionEmailToPartner_() és _movePdfToRejectedFolder_() függvényeket.
 * Hasznos: ha az onEdit trigger nem tüzel, mégis le akarod ellenőrizni a logikát.
 *
 * Teljes (onEdit) teszt menete a sheet-ben:
 *   1. Nyisd meg az SSOT sheet BEJÖVŐ_SZÁMLÁK fülét
 *   2. Keress egy HIÁNYOS_PO státuszú sort (Q oszlop)
 *   3. T oszlopba írj visszautasítás okot (pl. "Hibás számlaszám")
 *   4. Q oszlopot változtasd VISSZAUTASÍTVA-ra
 *   5. Ellenőrzési pontok:
 *      ✅ Chat értesítő megérkezik
 *      ✅ Email megérkezik → vincze.tamas.ev@gmail.com (TEST_MODE)
 *           Tárgy: "[Armadillo] Számla visszautasítva — [számla sorszáma]"
 *      ✅ PDF eltűnik a Bejövő számlák TEST mappából
 *      ✅ PDF megjelenik a Visszautasított TEST mappában
 *      ✅ Q → VISSZAUTASÍTVA-ból tovább NEM módosítható (terminális státusz)
 *
 * Futtatás: Script Editor → testTask24DirectRejection → ▶ Run
 */
function testTask24DirectRejection() {
  if (!CONFIG.TEST_MODE) {
    throw new Error('testTask24DirectRejection() csak TEST_MODE=true esetén futtatható!');
  }

  console.log('════════════════════════════════════════');
  console.log('Task 24 — Direkt visszautasítás teszt');
  console.log('════════════════════════════════════════');

  // ── 1. BEJÖVŐ_SZÁMLÁK legutolsó sorának adatai ───────────────────────────
  const ss       = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet    = ss.getSheetByName(CONFIG.TABS.BEJOVO_SZAMLAK);
  const lastRow  = sheet.getLastRow();

  if (lastRow < 2) {
    console.log('⚠️  A BEJÖVŐ_SZÁMLÁK fülön nincs adatsor — futtasd előbb processInvoiceById()-t!');
    return;
  }

  const c       = CONFIG.COLS.BEJOVO;
  const rowData = sheet.getRange(lastRow, 1, 1, c.VISSZAUTASITAS_OKA).getValues()[0];

  const szamlaId    = String(rowData[c.SZAMLA_ID       - 1] || '');
  const szallitoNev = String(rowData[c.SZALLITO_NEV    - 1] || '');
  const adoszam     = String(rowData[c.ADOSZAM         - 1] || '');
  const szamlaszam  = String(rowData[c.SZAMLASZAM      - 1] || szamlaId);
  const driveFileId = String(rowData[c.DRIVE_FILE_ID   - 1] || '');
  const statusz     = String(rowData[c.STATUSZ         - 1] || '');

  console.log('Utolsó sor (' + lastRow + '): ' + szamlaId + ' | ' + szallitoNev + ' | ' + statusz);
  console.log('Adószám: ' + adoszam);
  console.log('Számla sorszáma: ' + szamlaszam);
  console.log('Drive fájl ID: ' + (driveFileId || '⚠️  ÜRES'));

  const tesztOk = 'Teszt visszautasítás — Task 24';

  // ── 2. Email küldés ───────────────────────────────────────────────────────
  console.log('');
  console.log('── Email küldés teszt ──');
  try {
    _sendRejectionEmailToPartner_(adoszam, szallitoNev, szamlaszam, tesztOk);
  } catch (e) {
    console.error('❌ Email hiba: ' + e.message);
  }

  // ── 3. PDF áthelyezés ─────────────────────────────────────────────────────
  console.log('');
  console.log('── PDF áthelyezés teszt ──');
  if (driveFileId) {
    try {
      _movePdfToRejectedFolder_(driveFileId);
      console.log('   Ellenőrizd: a PDF eltűnt a Bejövő számlák TEST mappából');
      console.log('   és megjelent a Visszautasított TEST mappában.');
    } catch (e) {
      console.error('❌ PDF áthelyezés hiba: ' + e.message);
    }
  } else {
    console.warn('⚠️  DRIVE_FILE_ID üres — PDF áthelyezés kihagyva.');
  }

  // ── 4. Összegzés ──────────────────────────────────────────────────────────
  console.log('');
  console.log('════════════════════════════════════════');
  console.log('✅ Task 24 direkt teszt kész. Ellenőrizd:');
  console.log('   1. vincze.tamas.ev@gmail.com beérkező levél');
  console.log('      Tárgy: "[Armadillo] Számla visszautasítva — ' + szamlaszam + '"');
  console.log('   2. Drive Visszautasított TEST mappa tartalmazza a PDF-et');
  console.log('   3. A Bejövő számlák TEST mappából eltűnt a PDF');
  console.log('');
  console.log('   Teljes onEdit teszt:');
  console.log('   → Sheet Q oszlop: ' + statusz + ' → VISSZAUTASÍTVA');
  console.log('   → T oszlop visszautasítás oka: tetszőleges szöveg');
  console.log('════════════════════════════════════════');
}

// ─────────────────────────────────────────────────────────────────────────────
// F3-S1b TESZT SEGÉD — Fázis 3 teszt sorok betöltése
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Teszt sorokat tölt be a staging sheet-be a Fázis 3 (WednesdayWorkflow + BatchGenerator) teszteléséhez.
 *
 * Amit létrehoz:
 *   PARTNEREK fül   — 3 teszt partner (PROJEKT×2, ÁLLANDÓ×1) valódi formátumú IBAN-nal
 *   BEJÖVŐ_SZÁMLÁK  — 5 teszt sor különböző státuszokkal:
 *     • [F3-01] JÓVÁHAGYVA  | PROJEKT  | Teszt Építő Kft.    → batch-be kerül
 *     • [F3-02] JÓVÁHAGYVA  | ÁLLANDÓ  | Teszt Irodaház Kft. → batch-be kerül
 *     • [F3-03] JÓVÁHAGYVA  | PROJEKT  | Teszt Anyag Bt.     → 5 napja lejárt → kiemelés
 *     • [F3-04] BEÉRKEZETT  | PROJEKT  | Teszt Fejlesztő Kft.→ digestben látható (nem batch)
 *     • [F3-05] HIÁNYOS_PO  | PROJEKT  | Teszt Design Kft.   → digestben látható (nem batch)
 *
 * runDigestNow() után: Admin Chat-en üzenet érkezik a JÓVÁHAGYVA számlákkal
 * runBatchNow()  után: .txt kötegfájl generálódik a Kötegek TEST mappába ([F3-01], [F3-02], [F3-03])
 *
 * FIGYELEM: Idempotens — ha [F3-01]...[F3-05] ID-k már szerepelnek a sheet-ben, nem duplikálja.
 *
 * Futtatás: Script Editor → insertTestRowsForFazis3 → ▶ Run
 */
function insertTestRowsForFazis3() {
  if (!CONFIG.TEST_MODE) {
    throw new Error('insertTestRowsForFazis3() csak TEST_MODE=true esetén futtatható!');
  }

  console.log('════════════════════════════════════════');
  console.log('Fázis 3 teszt sorok betöltése...');
  console.log('════════════════════════════════════════');

  const ss      = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const bejovo  = ss.getSheetByName(CONFIG.TABS.BEJOVO_SZAMLAK);
  const partner = ss.getSheetByName(CONFIG.TABS.PARTNEREK);

  if (!bejovo || !partner) {
    throw new Error('BEJÖVŐ_SZÁMLÁK vagy PARTNEREK fül nem található — futtasd setupSSOT()-t előbb!');
  }

  // ── 1. TESZT PARTNEREK ────────────────────────────────────────────────────
  // Formátum: NEV | ADOSZAM | BANKSZAMLA | KATEGORIA | EMAIL | FIZETESI_HATARIDO | AKTIV
  // BANKSZAMLA: valódi formátum (8-8-8 vagy 8-8), csak számok (a _buildBankMap_ így normalizálja)
  const testPartners = [
    ['Teszt Építő Kft.',    '11111111-1-11', '10102244-12345678-00000000', 'PROJEKT', 'epito@teszt.hu',   30, 'IGEN'],
    ['Teszt Irodaház Kft.', '22222222-2-22', '10400000-87654321-00000000', 'ÁLLANDÓ', 'iroda@teszt.hu',   8,  'IGEN'],
    ['Teszt Anyag Bt.',     '33333333-3-33', '11773016-77777777-00000000', 'PROJEKT', 'anyag@teszt.hu',   15, 'IGEN'],
  ];

  // Deduplikáció: már meglévő adószámok kiszűrése
  const existingPartnerData = partner.getDataRange().getValues();
  const existingAdoszamok   = new Set(
    existingPartnerData.slice(1).map(function(r) { return String(r[1] || '').trim(); })
  );

  let partnerAdded = 0;
  testPartners.forEach(function(p) {
    if (existingAdoszamok.has(p[1])) {
      console.log('  ℹ️  Partner már létezik: ' + p[0] + ' — kihagyva.');
    } else {
      partner.appendRow(p);
      partnerAdded++;
      console.log('  ✓ Partner hozzáadva: ' + p[0] + ' (adószám: ' + p[1] + ')');
    }
  });
  console.log('Partnerek: ' + partnerAdded + ' db hozzáadva.');

  // ── 2. TESZT SZÁMLÁK ──────────────────────────────────────────────────────
  const c    = CONFIG.COLS.BEJOVO;
  const now  = new Date();
  const today = formatDate(now);

  // Fizetési határidők
  const határidőJövő  = formatDate(new Date(now.getTime() + 10 * 86400000)); // +10 nap
  const határidőLejárt= formatDate(new Date(now.getTime() -  5 * 86400000)); // -5 nap (lejárt!)
  const határidőMa    = formatDate(new Date(now.getTime() +  3 * 86400000)); // +3 nap

  // Deduplikáció: már meglévő számla ID-k kiszűrése
  const existingBejovo  = bejovo.getLastRow() > 1
    ? bejovo.getRange(2, 1, bejovo.getLastRow() - 1, 1).getValues().map(function(r) { return String(r[0]); })
    : [];
  const existingIds = new Set(existingBejovo);

  // Minden sor: 23 oszlop (A–W), indexek CONFIG.COLS.BEJOVO alapján (1-alapú → array 0-alapú)
  function makeRow(id, nev, adoszam, szamlaszam, osszeg, deviza, kategoria, poSummary, poConf, poReasoning, statusz, jovahagyo, jovahagyasDatum) {
    const row = new Array(c.GMAIL_MESSAGE_ID).fill('');
    row[c.SZAMLA_ID          - 1] = id;
    row[c.SZALLITO_NEV       - 1] = nev;
    row[c.ADOSZAM            - 1] = adoszam;
    row[c.SZAMLASZAM         - 1] = szamlaszam;
    row[c.KELT               - 1] = today;
    row[c.OSSZEG_NETTO       - 1] = Math.round(osszeg / 1.27); // nettó visszafelé számolva 27% ÁFA-ból
    row[c.TELJESITES         - 1] = today;
    row[c.FIZHATARIDO        - 1] = (id === '[F3-03]') ? határidőLejárt : (id === '[F3-04]' || id === '[F3-05]') ? határidőMa : határidőJövő;
    row[c.OSSZEG_BRUTTO      - 1] = osszeg;
    row[c.DEVIZA             - 1] = deviza;
    row[c.KATEGORIA          - 1] = kategoria;
    row[c.DRIVE_URL          - 1] = 'https://drive.google.com/file/d/TESZT_F3_PLACEHOLDER';
    row[c.PO_SUMMARY         - 1] = poSummary;
    row[c.PO_CONFIDENCE      - 1] = poConf;
    row[c.PO_REASONING       - 1] = poReasoning;
    row[c.STATUSZ            - 1] = statusz;
    row[c.JOVAHAGYO          - 1] = jovahagyo;
    row[c.JOVAHAGYAS_DATUM   - 1] = jovahagyasDatum;
    row[c.GMAIL_MESSAGE_ID   - 1] = 'TESZT_F3_' + id.replace(/[\[\]]/g, '');
    return row;
  }

  const testRows = [
    // id          nev                   adoszam           szamlaszam         osszeg  deviza  kategoria  poSummary  poConf  poReasoning                  statusz        jovahagyo              jovhDatum
    makeRow('[F3-01]', 'Teszt Építő Kft.',    '11111111-1-11', 'EPITO-2026-042',  381000, 'HUF', 'PROJEKT', 'FCA2601', 98,    'Magabiztos egyezés',         'JÓVÁHAGYVA',  'teszt@armadillo.hu',  today),
    makeRow('[F3-02]', 'Teszt Irodaház Kft.', '22222222-2-22', 'IRODA-2026-018',  127000, 'HUF', 'ÁLLANDÓ', 'N/A',     100,   'ÁLLANDÓ — PO nem szükséges', 'JÓVÁHAGYVA',  'teszt@armadillo.hu',  today),
    makeRow('[F3-03]', 'Teszt Anyag Bt.',     '33333333-3-33', 'ANYAG-2026-007',  254000, 'HUF', 'PROJEKT', 'FCA2602', 97,    'Egyértelmű projekt egyezés', 'JÓVÁHAGYVA',  'teszt@armadillo.hu',  today),
    makeRow('[F3-04]', 'Teszt Fejlesztő Kft.','11111111-1-11', 'FEJL-2026-031',   95200,  'HUF', 'PROJEKT', 'FCA2601', 99,    'Magabiztos egyezés',         'BEÉRKEZETT',  '',                    ''),
    makeRow('[F3-05]', 'Teszt Design Kft.',   '22222222-2-22', 'DSGN-2026-005',   63500,  'HUF', 'PROJEKT', 'HIÁNYOS', 0,     'NINCS_PO',                   'HIÁNYOS_PO',  '',                    ''),
  ];

  let szamlaAdded = 0;
  testRows.forEach(function(row) {
    const id = row[c.SZAMLA_ID - 1];
    if (existingIds.has(id)) {
      console.log('  ℹ️  Számla már létezik: ' + id + ' — kihagyva.');
    } else {
      bejovo.appendRow(row);
      szamlaAdded++;
      console.log('  ✓ Számla hozzáadva: ' + id + ' | ' + row[c.SZALLITO_NEV - 1] +
        ' | ' + row[c.OSSZEG_BRUTTO - 1] + ' HUF | ' + row[c.STATUSZ - 1]);
    }
  });
  console.log('Számlák: ' + szamlaAdded + ' db hozzáadva.');

  // ── 3. Összefoglaló ───────────────────────────────────────────────────────
  console.log('');
  console.log('════════════════════════════════════════');
  console.log('✅ Fázis 3 teszt sorok betöltve. Most futtatható:');
  console.log('');
  console.log('  1. runDigestNow()');
  console.log('     → Admin Chat-en üzenet érkezik');
  console.log('     → 3 JÓVÁHAGYVA számla listázva (összesen: ' +
    (381000 + 127000 + 254000).toLocaleString() + ' HUF)');
  console.log('     → [F3-03] LEJÁRT fizetési határidővel kiemelve (5 napja lejárt)');
  console.log('');
  console.log('  2. runBatchNow()');
  console.log('     → .txt kötegfájl a Kötegek TEST mappába');
  console.log('     → FEJ sor: 174 char | TÉTEL sorok: 249 char | LÁB: 24 char');
  console.log('     → [F3-01], [F3-02], [F3-03] KOTEG_ID (V) kitöltve — Q státusz JÓVÁHAGYVA marad');
  console.log('     → KÖTEGEK fülön új sor keletkezett');
  console.log('════════════════════════════════════════');
}

/**
 * Törli a Fázis 3 teszt sorokat a BEJÖVŐ_SZÁMLÁK és PARTNEREK fülekről.
 * Hasznos: újra akarod futtatni a tesztet tiszta lappal.
 * Futtatás: Script Editor → clearTestRowsForFazis3 → ▶ Run
 */
function clearTestRowsForFazis3() {
  if (!CONFIG.TEST_MODE) {
    throw new Error('clearTestRowsForFazis3() csak TEST_MODE=true esetén futtatható!');
  }

  const ss      = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const bejovo  = ss.getSheetByName(CONFIG.TABS.BEJOVO_SZAMLAK);
  const partner = ss.getSheetByName(CONFIG.TABS.PARTNEREK);

  const F3_IDS      = new Set(['[F3-01]','[F3-02]','[F3-03]','[F3-04]','[F3-05]']);
  const F3_ADOSZAMOK= new Set(['11111111-1-11','22222222-2-22','33333333-3-33']);

  // Sorok törlése visszafelé (hogy az index ne csússzon el)
  let deleted = 0;

  function deleteMatchingRows(sheet, colIndex, matchSet) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return 0;
    const vals = sheet.getRange(2, colIndex, lastRow - 1, 1).getValues();
    let count = 0;
    for (let i = vals.length - 1; i >= 0; i--) {
      if (matchSet.has(String(vals[i][0]).trim())) {
        sheet.deleteRow(i + 2); // +2: 1-alapú + fejléc sor
        count++;
      }
    }
    return count;
  }

  deleted += deleteMatchingRows(bejovo,  CONFIG.COLS.BEJOVO.SZAMLA_ID,  F3_IDS);
  deleted += deleteMatchingRows(partner, CONFIG.COLS.PARTNER.ADOSZAM,   F3_ADOSZAMOK);

  console.log('✅ Fázis 3 teszt sorok törölve: ' + deleted + ' db (BEJÖVŐ_SZÁMLÁK + PARTNEREK).');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLEANUP (opcionális — csak ha el akarod távolítani a teszt környezetet)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Törli a teljes 🧪 Armadillo TEST mappát és tartalmát.
 * FIGYELEM: visszafordíthatatlan! Csak akkor futtasd, ha biztosan törölni akarod.
 * Kommenteld ki a Trash sort és használd a deleteFile-t ha véglegesen törölni akarod.
 */
function cleanupTestEnvironment() {
  const folders = DriveApp.getRootFolder().getFoldersByName('🧪 Armadillo TEST');
  if (!folders.hasNext()) {
    console.log('ℹ️  Teszt mappa nem található — nincs mit törölni.');
    return;
  }
  const folder = folders.next();
  // Kukába helyezés (visszaállítható 30 napig)
  folder.setTrashed(true);
  console.log('✓ 🧪 Armadillo TEST mappa kukába helyezve (30 napig visszaállítható).');
}
