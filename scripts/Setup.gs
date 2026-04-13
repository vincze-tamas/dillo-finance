/**
 * Setup.gs
 * Armadillo Pénzügyi Automatizáció — SSOT Sheet struktúra létrehozó
 *
 * MIKOR FUTTATNI: egyszer, Fázis 0 Task 02-ben, MIUTÁN a sheet létrejött
 * (TestSetup.gs által vagy kézzel), és az ID-k be vannak írva Config.gs-be.
 * HOGYAN: Apps Script Editor → setupSSOT() → ▶ Run
 *
 * Idempotens: ha a fejlécek már léteznek, nem írja felül — biztonságos újrafuttatni.
 * Az adatsorokat SOHA nem érinti.
 *
 * FIGYELEM: autobot@armadillo.hu fiókból kell futtatni!
 */

// ─────────────────────────────────────────────────────────────────────────────
// FŐ BELÉPÉSI PONT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Létrehozza / frissíti az SSOT sheet összes fülének fejléc sorát,
 * dropdown validációit és alapvető formázását.
 */
function setupSSOT() {
  console.log('════════════════════════════════════════');
  console.log('Armadillo SSOT sheet setup...');
  console.log('Spreadsheet ID: ' + CONFIG.SPREADSHEET_ID);
  console.log('TEST_MODE: ' + CONFIG.TEST_MODE);
  console.log('════════════════════════════════════════');

  if (!CONFIG.SPREADSHEET_ID) {
    throw new Error('CONFIG.SPREADSHEET_ID nincs beállítva! ' +
      'Futtasd TestSetup.gs → createTestEnvironment()-t, majd másold be az ID-t Config.gs-be.');
  }

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  _setupTab_(ss, CONFIG.TABS.BEJOVO_SZAMLAK,  _setupBejovoszamlak_);
  _setupTab_(ss, CONFIG.TABS.SZAMLA_TETELEK,  _setupSzamlaTetelek_);
  _setupTab_(ss, CONFIG.TABS.PROJEKTEK,        _setupProjektek_);
  _setupTab_(ss, CONFIG.TABS.PARTNEREK,        _setupPartnerek_);
  _setupTab_(ss, CONFIG.TABS.KOTEGEK,          _setupKotegek_);
  _setupTab_(ss, CONFIG.TABS.KIMENO_SZAMLAK,   _setupKimenoSzamlak_);
  _setupTab_(ss, CONFIG.TABS.CONFIG,           _setupConfigTab_);
  _setupTab_(ss, CONFIG.TABS.ALLOKACIOK_TAB,       _setupAllokaciok_);

  console.log('════════════════════════════════════════');
  console.log('✅ SSOT setup kész! Következő lépés:');
  console.log('   1. Validation.gs → onEditInstallable trigger beállítása');
  console.log('   2. PROJEKTEK fülre aktív projektek feltöltése (Ági — P12)');
  console.log('   3. PARTNEREK fülre aktív partnerek feltöltése');
  console.log('════════════════════════════════════════');
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB SETUP KERETRENDSZER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Megkeresi a fület, szükség esetén létrehozza, majd meghívja a setupFn-t.
 * @param {Spreadsheet} ss
 * @param {string}      tabName
 * @param {Function}    setupFn  - fn(sheet) — elvégzi a fejléc + validáció beállítást
 */
function _setupTab_(ss, tabName, setupFn) {
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    console.log('✓ Fül létrehozva: ' + tabName);
  } else {
    console.log('ℹ️  Fül már létezik: ' + tabName);
  }
  setupFn(sheet);
}

/**
 * Fejléc sor beállítása — csak ha az A1 cella üres (idempotens).
 * @param {Sheet}    sheet
 * @param {Array}    headers   - Fejléc cellák tömbje
 */
function _setHeaders_(sheet, headers) {
  const range = sheet.getRange(1, 1, 1, headers.length);
  if (sheet.getRange('A1').getValue() === '') {
    range.setValues([headers]);
    console.log('  → Fejlécek beállítva: ' + headers.length + ' oszlop');
  } else {
    console.log('  → Fejlécek már léteznek (' + sheet.getName() + '), formázás frissítve.');
  }
  // Formázás mindig alkalmazva — idempotens, javítja a hiányzó kék fejlécet is
  range.setFontWeight('bold');
  range.setBackground('#4a86e8');
  range.setFontColor('#ffffff');
  sheet.setFrozenRows(1);
}

