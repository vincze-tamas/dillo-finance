/**
 * BatchGenerator.gs
 * Armadillo Pénzügyi Automatizáció — MagNet CS-ÁTUTALÁS batch generálás
 *
 * Belépési pont: generateAndSaveBatch(pendingRows, utalasDate)
 *   → MagNet fixed-width .txt fájl generálása
 *   → Drive mentés (BATCHES_FOLDER / év / hónap)
 *   → KÖTEGEK fül frissítése
 *   → BEJÖVŐ_SZÁMLÁK V oszlop (KOTEG_ID) frissítése minden érintett sornál
 *   → Visszaadja { kotegId, osszesenHuf, driveUrl }
 *
 * ⚠️  FONTOS: A MagNet CS-ÁTUTALÁS fájlformátum az alábbi implementációban
 * a MagNet Business dokumentáció alapján készült.
 * Élesítés előtt KÖTELEZŐ ellenőrizni a MagNet aktuális specifikációja alapján!
 * Kapcsolat: MagNet Business ügyfélszolgálat vagy a banki API dokumentáció.
 *
 * Formátum összefoglaló:
 *   FEJ  (fejléc)  : 174 karakter, soronként 1 db
 *   TÉTEL (tételsor): 249 karakter, soronként 1 db per utalás
 *   LÁB  (zárás)   : 24  karakter, soronként 1 db
 * Karakterkódolás: UTF-8, sorvég: \r\n
 * Csak HUF devizájú számlák kerülnek a kötegbe — a többi külön figyelmeztetéssel.
 */

// ─────────────────────────────────────────────────────────────────────────────
// KONSTANSOK
// ─────────────────────────────────────────────────────────────────────────────

const MAGNET_FEJ_LEN   = 174;
const MAGNET_TETEL_LEN = 249;
const MAGNET_LAB_LEN   = 24;
const MAGNET_CRLF      = '\r\n';

// ─────────────────────────────────────────────────────────────────────────────
// FŐ BELÉPÉSI PONT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generálja a MagNet batch fájlt és menti Drive-ra.
 * WednesdayWorkflow.gs hívja.
 *
 * @param {Array}  pendingRows  - _loadPendingInvoices_() által visszaadott tömb
 * @param {Date}   utalasDate   - Tervezett utalási nap (getNextWorkday() által számolva)
 * @returns {{ kotegId: string, osszesenHuf: number, driveUrl: string }|null}
 */
