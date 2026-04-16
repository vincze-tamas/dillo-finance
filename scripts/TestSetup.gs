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