/**
 * Dropdown validációt állít be egy teljes oszlopra (2. sortól).
 * @param {Sheet}    sheet
 * @param {number}   col      - 1-alapú oszlop index
 * @param {string[]} values   - Engedélyezett értékek
 * @param {boolean}  strict   - Ha true: csak a listából engedélyez (default: true)
 */
function _setDropdown_(sheet, col, values, strict) {
  strict = (strict === undefined) ? true : strict;
  const lastRow   = Math.max(sheet.getMaxRows(), 1000);
  const range     = sheet.getRange(2, col, lastRow - 1, 1);
  const rule      = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(!strict)
    .build();
  range.setDataValidation(rule);
}

/**
 * Oszlopszélességet állít be egy tömbből.
 * @param {Sheet}    sheet
 * @param {number[]} widths   - Oszlop szélességek px-ben (1-alapú indexhez igazítva)
 */
function _setColumnWidths_(sheet, widths) {
  widths.forEach(function(w, i) {
    if (w > 0) sheet.setColumnWidth(i + 1, w);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FÜLÖNKÉNTI SETUP FÜGGVÉNYEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BEJÖVŐ_SZÁMLÁK — 23 oszlop
 * Státusz (Q=17) onEdit trigger figyeli
 */
function _setupBejovoszamlak_(sheet) {
  const headers = [
    'Számla ID',            // A  1
    'Szállító neve',        // B  2
    'Adószám',              // C  3
    'Számlaszám',           // D  4
    'Kelt',                 // E  5
    'Összeg (nettó)',        // F  6
    'Teljesítés dátuma',    // G  7  ← külön oszlop
    'Fizetési határidő',    // H  8  ← külön oszlop
    'Összeg (bruttó)',       // I  9
    'Deviza',               // J  10
    'Kategória',            // K  11  dropdown
    'Drive URL',            // L  12
    'Drive File ID',        // M  13
    'PO_SUMMARY',           // N  14  konkrét PO / MULTI / HIÁNYOS
    'PO_CONFIDENCE',        // O  15  0–100
    'PO_REASONING',         // P  16  Gemini aggregált magyarázat
    'Státusz',              // Q  17  onEdit trigger figyeli!
    'Jóváhagyó neve',       // R  18
    'Jóváhagyás dátuma',    // S  19
    'Visszautasítás oka',   // T  20
    'Utalás dátuma',        // U  21
    'Köteg ID',             // V  22
    'Gmail Message ID',     // W  23  deduplikáció
  ];
  _setHeaders_(sheet, headers);

  // Kategória dropdown (K=11)
  _setDropdown_(sheet, 11, [
    CONFIG.KATEGORIAK.PROJEKT,
    CONFIG.KATEGORIAK.ALLANDO,
    CONFIG.KATEGORIAK.MEGOSZTOTT,
  ]);

  // Státusz dropdown (Q=17)
  _setDropdown_(sheet, 17, [
    'BEÉRKEZETT',
    'HIÁNYOS_PO',
    'VISSZAUTASÍTVA',
    'JÓVÁHAGYVA',
    'UTALVA',
    'AI_HIBA',
    'LOCK_TIMEOUT',
  ]);

  // Deviza dropdown (J=10) — csak HUF/EUR, strict=true
  _setDropdown_(sheet, 10, ['HUF', 'EUR']);

  // Conditional formatting — Q oszlop (Státusz) alapján teljes sor színezés
  _setConditionalFormatting_(sheet);

  _setColumnWidths_(sheet, [
    120,  // A  Számla ID
    200,  // B  Szállító neve
    120,  // C  Adószám
    150,  // D  Számlaszám
    100,  // E  Kelt
    110,  // F  Összeg (nettó)
    110,  // G  Teljesítés dátuma
    120,  // H  Fizetési határidő
    110,  // I  Összeg (bruttó)
    70,   // J  Deviza
    100,  // K  Kategória
    250,  // L  Drive URL
    180,  // M  Drive File ID
    200,  // N  PO_SUMMARY
    100,  // O  PO_CONFIDENCE
    300,  // P  PO_REASONING
    110,  // Q  Státusz
    150,  // R  Jóváhagyó neve
    130,  // S  Jóváhagyás dátuma
    200,  // T  Visszautasítás oka
    110,  // U  Utalás dátuma
    120,  // V  Köteg ID
    200,  // W  Gmail Message ID
  ]);

  console.log('  → BEJÖVŐ_SZÁMLÁK kész (23 oszlop, Státusz=Q17, dropdown-ok beállítva)');
}

/**
 * BEJÖVŐ_SZÁMLÁK conditional formatting — Q oszlop (Státusz) alapján teljes sor.
 * Mindig újraállítja a szabályokat (idempotens: előbb törli, majd beírja).
 * @param {Sheet} sheet
 */
function _setConditionalFormatting_(sheet) {
  sheet.clearConditionalFormatRules();
  const maxRows = Math.max(sheet.getMaxRows(), 1000);
  const dataRange = sheet.getRange(2, 1, maxRows - 1, 23); // A2:W

  const rules = [
    // AI_HIBA — sötétpiros, fehér betű (legmagasabb prioritás)
    ['AI_HIBA',        '#990000', '#ffffff'],
    // LOCK_TIMEOUT — narancs
    ['LOCK_TIMEOUT',   '#f9cb9c', '#7f4c00'],
    // VISSZAUTASÍTVA — piros
    ['VISSZAUTASÍTVA', '#f4c7c3', '#a61c00'],
    // HIÁNYOS_PO — sárga
    ['HIÁNYOS_PO',     '#fce8b2', '#7f6000'],
    // JÓVÁHAGYVA — zöld
    ['JÓVÁHAGYVA',     '#b7e1cd', '#0d652d'],
    // BEKÖTEGELT — szürke
    ['BEKÖTEGELT',     '#efefef', '#434343'],
    // UTALVA — lila
    ['UTALVA',         '#d9d2e9', '#4c1130'],
    // BEÉRKEZETT — kék
    ['BEÉRKEZETT',     '#c9daf8', '#1c4587'],
  ].map(function(r) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$Q2="' + r[0] + '"')
      .setBackground(r[1])
      .setFontColor(r[2])
      .setRanges([dataRange])
      .build();
  });

  sheet.setConditionalFormatRules(rules);
  console.log('  → Conditional formatting beállítva (8 státusz-szabály, Q oszlop alapján)');
}

/**
 * SZÁMLA_TÉTELEK — 13 oszlop
 * K/L/M = PO adatok (tétel szintű), M = PO_VALIDÁLT onEdit számítja
 */
function _setupSzamlaTetelek_(sheet) {
  const headers = [
    'Számla ID',             // A  1  FK → BEJÖVŐ_SZÁMLÁK.A
    'Tétel #',               // B  2
    'Leírás',                // C  3
    'Mennyiség',             // D  4
    'Egységár',              // E  5
    'Nettó',                 // F  6
    'ÁFA%',                  // G  7
    'ÁFA összeg',            // H  8
    'Bruttó',                // I  9
    'Projektszám (PO)',      // J  10  FK → PROJEKTEK.A, validálva M-ben
    'PO_CONFIDENCE',         // K  11  0–100, Gemini adja
    'PO_REASONING',          // L  12  Gemini magyarázat
    'PO_VALIDÁLT',           // M  13  IGEN/NEM — auto: J ∈ PROJEKTEK.A ÉS K ≥ 95
  ];
  _setHeaders_(sheet, headers);

  // PO_VALIDÁLT dropdown (M=13) — IGEN/NEM/N/A engedélyezett
  // N/A: ÁLLANDÓ és MEGOSZTOTT kategóriájú számlák tételei (SheetWriter._computePoValidalt_)
  _setDropdown_(sheet, 13, ['IGEN', 'NEM', 'N/A']);

  // PO_CONFIDENCE numerikus validáció (K=11): 0–100
  const kRange = sheet.getRange(2, 11, Math.max(sheet.getMaxRows() - 1, 999), 1);
  kRange.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireNumberBetween(0, 100)
      .setAllowInvalid(false)
      .setHelpText('PO_CONFIDENCE: 0–100 közötti egész szám (Gemini adja)')
      .build()
  );

  _setColumnWidths_(sheet, [
    120,  // A  Számla ID
    60,   // B  Tétel #
    280,  // C  Leírás
    80,   // D  Mennyiség
    100,  // E  Egységár
    100,  // F  Nettó
    60,   // G  ÁFA%
    100,  // H  ÁFA összeg
    100,  // I  Bruttó
    130,  // J  Projektszám (PO)
    110,  // K  PO_CONFIDENCE
    300,  // L  PO_REASONING
    100,  // M  PO_VALIDÁLT
  ]);

  console.log('  → SZÁMLA_TÉTELEK kész (13 oszlop, K/L/M PO oszlopok beállítva)');
}

/**
 * PROJEKTEK — 7 oszlop
 * A oszlop projektszám: ^[A-Z]{3,4}[0-9]{4}$ — Validation.gs ellenőrzi
 */
function _setupProjektek_(sheet) {
  const headers = [
    'Projektszám',           // A  1  regex: ^[A-Z]{3,4}[0-9]{4}$
    'Projekt neve',          // B  2
    'Ügyfél neve',           // C  3
    'Kezdés dátuma',         // D  4
    'Befejezés dátuma',      // E  5
    'Státusz',               // F  6  dropdown
    'Projekt vezető',        // G  7
  ];
  _setHeaders_(sheet, headers);

  // Projektszám regex (A=1): ^[A-Z]{3,4}[0-9]{4}$
  // requireTextMatchesPattern nem létezik GAS-ban → requireFormulaSatisfied + REGEXMATCH
  const aRange = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 999), 1);
  aRange.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied('=REGEXMATCH(A2,"^[A-Z]{3,4}[0-9]{4}$")')
      .setAllowInvalid(false)
      .setHelpText('Projektszám formátum: 3–4 nagybetű + 4 szám, pl. FCA2601, IMME2601')
      .build()
  );

  // Státusz dropdown (F=6)
  _setDropdown_(sheet, 6, ['AKTÍV', 'LEZÁRT', 'FELFÜGGESZTETT']);

  _setColumnWidths_(sheet, [
    110,  // A  Projektszám
    200,  // B  Projekt neve
    200,  // C  Ügyfél neve
    110,  // D  Kezdés dátuma
    120,  // E  Befejezés dátuma
    110,  // F  Státusz
    180,  // G  Projekt vezető
  ]);

  console.log('  → PROJEKTEK kész (7 oszlop, Státusz dropdown beállítva)');
}

