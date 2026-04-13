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
  rootFolder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);

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