function generateAndSaveBatch(pendingRows, utalasDate) {
  console.log('BatchGenerator: indítás, ' + pendingRows.length + ' számla, ' +
    'utalás: ' + formatDate(utalasDate));

  // ── 1. Szűrés: csak HUF, csak bankszámlaszámmal rendelkező sorok
  const hufRows    = pendingRows.filter(function(r) { return r.deviza === 'HUF'; });
  const nonHufRows = pendingRows.filter(function(r) { return r.deviza !== 'HUF'; });
  const missingBankRows = hufRows.filter(function(r) { return !r.bankszamla; });
  const validRows  = hufRows.filter(function(r) { return !!r.bankszamla; });

  if (nonHufRows.length > 0) {
    console.warn('⚠️  ' + nonHufRows.length + ' nem-HUF számla kihagyva a kötegből:');
    nonHufRows.forEach(function(r) {
      console.warn('   → ' + r.szamlaId + ' ' + r.szallitoNev + ' ' + r.osszeg + ' ' + r.deviza);
    });
    notifyAdmin(
      'Batch: nem-HUF számlák kihagyva',
      nonHufRows.map(function(r) {
        return r.szamlaId + ' | ' + r.szallitoNev + ' | ' + r.osszeg + ' ' + r.deviza;
      }).join('\n')
    );
  }

  if (missingBankRows.length > 0) {
    console.warn('⚠️  ' + missingBankRows.length + ' számla kihagyva (hiányzó bankszámlaszám):');
    missingBankRows.forEach(function(r) {
      console.warn('   → ' + r.szamlaId + ' ' + r.szallitoNev);
    });
    notifyAdmin(
      'Batch: hiányzó bankszámlaszám',
      missingBankRows.map(function(r) {
        return r.szamlaId + ' | ' + r.szallitoNev + ' | adószám: ' + r.adoszam;
      }).join('\n')
    );
  }

  if (validRows.length === 0) {
    console.log('Nincs érvényes (HUF + bankszámlaszámmal rendelkező) sor — batch kihagyva.');
    return null;
  }

  // ── 2. Köteg ID + összesítés
  const kotegId     = generateId('KOTEG');
  const osszesenHuf = validRows.reduce(function(sum, r) { return sum + r.osszeg; }, 0);
  const sendingAccount = _getSendingAccount_();

  console.log('Köteg ID: ' + kotegId);
  console.log('Érvényes sorok: ' + validRows.length + ' db, összesen: ' + osszesenHuf + ' HUF');

  // ── 3. MagNet .txt tartalom generálása
  let content;
  try {
    content = _buildMagnetContent_(validRows, utalasDate, sendingAccount, kotegId);
  } catch (buildErr) {
    console.error('Batch tartalom generálás hiba: ' + buildErr.message);
    notifyAdmin('Batch generálás hiba', buildErr.message, buildErr);
    return null;
  }

  // ── 4. Drive mentés
  let driveUrl;
  let driveFileId;
  try {
    const saved = withRetry(function() {
      return _saveBatchToDrive_(content, kotegId, utalasDate);
    }, 3, 10000);
    driveUrl   = saved.fileUrl;
    driveFileId= saved.fileId;
    console.log('Drive mentés kész: ' + driveUrl);
  } catch (driveErr) {
    console.error('Batch Drive mentés hiba: ' + driveErr.message);
    notifyAdmin('Batch Drive mentés hiba', driveErr.message, driveErr);
    return null;
  }

  // ── 5. SSOT frissítés (LockService)
  try {
    _updateSSOT_(kotegId, validRows, osszesenHuf, utalasDate, driveFileId, driveUrl);
  } catch (ssotErr) {
    // SSOT frissítés hiba nem kritikus — a fájl már Drive-on van
    console.error('SSOT frissítés hiba (nem kritikus): ' + ssotErr.message);
    notifyAdmin('Batch SSOT frissítés hiba', ssotErr.message, ssotErr);
  }

  return { kotegId: kotegId, osszesenHuf: osszesenHuf, driveUrl: driveUrl };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAGNET FÁJL TARTALOM GENERÁLÁS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Összeállítja a teljes MagNet CS-ÁTUTALÁS fájl tartalmát.
 * @param {Array}  rows
 * @param {Date}   utalasDate
 * @param {string} sendingAccount  - Armadillo bankszámlaszáma
 * @param {string} kotegId
 * @returns {string}
 */
function _buildMagnetContent_(rows, utalasDate, sendingAccount, kotegId) {
  const osszesenHuf = rows.reduce(function(s, r) { return s + r.osszeg; }, 0);
  const dateStr     = formatDate(utalasDate).replace(/-/g, ''); // YYYYMMDD
  const todayStr    = formatDate(new Date()).replace(/-/g, '');

  const lines = [];

  // ── FEJ (fejléc) sor
  lines.push(_buildFejRecord_(
    sendingAccount, todayStr, dateStr, rows.length, osszesenHuf, kotegId
  ));

  // ── TÉTEL sorok
  rows.forEach(function(r, idx) {
    lines.push(_buildTetelRecord_(r, idx + 1));
  });

  // ── LÁB (záró) sor
  lines.push(_buildLabRecord_(rows.length, osszesenHuf));

  return lines.join(MAGNET_CRLF) + MAGNET_CRLF;
}

/**
 * FEJ rekord — 174 karakter.
 * ⚠️ Mezőpozíciókat a MagNet CS-ÁTUTALÁS specifikáció alapján kell ellenőrizni!
 */
function _buildFejRecord_(sendingAccount, megbizoDate, utalasDate,
                           itemCount, totalAmount, kotegId) {
  const clean = sendingAccount.replace(/[^0-9]/g, ''); // csak számok
  let rec = '';
  rec += _pad_('T',                    1,  'L', ' ');  // [1]     Rekord típus
  rec += _pad_(clean,                  16, 'R', '0');  // [2-17]  Megbízó számlaszám
  rec += _pad_(megbizoDate,            8,  'L', ' ');  // [18-25] Megbízás dátuma YYYYMMDD
  rec += _pad_(utalasDate,             8,  'L', ' ');  // [26-33] Teljesítés napja YYYYMMDD
  rec += _pad_('K',                    1,  'L', ' ');  // [34]    Köteg típus (K=csoportos)
  rec += _pad_(kotegId.slice(-6),      6,  'R', '0');  // [35-40] Köteg sorszám
  rec += _pad_(String(itemCount),      6,  'R', '0');  // [41-46] Tételek száma
  rec += _pad_(String(Math.round(totalAmount)), 15, 'R', '0'); // [47-61] Összeg — ⚠️ ELLENŐRZENDŐ: jelenlegi impl. FORINTBAN számolja (fillér nélkül). Ha MagNet FILLÉRT vár, megszorozni 100-zal!
  rec += _pad_('',                     MAGNET_FEJ_LEN - rec.length, 'L', ' '); // kitöltés

  _assertLength_(rec, MAGNET_FEJ_LEN, 'FEJ');
  return rec;
}

/**
 * TÉTEL rekord — 249 karakter per utalás.
 * ⚠️ Mezőpozíciókat a MagNet CS-ÁTUTALÁS specifikáció alapján kell ellenőrizni!
 */
function _buildTetelRecord_(row, sorszam) {
  const bankClean = row.bankszamla.replace(/[^0-9]/g, '');
  const nev       = asciiTranslit(row.szallitoNev).substring(0, 70);
  const kozlemeny = asciiTranslit(row.szamlaszam).substring(0, 35);
  const osszeg    = Math.round(row.osszeg); // ⚠️ ELLENŐRZENDŐ: FORINTBAN (fillér nélkül). Ha MagNet FILLÉRT vár: row.osszeg * 100

  let rec = '';
  rec += _pad_('2',          1,  'L', ' ');  // [1]      Rekord típus
  rec += _pad_(bankClean,    16, 'R', '0');  // [2-17]   Kedvezményezett számlaszám
  rec += _pad_(nev,          70, 'L', ' ');  // [18-87]  Kedvezményezett neve
  rec += _pad_(String(osszeg), 15, 'R', '0'); // [88-102] Összeg
  rec += _pad_(kozlemeny,    35, 'L', ' ');  // [103-137] Közlemény (számlaszám)
  rec += _pad_('',           MAGNET_TETEL_LEN - rec.length, 'L', ' '); // kitöltés

  _assertLength_(rec, MAGNET_TETEL_LEN, 'TÉTEL[' + sorszam + ']');
  return rec;
}

/**
 * LÁB rekord — 24 karakter.
 * ⚠️ Mezőpozíciókat a MagNet CS-ÁTUTALÁS specifikáció alapján kell ellenőrizni!
 */
function _buildLabRecord_(itemCount, totalAmount) {
  let rec = '';
  rec += _pad_('9',                    1,  'L', ' ');  // [1]    Rekord típus
  rec += _pad_(String(itemCount),      6,  'R', '0');  // [2-7]  Tételek száma
  rec += _pad_(String(Math.round(totalAmount)), 15, 'R', '0'); // [8-22] Összeg — ⚠️ ELLENŐRZENDŐ: forint vagy fillér (ld. FEJ rekord komment)
  rec += _pad_('',                     MAGNET_LAB_LEN - rec.length, 'L', ' '); // kitöltés

  _assertLength_(rec, MAGNET_LAB_LEN, 'LÁB');
  return rec;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXED-WIDTH SEGÉDFÜGGVÉNYEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adott hosszra vágja/padolja a stringet.
 * @param {string} val
 * @param {number} len    - Elvárt hossz
 * @param {string} align  - 'L' = balra igazít (jobbról padding), 'R' = jobbra igazít
 * @param {string} padCh  - Padding karakter (' ' vagy '0')
 * @returns {string}
 */
function _pad_(val, len, align, padCh) {
  let s = String(val || '').substring(0, len); // vágás ha hosszabb
  while (s.length < len) {
    s = (align === 'R') ? (padCh + s) : (s + padCh);
  }
  return s;
}

/**
 * Ellenőrzi, hogy a rekord pontosan a várt hosszúságú-e.
 * Fejlesztői hiba esetén exception-t dob, nem silent fail.
 */
function _assertLength_(rec, expected, label) {
  if (rec.length !== expected) {
    throw new Error('MagNet formátum hiba: ' + label + ' rekord hossza ' +
      rec.length + ' (várt: ' + expected + ')');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIVE MENTÉS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Elmenti a batch .txt fájlt a Drive-ra.
 * Mappa: BATCHES_FOLDER / 2026 / 04_Április /
 * Fájlnév: KOTEG-20260408-XXXX_utalas20260409.txt
 * @param {string} content
 * @param {string} kotegId
 * @param {Date}   utalasDate
 * @returns {{ fileId: string, fileUrl: string }}
 */
function _saveBatchToDrive_(content, kotegId, utalasDate) {
  const rootFolder  = DriveApp.getFolderById(CONFIG.BATCHES_FOLDER_ID);
  const yearFolder  = _getOrCreateBatchSubfolder_(rootFolder, String(utalasDate.getFullYear()));
  const monthFolder = _getOrCreateBatchSubfolder_(yearFolder, hungarianMonth(utalasDate));

  const fileName = kotegId + '_utalas' +
    formatDate(utalasDate).replace(/-/g, '') + '.txt';

  const blob = Utilities.newBlob(content, 'text/plain', fileName);
  const file = monthFolder.createFile(blob);

  return { fileId: file.getId(), fileUrl: file.getUrl() };
}

function _getOrCreateBatchSubfolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// ─────────────────────────────────────────────────────────────────────────────
// SSOT FRISSÍTÉS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LockService tranzakcióban:
 *  1. KÖTEGEK fülre új sort ír
 *  2. BEJÖVŐ_SZÁMLÁK V oszlopát (KOTEG_ID) frissíti minden érintett sornál
 *
 * @param {string} kotegId
 * @param {Array}  rows         - validRows (rowIndex mezővel)
 * @param {number} osszesenHuf
 * @param {Date}   utalasDate
 * @param {string} driveFileId
 * @param {string} driveUrl
 */
function _updateSSOT_(kotegId, rows, osszesenHuf, utalasDate, driveFileId, driveUrl) {
  const ss   = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const lock = acquireLock();

  // Audit tételek gyűjtése — a lockon KÍVÜL írjuk a logot
  const auditItems = [];

  try {
    // ── KÖTEGEK új sor
    const kotegSheet = ss.getSheetByName(CONFIG.TABS.KOTEGEK);
    kotegSheet.appendRow([
      kotegId,                    // A Köteg ID
      formatDate(new Date()),     // B Létrehozás dátuma
      formatDate(utalasDate),     // C Utalási dátum
      rows.length,                // D Számlák száma
      osszesenHuf,                // E Összeg (HUF)
      'NYITOTT',                  // F Státusz — Péter állítja LEZÁRT/FELTÖLTVE-re MagNet feltöltés után
      driveFileId,                // G Drive File ID
      driveUrl,                   // H Drive URL
      'NEM',                      // I MagNet feltöltve (Péter tölti fel manuálisan)
    ]);

    // ── BEJÖVŐ_SZÁMLÁK V oszlop (KOTEG_ID) frissítése
    // Hard guardrail: csak üres KOTEG_ID-t írunk felül — soha nem törlünk, soha nem írunk felül
    const bejovSheet = ss.getSheetByName(CONFIG.TABS.BEJOVO_SZAMLAK);
    rows.forEach(function(r) {
      const existing = String(
        bejovSheet.getRange(r.rowIndex, CONFIG.COLS.BEJOVO.KOTEG_ID).getValue() || ''
      ).trim();
      if (existing !== '') {
        // Ez nem fordulhat elő (_loadPendingInvoices_ már kiszűrte), de double-check
        console.error('GUARDRAIL: ' + r.szamlaId + ' már rendelkezik KOTEG_ID-vel (' +
          existing + ') — kihagyva, nem írjuk felül!');
        notifyAdmin(
          'GUARDRAIL: duplikált batch kísérlet',
          r.szamlaId + ' | ' + r.szallitoNev + ' | meglévő KOTEG_ID: ' + existing
        );
        return;
      }
      bejovSheet.getRange(r.rowIndex, CONFIG.COLS.BEJOVO.KOTEG_ID).setValue(kotegId);
      // Összegyűjtjük — a lockon kívül írjuk az audit logba
      auditItems.push(r.szamlaId);
    });

    console.log('SSOT frissítve: KÖTEGEK + ' + rows.length + ' BEJÖVŐ_SZÁMLÁK sor');

  } finally {
    lock.releaseLock();
  }

  // Audit a lockon KÍVÜL — minden sikeresen batch-be rendelt számlához 1 sor
  auditItems.forEach(function(szamlaId) {
    logAuditScript_('BATCH_ASSIGNED', szamlaId, 'KOTEG_ID', '', kotegId);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// KÜLDŐ SZÁMLASZÁM LEKÉRÉS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lekéri az Armadillo bankszámlaszámát a CONFIG fülről.
 * CONFIG kulcs: 'ARMADILLO_BANKSZAMLA'
 * Ha nincs beállítva → hibát dob.
 * @returns {string}
 */
function _getSendingAccount_() {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.TABS.CONFIG);
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === 'ARMADILLO_BANKSZAMLA') {
      const val = String(data[i][1] || '').trim();
      if (val) return val;
    }
  }
  throw new Error('ARMADILLO_BANKSZAMLA nincs beállítva a CONFIG fülön! ' +
    'Adj hozzá egy sort: A=ARMADILLO_BANKSZAMLA, B=számlaszám (pl. 16200223-10056789-00000000)');
}

// ─────────────────────────────────────────────────────────────────────────────
// TESZTELŐ FÜGGVÉNYEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MagNet fájlformátum tesztelése valódi adatok nélkül.
 * Ellenőrzi a rekord hosszakat és a padding logikát.
 * Futtatás: Script Editor → testBatchFormat → ▶ Run
 */
function testBatchFormat() {
  console.log('MagNet CS-ÁTUTALÁS formátum teszt...');

  const testRows = [
    {
      szamlaId:    'INV-TEST-001',
      szallitoNev: 'Teszt Szállító Kft.',
      adoszam:     '12345678-2-41',
      szamlaszam:  'TSZ-2026/042',
      osszeg:      127000,
      deviza:      'HUF',
      fizhatarido: '2026-05-08',
      bankszamla:  '11111111-22222222-33333333',
      rowIndex:    2,
    },
    {
      szamlaId:    'INV-TEST-002',
      szallitoNev: 'Árvíztűrő Fúrógép Bt.',
      adoszam:     '87654321-2-13',
      szamlaszam:  'AFB/2026/17',
      osszeg:      85000,
      deviza:      'HUF',
      fizhatarido: '2026-04-30',
      bankszamla:  '44444444-55555555-66666666',
      rowIndex:    3,
    },
  ];

  const utalasDate    = new Date(2026, 3, 15); // 2026-04-15
  const sendingAccount= '16200223-10056789-00000000';
  const kotegId       = 'KOTEG-TEST-001';

  try {
    const content = _buildMagnetContent_(testRows, utalasDate, sendingAccount, kotegId);
    const lines   = content.split(MAGNET_CRLF).filter(function(l) { return l.length > 0; });

    console.log('Sorok száma: ' + lines.length + ' (várt: ' + (testRows.length + 2) + ')');
    lines.forEach(function(line, i) {
      const label = i === 0 ? 'FEJ' : (i === lines.length - 1 ? 'LÁB' : 'TÉTEL[' + i + ']');
      const expected = i === 0 ? MAGNET_FEJ_LEN :
                       (i === lines.length - 1 ? MAGNET_LAB_LEN : MAGNET_TETEL_LEN);
      const ok = line.length === expected;
      console.log(label + ': ' + line.length + ' kar ' + (ok ? '✓' : '✗ HIBA (várt: ' + expected + ')'));
      console.log('  → "' + line.substring(0, 60) + (line.length > 60 ? '...' : '') + '"');
    });

    console.log('✅ Formátum teszt kész');
  } catch (e) {
    console.error('✗ Formátum teszt HIBA: ' + e.message);
  }
}

/**
 * Padding segédfüggvény tesztelése.
 * Futtatás: Script Editor → testPadFunction → ▶ Run
 */
function testPadFunction() {
  const cases = [
    { val: 'ABC',    len: 10, align: 'L', pad: ' ', expected: 'ABC       ' },
    { val: 'ABC',    len: 10, align: 'R', pad: ' ', expected: '       ABC' },
    { val: '123',    len: 8,  align: 'R', pad: '0', expected: '00000123'  },
    { val: 'TOOLONG',len: 4,  align: 'L', pad: ' ', expected: 'TOOL'      },
    { val: '',       len: 5,  align: 'L', pad: ' ', expected: '     '     },
  ];
  let allOk = true;
  cases.forEach(function(c) {
    const result = _pad_(c.val, c.len, c.align, c.pad);
    const ok = result === c.expected;
    if (!ok) allOk = false;
    console.log('_pad_("' + c.val + '", ' + c.len + ', "' + c.align + '", "' + c.pad + '"): ' +
      '"' + result + '" ' + (ok ? '✓' : '✗ várt: "' + c.expected + '"'));
  });
  console.log(allOk ? '✅ Minden padding teszt OK' : '✗ Hibák találhatók!');
}