/**
 * PARTNEREK — 8 oszlop
 * H = Allokációs sablon (MEGOSZTOTT kategóriájú partnereknek)
 * Formátum: "IMME2601:40;FCA2601:35;ÁLTALÁNOS:25" vagy "AKTÍV_PROJEKTEK_EGYENLŐ"
 */
function _setupPartnerek_(sheet) {
  const headers = [
    'Teljes név',                              // A  1
    'Adószám',                                 // B  2
    'Bankszámlaszám',                          // C  3
    'Kategória',                               // D  4  dropdown
    'Kapcsolattartó email',                    // E  5
    'Alapértelmezett fiz. határidő (napokban)',// F  6
    'Aktív',                                   // G  7  dropdown
    'Allokációs sablon',                       // H  8  MEGOSZTOTT kategóriánál kitöltendő
  ];
  _setHeaders_(sheet, headers);

  // Kategória dropdown (D=4)
  _setDropdown_(sheet, 4, [
    CONFIG.KATEGORIAK.PROJEKT,
    CONFIG.KATEGORIAK.ALLANDO,
    CONFIG.KATEGORIAK.MEGOSZTOTT,
  ]);

  // Aktív dropdown (G=7)
  _setDropdown_(sheet, 7, ['IGEN', 'NEM']);

  _setColumnWidths_(sheet, [
    200,  // A  Teljes név
    120,  // B  Adószám
    220,  // C  Bankszámlaszám
    110,  // D  Kategória
    200,  // E  Kapcsolattartó email
    80,   // F  Határidő (nap)
    70,   // G  Aktív
    350,  // H  Allokációs sablon
  ]);

  // Megjegyzés az allokációs sablonhoz
  sheet.getRange('H1').setNote(
    'MEGOSZTOTT kategóriájú partnereknek kötelező.\n' +
    'Formátum: "PROJEKTKOD:SZAZALEK;..." pl. "IMME2601:40;FCA2601:35;ÁLTALÁNOS:25"\n' +
    'Alternatíva: "AKTÍV_PROJEKTEK_EGYENLŐ" (Fázis 6 — AI allokáció esetén)'
  );

  console.log('  → PARTNEREK kész (8 oszlop, H=Allokációs sablon)');
}

/**
 * KÖTEGEK — 9 oszlop
 * Szerda 14:00 WednesdayWorkflow.gs tölti fel
 */
function _setupKotegek_(sheet) {
  const headers = [
    'Köteg ID',              // A  1
    'Létrehozás dátuma',     // B  2
    'Utalási dátum',         // C  3  getNextWorkday() által számolt
    'Számlák száma',         // D  4
    'Összeg (HUF)',          // E  5
    'Státusz',               // F  6  dropdown
    'Drive File ID',         // G  7
    'Drive URL',             // H  8
    'MagNet feltöltve',      // I  9  IGEN/NEM
  ];
  _setHeaders_(sheet, headers);

  // Státusz dropdown (F=6)
  _setDropdown_(sheet, 6, ['NYITOTT', 'LEZÁRT', 'FELTÖLTVE', 'HIBA']);

  // MagNet feltöltve dropdown (I=9)
  _setDropdown_(sheet, 9, ['IGEN', 'NEM', 'FOLYAMATBAN']);

  _setColumnWidths_(sheet, [
    120,  // A  Köteg ID
    130,  // B  Létrehozás dátuma
    120,  // C  Utalási dátum
    90,   // D  Számlák száma
    120,  // E  Összeg (HUF)
    110,  // F  Státusz
    180,  // G  Drive File ID
    250,  // H  Drive URL
    120,  // I  MagNet feltöltve
  ]);

  console.log('  → KÖTEGEK kész (9 oszlop)');
}

/**
 * KIMENŐ_SZÁMLÁK — 11 oszlop
 * Fázis 4 dashboard adatforrása (jelenleg manuálisan töltik)
 */
function _setupKimenoSzamlak_(sheet) {
  const headers = [
    'Számla ID',             // A  1
    'Ügyfél neve',           // B  2
    'Projektszám',           // C  3
    'Számlaszám',            // D  4
    'Kelt',                  // E  5
    'Teljesítés dátuma',     // F  6
    'Fizetési határidő',     // G  7
    'Összeg (nettó)',        // H  8
    'Összeg (bruttó)',        // I  9
    'Deviza',                // J  10
    'Státusz',               // K  11  dropdown
  ];
  _setHeaders_(sheet, headers);

  // Státusz dropdown (K=11)
  _setDropdown_(sheet, 11, ['KIÁLLÍTOTT', 'FIZETVE', 'KÉSEDELMES', 'STORNÓ']);

  // Deviza dropdown (J=10)
  _setDropdown_(sheet, 10, ['HUF', 'EUR', 'USD'], false);

  _setColumnWidths_(sheet, [
    120,  // A  Számla ID
    200,  // B  Ügyfél neve
    110,  // C  Projektszám
    150,  // D  Számlaszám
    100,  // E  Kelt
    120,  // F  Teljesítés dátuma
    130,  // G  Fizetési határidő
    110,  // H  Összeg (nettó)
    110,  // I  Összeg (bruttó)
    70,   // J  Deviza
    110,  // K  Státusz
  ]);

  console.log('  → KIMENŐ_SZÁMLÁK kész (11 oszlop)');
}

/**
 * CONFIG — 3 oszlop
 * Ünnepnapok, áthelyezett munkanapok, küszöbértékek.
 * Az alap sorok TestSetup.gs által kerülnek ide — ez csak fejlécet ellenőriz.
 */
function _setupConfigTab_(sheet) {
  // Nincs korai return — _setHeaders_ maga kezeli az idempotenciát,
  // és mindig frissíti a formázást (kék fejléc) akkor is ha értékek már léteznek.
  const headers = ['Kulcs', 'Érték', 'Státusz'];
  _setHeaders_(sheet, headers);

  // Státusz dropdown (C=3): kézzel állítja Péter / IT felelős
  _setDropdown_(sheet, 3, ['ELLENŐRZENDŐ', 'VERIFIED']);

  _setColumnWidths_(sheet, [
    200,  // A  Kulcs
    500,  // B  Érték  (ünnepnap listák hosszúak lehetnek)
    120,  // C  Státusz
  ]);

  console.log('  → CONFIG fejlécek beállítva');
}

/**
 * ALLOKÁCIÓK — 8 oszlop
 * Fázis 6 (P&L) előkészítése. MEGOSZTOTT számlák itt kapnak projekt-allokációt.
 * Jelenleg manuálisan töltik (ALLOKÁCIÓ_TÍPUS=MANUÁLIS), később FIX sablon alapján.
 */
function _setupAllokaciok_(sheet) {
  const headers = [
    'Allokáció ID',          // A  1  generateId('ALL')
    'Számla ID',             // B  2  FK → BEJÖVŐ_SZÁMLÁK.A
    'Projekt',               // C  3  projektszám vagy "ÁLTALÁNOS"
    'Arány (%)',             // D  4  0–100
    'Összeg (nettó)',        // E  5  számított
    'Allokáció típusa',      // F  6  dropdown: MANUÁLIS/FIX/AI
    'Létrehozva',            // G  7
    'Megjegyzés',            // H  8
  ];
  _setHeaders_(sheet, headers);

  // Allokáció típusa dropdown (F=6)
  _setDropdown_(sheet, 6, [
    CONFIG.ALLOKACIO_TIPUSOK.MANUALIS,
    CONFIG.ALLOKACIO_TIPUSOK.FIX,
    CONFIG.ALLOKACIO_TIPUSOK.AI,
  ]);

  _setColumnWidths_(sheet, [
    140,  // A  Allokáció ID
    120,  // B  Számla ID
    130,  // C  Projekt
    80,   // D  Arány (%)
    120,  // E  Összeg (nettó)
    130,  // F  Allokáció típusa
    110,  // G  Létrehozva
    250,  // H  Megjegyzés
  ]);

  // Megjegyzés a fülre
  sheet.getRange('A1').setNote(
    'MEGOSZTOTT kategóriájú számlák allokációját tartalmazza.\n' +
    'MANUÁLIS: Ági tölti ki kézzel\n' +
    'FIX: PARTNEREK.Allokációs sablon alapján automatikus\n' +
    'AI: Fázis 6 — Gemini alapján (jelenleg nem aktív)\n\n' +
    'Egy számlához több sor is tartozhat (projekt + ÁLTALÁNOS overhead).\n' +
    'Az összes sor Arány (%) összege = 100 kell legyen.'
  );

  console.log('  → ALLOKÁCIÓK kész (8 oszlop, ALLOKÁCIÓ_TÍPUS dropdown beállítva)');
}

// ─────────────────────────────────────────────────────────────────────────────
// TESZT ADATOK (staging ellenőrzéshez — csak TEST_MODE=true esetén futtatható)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Teszt partneradatok hozzáadása a PARTNEREK fülhöz.
 * A TestSetup.gs már hozzáad 2 alap partnert — ez kiegészíti MEGOSZTOTT példával.
 * Futtatás: csak teszt környezetben! Script Editor → addTestPartners → ▶ Run
 */
function addTestPartners() {
  if (!CONFIG.TEST_MODE) {
    throw new Error('addTestPartners() csak TEST_MODE=true esetén futtatható!');
  }

  const ss      = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet   = ss.getSheetByName(CONFIG.TABS.PARTNEREK);
  const lastRow = sheet.getLastRow();

  // Ellenőrzés: ha már van MEGOSZTOTT teszt partner, nem duplikálunk
  const data = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues() : [];
  const existingNames = data.map(function(r) { return r[0]; });
  if (existingNames.indexOf('Megosztott Irodaház Kft.') !== -1) {
    console.log('ℹ️  Teszt MEGOSZTOTT partner már létezik, kihagyva.');
    return;
  }

  sheet.appendRow([
    'Megosztott Irodaház Kft.',
    '22222222-2',
    '11111111-22222222-33333333',
    CONFIG.KATEGORIAK.MEGOSZTOTT,
    'iroda@megosztott.hu',
    '30',
    'IGEN',
    'TEST2601:50;FCA2601:30;ÁLTALÁNOS:20',
  ]);

  console.log('✓ Teszt MEGOSZTOTT partner hozzáadva (Allokációs sablon: TEST2601:50;FCA2601:30;ÁLTALÁNOS:20)');
}

/**
 * Gyors ellenőrzés: minden fül megvan-e, fejlécek helyesek-e.
 * Futtatás: Script Editor → verifySSOT → ▶ Run
 */
function verifySSOT() {
  console.log('══════════════════════════════════════');
  console.log('SSOT sheet ellenőrzés...');
  console.log('══════════════════════════════════════');

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  const expectedTabs = [
    { name: CONFIG.TABS.BEJOVO_SZAMLAK, cols: 23 },
    { name: CONFIG.TABS.SZAMLA_TETELEK, cols: 13 },
    { name: CONFIG.TABS.PROJEKTEK,      cols: 7  },
    { name: CONFIG.TABS.PARTNEREK,      cols: 8  },
    { name: CONFIG.TABS.KOTEGEK,        cols: 9  },
    { name: CONFIG.TABS.KIMENO_SZAMLAK, cols: 11 },
    { name: CONFIG.TABS.CONFIG,         cols: 3  },
    { name: CONFIG.TABS.ALLOKACIOK_TAB,     cols: 8  },
  ];

  let allOk = true;
  expectedTabs.forEach(function(t) {
    const sheet = ss.getSheetByName(t.name);
    if (!sheet) {
      console.log('✗ HIÁNYZIK: ' + t.name);
      allOk = false;
      return;
    }
    const actualCols = sheet.getLastColumn();
    const headersOk  = sheet.getRange('A1').getValue() !== '';
    const colsOk     = actualCols >= t.cols;

    if (headersOk && colsOk) {
      console.log('✓ ' + t.name + ' (' + actualCols + ' oszlop)');
    } else {
      console.log('⚠️  ' + t.name + ': fejléc=' + (headersOk ? 'OK' : 'HIÁNYZIK') +
        ', oszlopok=' + actualCols + ' (várt: ≥' + t.cols + ')');
      allOk = false;
    }
  });

  if (allOk) {
    console.log('══════════════════════════════════════');
    console.log('✅ SSOT sheet rendben — 8/8 fül OK');
  } else {
    console.log('══════════════════════════════════════');
    console.log('⚠️  Hibák találhatók — futtasd le: setupSSOT()');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHEET VÉDELEM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Levédi az SSOT sheet script-kritikus részeit.
 * Futtatás: setupSSOT() UTÁN, autobot@armadillo.hu fiókból.
 *
 * Amit védünk:
 *  - Minden rendszerfül fejléc sora (1. sor) — csak autobot@ szerkesztheti
 *  - BEJÖVŐ_SZÁMLÁK M, V, W oszlopok (script-managed: Drive File ID, Köteg ID, Gmail ID)
 *
 * Amit NEM védünk (Ági/Péter szerkeszti):
 *  - BEJÖVŐ_SZÁMLÁK Q (Státusz), R-T (jóváhagyás), U (utalás dátuma)
 *  - PROJEKTEK, PARTNEREK adatsorok
 *  - Extra fülek (pl. munkavállalók_NAV_rezsi) — nem tiltjuk, de dokumentáljuk
 *
 * Idempotens: meglévő védelmet nem duplikálja, hanem törli és újraírja.
 */
function protectSSOT() {
  console.log('════════════════════════════════════════');
  console.log('SSOT sheet védelem beállítása...');
  console.log('════════════════════════════════════════');

  if (!CONFIG.SPREADSHEET_ID) {
    throw new Error('CONFIG.SPREADSHEET_ID nincs beállítva!');
  }

  const ss        = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const autobot   = 'autobot@armadillo.hu';

  // Meglévő "Armadillo:" prefixű védelmek törlése (idempotencia)
  ss.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function(p) {
    if (p.getDescription().indexOf('Armadillo:') === 0) p.remove();
  });
  ss.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function(p) {
    if (p.getDescription().indexOf('Armadillo:') === 0) p.remove();
  });
  console.log('ℹ️  Korábbi Armadillo-védelmek törölve.');

  // ── 1. Fejléc sorok védelme (minden rendszerfül)
  const systemTabs = [
    CONFIG.TABS.BEJOVO_SZAMLAK,
    CONFIG.TABS.SZAMLA_TETELEK,
    CONFIG.TABS.PROJEKTEK,
    CONFIG.TABS.PARTNEREK,
    CONFIG.TABS.KOTEGEK,
    CONFIG.TABS.KIMENO_SZAMLAK,
    CONFIG.TABS.CONFIG,
    CONFIG.TABS.ALLOKACIOK_TAB,
  ];

  systemTabs.forEach(function(tabName) {
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      console.log('⚠️  Fül nem található, kihagyva: ' + tabName);
      return;
    }
    const lastCol    = Math.max(sheet.getLastColumn(), 1);
    const headerRange = sheet.getRange(1, 1, 1, lastCol);
    const protection  = headerRange.protect();
    protection.setDescription('Armadillo: fejléc — ' + tabName);

    // Mindenki szerkesztési jogát elvesszük, csak autobot@ marad
    protection.addEditor(autobot);
    const editors = protection.getEditors();
    editors.forEach(function(e) {
      if (e.getEmail() !== autobot) protection.removeEditor(e);
    });

    console.log('✓ Fejléc védve: ' + tabName + ' (1. sor, ' + lastCol + ' oszlop)');
  });

  // ── 2. Script-managed oszlopok védelme (BEJÖVŐ_SZÁMLÁK)
  const bejovo = ss.getSheetByName(CONFIG.TABS.BEJOVO_SZAMLAK);
  if (bejovo) {
    const lastRow = Math.max(bejovo.getMaxRows(), 1000);

    const scriptCols = [
      { col: CONFIG.COLS.BEJOVO.DRIVE_FILE_ID,    name: 'Drive File ID (M)'      },
      { col: CONFIG.COLS.BEJOVO.KOTEG_ID,          name: 'Köteg ID (V)'           },
      { col: CONFIG.COLS.BEJOVO.GMAIL_MESSAGE_ID,  name: 'Gmail Message ID (W)'   },
    ];

    scriptCols.forEach(function(c) {
      const range      = bejovo.getRange(2, c.col, lastRow - 1, 1);
      const protection = range.protect();
      protection.setDescription('Armadillo: script-managed — ' + c.name);
      protection.addEditor(autobot);
      const editors = protection.getEditors();
      editors.forEach(function(e) {
        if (e.getEmail() !== autobot) protection.removeEditor(e);
      });
      console.log('✓ Script-managed mező védve: ' + c.name);
    });
  }

  // ── 3. Warning-only védelem: CONFIG fül B oszlop (értékek — pl. ünnepnapok)
  //    Ági/Péter szerkesztheti, de figyelmeztető dialóg jelenik meg
  const configSheet = ss.getSheetByName(CONFIG.TABS.CONFIG);
  if (configSheet) {
    const lastRow    = Math.max(configSheet.getLastRow(), 10);
    const valueRange = configSheet.getRange(2, 2, lastRow - 1, 2); // B:C oszlop
    const protection = valueRange.protect();
    protection.setDescription('Armadillo: CONFIG értékek (B:C) — figyelmeztetés');
    protection.setWarningOnly(true);
    console.log('✓ CONFIG B:C oszlop: warning-only védelem beállítva');
  }

  // ── 4. Összefoglaló
  console.log('════════════════════════════════════════');
  console.log('✅ Védelmek beállítva. Összefoglaló:');
  console.log('   • 8 fejléc sor: csak autobot@ szerkesztheti');
  console.log('   • BEJÖVŐ_SZÁMLÁK M/V/W: csak autobot@ szerkesztheti');
  console.log('   • CONFIG B:C: warning-only (Péter/IT szerkesztheti)');
  console.log('   • Adatsorok: szabad (Ági/Péter munkája)');
  console.log('   • Extra fülek: engedélyezve (pl. munkavállalók_NAV_rezsi)');
  console.log('');
  console.log('⚠️  FONTOS — kommunikáld a csapatnak:');
  console.log('   • Rendszerfülek ÁTNEVEZÉSE tilos (eltöri a scripteket)');
  console.log('   • Rendszerfülekbe oszlop KÖZBESZÚRÁSA tilos');
  console.log('   • Extra fülöket hozzáadhatnak, de az SSOT-tól elkülönítve tartsák');
  console.log('════════════════════════════════════════');
}

/**
 * Listázza az aktív védelmi szabályokat — ellenőrzéshez.
 * Futtatás: Script Editor → listProtections → ▶ Run
 */
function listProtections() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  console.log('── Range védelmek ──');
  ss.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function(p) {
    console.log('[' + p.getDescription() + '] ' +
      p.getRange().getA1Notation() +
      (p.isWarningOnly() ? ' [warning-only]' : ' [strict]') +
      ' — szerkesztők: ' + p.getEditors().map(function(e) { return e.getEmail(); }).join(', '));
  });

  console.log('── Sheet védelmek ──');
  ss.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function(p) {
    console.log('[' + p.getDescription() + '] ' +
      (p.isWarningOnly() ? '[warning-only]' : '[strict]') +
      ' — szerkesztők: ' + p.getEditors().map(function(e) { return e.getEmail(); }).join(', '));
  });
}
