/**
 * BatchGenerator.gs
 * Armadillo Pénzügyi Automatizáció — MagNet CS-ÁTUTALÁS batch generálás
 *
 * Belépési pont: generateAndSaveBatch(pendingRows, utalasDate)
 *   → MagNet GIRO CSÁT.121 fixed-width .txt fájl generálása
 *   → Drive mentés (BATCHES_FOLDER / év / hónap)
 *   → KÖTEGEK fül frissítése
 *   → BEJÖVŐ_SZÁMLÁK V oszlop (KOTEG_ID) frissítése minden érintett sornál
 *   → Visszaadja { kotegId, osszesenHuf, driveUrl }
 *
 * ── GIRO CSÁT.121 FORMÁTUM (MagNet NetBank kézikönyv, 2025.08.12., §14.1.5) ──
 *   FEJ  (01): 174 karakter — IBM 852 ékezetes karaktert tartalmazhat
 *   TÉTEL (02): 249 karakter — IBM 852 ékezetes karaktert tartalmazhat
 *   LÁB  (03): 24  karakter — ékezetes karakter NEM tartalmazhat
 *   Sorvég: \r\n
 *
 * Kódolás megjegyzés: asciiTranslit() eltávolítja az ékezeteket → tiszta ASCII
 * (az ASCII az IBM 852 részhalmaza, így a fájl IBM 852 kompatibilis marad).
 *
 * Szükséges CONFIG fül kulcsok a SSOT sheet-ben:
 *   ARMADILLO_BANKSZAMLA  — cég bankszámlaszáma (pl. "16200234-10056789-00000000")
 *   ARMADILLO_ADOSZAM     — cég adószáma (pl. "12345678-2-41" vagy "12345678241")
 *   ARMADILLO_CEG_NEV     — cég neve (max 35 karakter)
 *   MAGNET_JOGCIM         — 3 karakteres jogcím kód (P9 feladat, pl. "K  ")
 */

// ─────────────────────────────────────────────────────────────────────────────
// KONSTANSOK
// ─────────────────────────────────────────────────────────────────────────────

const MAGNET_FEJ_LEN   = 174;
const MAGNET_TETEL_LEN = 249;
const MAGNET_LAB_LEN   = 24;
const MAGNET_CRLF      = '\r\n';

/**
 * Összeg konvertálása MagNet TÉTEL formátumba.
 * A GIRO CSÁT.121 spec (T213) szerint: "csak Ft, tizedesrész nem használható"
 * → BATCH_AMOUNT_UNIT: 'HUF' (forint) — CONFIRMED a spec alapján.
 * 'FILLER' ág megtartva, ha valaha mégis fillér kellene (nem várható).
 * @param {number} forintAmount
 * @returns {number}
 */
function _amountToMagnet_(forintAmount) {
  const rounded = Math.round(forintAmount);
  return CONFIG.BATCH_AMOUNT_UNIT === 'FILLER' ? rounded * 100 : rounded;
}

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
  const hufRows         = pendingRows.filter(function(r) { return r.deviza === 'HUF'; });
  const nonHufRows      = pendingRows.filter(function(r) { return r.deviza !== 'HUF'; });
  const missingBankRows = hufRows.filter(function(r) { return !r.bankszamla; });
  const validRows       = hufRows.filter(function(r) { return !!r.bankszamla; });

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

  // ── 2. Köteg ID + összesítés + sender info
  const kotegId     = generateId('KOTEG');
  const osszesenHuf = validRows.reduce(function(sum, r) { return sum + r.osszeg; }, 0);

  let senderInfo;
  try {
    senderInfo = _getSenderInfo_();
  } catch (configErr) {
    console.error('Sender info hiba: ' + configErr.message);
    notifyAdmin('Batch: hiányzó konfiguráció', configErr.message);
    return null;
  }

  console.log('Köteg ID: ' + kotegId);
  console.log('Érvényes sorok: ' + validRows.length + ' db, összesen: ' + osszesenHuf + ' Ft');
  console.log('Jogcím: ' + senderInfo.jogcim + ' | Bankszerv: ' + senderInfo.bankszerv);

  // ── 3. MagNet .txt tartalom generálása
  let content;
  try {
    content = _buildMagnetContent_(validRows, utalasDate, senderInfo, kotegId);
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
    driveUrl    = saved.fileUrl;
    driveFileId = saved.fileId;
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
// MAGNET GIRO CSÁT.121 FÁJL TARTALOM GENERÁLÁS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Összeállítja a teljes GIRO CSÁT.121 fájl tartalmát.
 * @param {Array}      rows
 * @param {Date}       utalasDate
 * @param {Object}     senderInfo   - _getSenderInfo_() output
 * @param {string}     kotegId
 * @returns {string}
 */
function _buildMagnetContent_(rows, utalasDate, senderInfo, kotegId) {
  const utalasDateStr = formatDate(utalasDate).replace(/-/g, ''); // YYYYMMDD
  const todayStr      = formatDate(new Date()).replace(/-/g, '');
  const sorszam       = '0001'; // Napi sorrend — egy batch/nap esetén mindig 0001

  const lines = [];

  // ── 01 FEJ (fejléc)
  lines.push(_buildFejRecord_(senderInfo, todayStr, utalasDateStr, sorszam,
                               rows.length, rows.reduce(function(s, r) { return s + r.osszeg; }, 0)));

  // ── 02 TÉTEL sorok (tételssorszám: 1, 2, 3, …)
  rows.forEach(function(r, idx) {
    lines.push(_buildTetelRecord_(r, idx + 1));
  });

  // ── 03 LÁB (zárás)
  lines.push(_buildLabRecord_(rows.length,
                               rows.reduce(function(s, r) { return s + r.osszeg; }, 0)));

  return lines.join(MAGNET_CRLF) + MAGNET_CRLF;
}

// ─────────────────────────────────────────────────────────────────────────────
// GIRO CSÁT.121 REKORD GENERÁTOROK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 01 FEJ rekord — 174 karakter.
 * GIRO CSÁT.121 specifikáció (MagNet NetBank kézikönyv §14.1.5):
 *
 *  [1-2]    F210 rekordtípus           N  2  "01"
 *  [3-8]    F211 üzenettípus           A  6  "ATUTAL"
 *  [9]      F212 duplum-kód            AN 1  "0" (nem aznapi; "@" = aznapi terhelés)
 *  [10-22]  F213 kezdeményező azonosítója AN 13  adószám (Aaaaaaaa[Tttt]) — balra igazítva
 *  [23-30]  F214.1 összeállítás dátuma N  8  ÉÉÉÉHHNN
 *  [31-34]  F214.2 sorszám             N  4  napi sorrend (alapért. "0001")
 *  [35-42]  F215.1 bankszerv           N  8  bbbffffΔ (bankkód + fiókkód + CDV)
 *  [43-58]  F215.2 számlaszám          N  16 (8 jegyűnél: balra + szóköz)
 *  [59-66]  F216** terhelés dátuma     N  8  ÉÉÉÉHHNN (= utalás napja)
 *  [67-69]  F217 jogcím                A  3  MAGNET_JOGCIM config kulcs (P9 feladat)
 *  [70-104] F218 kezdeményező cég neve AN 35 (első 32 karakter jut el)
 *  [105-174] F219** közlemény          AN 70 (FEJ szintű, üres maradhat)
 */
function _buildFejRecord_(senderInfo, todayStr, utalasDateStr, sorszam, itemCount, totalAmount) {
  // Adószám: strip dashes, left-align in 13 chars (space-padded right)
  const adoszamClean = senderInfo.adoszam.replace(/[^0-9]/g, '');
  const adoszamPad   = _pad_(adoszamClean, 13, 'L', ' ');

  // Számlaszám: 8-jegyűnél balra igazítva + szóközzel; 16-jegyűnél zero-padded jobbra
  const szamlaszamFmt = _formatSzamlaszam_(senderInfo.szamlaszam);

  let rec = '';
  rec += _pad_('01',                     2,  'L', ' ');  // F210 [1-2]    rekordtípus
  rec += _pad_('ATUTAL',                 6,  'L', ' ');  // F211 [3-8]    üzenettípus
  rec += _pad_('0',                      1,  'L', ' ');  // F212 [9]      duplum-kód
  rec += adoszamPad;                                      // F213 [10-22]  13 char
  rec += _pad_(todayStr,                 8,  'L', ' ');  // F214.1 [23-30] összeállítás dátuma
  rec += _pad_(sorszam,                  4,  'R', '0');  // F214.2 [31-34] sorszám
  rec += _pad_(senderInfo.bankszerv,     8,  'L', ' ');  // F215.1 [35-42] bankszerv
  rec += szamlaszamFmt;                                   // F215.2 [43-58] számlaszám 16 char
  rec += _pad_(utalasDateStr,            8,  'L', ' ');  // F216   [59-66] terhelés dátuma
  rec += _pad_(senderInfo.jogcim,        3,  'L', ' ');  // F217   [67-69] jogcím (3 char)
  rec += _pad_(senderInfo.cegNev,       35,  'L', ' ');  // F218   [70-104] cég neve
  rec += _pad_('',                      70,  'L', ' ');  // F219   [105-174] közlemény (üres)

  _assertLength_(rec, MAGNET_FEJ_LEN, 'FEJ');
  return rec;
}

/**
 * 02 TÉTEL rekord — 249 karakter.
 * GIRO CSÁT.121 specifikáció (MagNet NetBank kézikönyv §14.1.5):
 *
 *  [1-2]    T210 rekordtípus               N  2  "02"
 *  [3-8]    T211 tételssorszám              N  6  egyedi a FEJ-en belül (bázisazonosító: F213+F214+T211)
 *  [9-16]   T212 fenntartott terület        N  8  spaces (tömeges átutalásnál: értéknap)
 *  [17-26]  T213 összeg                     N  10 csak Ft! (tizedesrész nincs) — BATCH_AMOUNT_UNIT=HUF CONFIRMED
 *  [27-34]  T214.1 bankszerv                N  8  bbbffffΔ
 *  [35-50]  T214.2 számlaszám               N  16 (8 jegyűnél: balra + szóköz)
 *  [51-74]  T215 ügyfél-azonosító           AN 24 (balra igazítva, jobbra szóközzel)
 *  [75-109] T216 az ügyfél neve             AN 35 V (első 32 karakter jut el)
 *  [110-144] T217 az ügyfél címe            AN 35 V (üres maradhat)
 *  [145-179] T218 számlatulajdonos neve     AN 35 K (első 32 karakter jut el) — ellenpartner neve
 *  [180-249] T219 közlemény                 AN 70 V (csak az első 18 karakter effektív!)
 */
function _buildTetelRecord_(row, sorszam) {
  const benef           = _splitBankAccount_(row.bankszamla);
  const szamlaszamFmt   = _formatSzamlaszam_(benef.szamlaszam);
  const nev             = asciiTranslit(row.szallitoNev || '').substring(0, 35);
  // T219 közlemény: csak az első 18 karakter effektív → max 18 char tartalom
  const kozlemeny18     = asciiTranslit(row.szamlaszam || '').substring(0, 18);
  // T215 ügyfél-azonosító: szamlaId balra igazítva, jobbra szóközzel töltve
  const azonosito       = String(row.szamlaId || '').substring(0, 24);
  // T213 összeg: forint (CONFIRMED), 10 char, jobbra igazítva, nullával töltve
  const osszeg          = _amountToMagnet_(row.osszeg);

  let rec = '';
  rec += _pad_('02',              2,  'L', ' ');  // T210 [1-2]
  rec += _pad_(String(sorszam),   6,  'R', '0');  // T211 [3-8]    tételssorszám
  rec += _pad_('',                8,  'L', ' ');  // T212 [9-16]   fenntartott (spaces)
  rec += _pad_(String(osszeg),   10,  'R', '0');  // T213 [17-26]  összeg Ft (10 char!)
  rec += _pad_(benef.bankszerv,   8,  'L', ' ');  // T214.1 [27-34] bankszerv
  rec += szamlaszamFmt;                            // T214.2 [35-50] számlaszám 16 char
  rec += _pad_(azonosito,        24,  'L', ' ');  // T215 [51-74]  ügyfél-azonosító
  rec += _pad_(nev,              35,  'L', ' ');  // T216 [75-109] ügyfél neve
  rec += _pad_('',               35,  'L', ' ');  // T217 [110-144] cím (üres)
  rec += _pad_(nev,              35,  'L', ' ');  // T218 [145-179] számlatulajdonos neve
  rec += _pad_(kozlemeny18,      70,  'L', ' ');  // T219 [180-249] közlemény (18 effektív!)

  _assertLength_(rec, MAGNET_TETEL_LEN, 'TÉTEL[' + sorszam + ']');
  return rec;
}

/**
 * 03 LÁB rekord — 24 karakter.
 * GIRO CSÁT.121 specifikáció (MagNet NetBank kézikönyv §14.1.5):
 *
 *  [1-2]  Z210 rekordtípus   N  2  "03"
 *  [3-8]  Z211 tételek száma N  6  a TÉTEL rekordok száma
 *  [9-24] Z212 összértéke    N  16 Ft (tizedesrész nincs) — 16 CHAR!
 */
function _buildLabRecord_(itemCount, totalAmount) {
  let rec = '';
  rec += _pad_('03',                     2,  'L', ' ');  // Z210 [1-2]
  rec += _pad_(String(itemCount),        6,  'R', '0');  // Z211 [3-8]
  rec += _pad_(String(_amountToMagnet_(totalAmount)), 16, 'R', '0'); // Z212 [9-24] 16 char!

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
 * Számlaszám (F215.2 / T214.2) formázása 16 karakterre.
 * A spec szerint:
 *   - 8 jegyű számlaszámnál: balra igazítva, jobbról szóközzel töltve
 *   - 16 jegyű számlaszámnál: jobbra igazítva, balról nullával töltve (normál)
 * @param {string} szamlaszam - a bankszámlaszám bankszerv utáni része (tipikusan 16 char)
 * @returns {string} - pontosan 16 karakter
 */
function _formatSzamlaszam_(szamlaszam) {
  const s = String(szamlaszam || '');
  // 8 jegyű: balra igazítva + szóköz
  if (s.length <= 8) return _pad_(s, 16, 'L', ' ');
  // 16 jegyű (standard): jobbra igazítva + zero (vagy egyszerűen az első 16 char)
  return _pad_(s, 16, 'R', '0');
}

/**
 * Ellenőrzi, hogy a rekord pontosan a várt hosszúságú-e.
 * Fejlesztői hiba esetén exception-t dob, nem silent fail.
 */
function _assertLength_(rec, expected, label) {
  if (rec.length !== expected) {
    throw new Error('MagNet GIRO formátum hiba: ' + label + ' rekord hossza ' +
      rec.length + ' (várt: ' + expected + ')');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIVE MENTÉS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Elmenti a batch .txt fájlt a Drive-ra.
 * Mappa: BATCHES_FOLDER / 2026 / 04_Április /
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
 */
function _updateSSOT_(kotegId, rows, osszesenHuf, utalasDate, driveFileId, driveUrl) {
  const ss   = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const lock = acquireLock();
  const auditItems = [];

  try {
    const kotegSheet = ss.getSheetByName(CONFIG.TABS.KOTEGEK);
    kotegSheet.appendRow([
      kotegId,
      formatDate(new Date()),
      formatDate(utalasDate),
      rows.length,
      osszesenHuf,
      'NYITOTT',
      driveFileId,
      driveUrl,
      'NEM',
    ]);

    const bejovSheet = ss.getSheetByName(CONFIG.TABS.BEJOVO_SZAMLAK);
    rows.forEach(function(r) {
      const existing = String(
        bejovSheet.getRange(r.rowIndex, CONFIG.COLS.BEJOVO.KOTEG_ID).getValue() || ''
      ).trim();
      if (existing !== '') {
        console.error('GUARDRAIL: ' + r.szamlaId + ' már rendelkezik KOTEG_ID-vel (' +
          existing + ') — kihagyva!');
        notifyAdmin('GUARDRAIL: duplikált batch kísérlet',
          r.szamlaId + ' | ' + r.szallitoNev + ' | meglévő: ' + existing);
        return;
      }
      bejovSheet.getRange(r.rowIndex, CONFIG.COLS.BEJOVO.KOTEG_ID).setValue(kotegId);
      auditItems.push(r.szamlaId);
    });

    console.log('SSOT frissítve: KÖTEGEK + ' + rows.length + ' BEJÖVŐ_SZÁMLÁK sor');
  } finally {
    lock.releaseLock();
  }

  auditItems.forEach(function(szamlaId) {
    logAuditScript_(AUDIT_MUVELET.KOTEG_HOZZARENDELVE, AUDIT_ENTITAS.SZAMLA,
      szamlaId, 'KOTEG_ID', '', kotegId);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SENDER INFO — FEJ SZINTŰ ADATOK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lekéri a FEJ rekordhoz szükséges küldő adatokat a CONFIG fülről.
 *
 * Szükséges CONFIG fül sorok (A oszlop = kulcs, B oszlop = érték):
 *   ARMADILLO_BANKSZAMLA  → pl. "16200234-10056789-00000000"
 *   ARMADILLO_ADOSZAM     → pl. "12345678-2-41" (dashes OK, strip-eljük)
 *   ARMADILLO_CEG_NEV     → pl. "Armadillo Design Kft" (max 35 karakter)
 *   MAGNET_JOGCIM         → pl. "K  " (3 karakter, P9 feladat alapján)
 *
 * @returns {{ bankszerv:string, szamlaszam:string, adoszam:string, cegNev:string, jogcim:string }}
 */
function _getSenderInfo_() {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.TABS.CONFIG);
  const data  = sheet.getDataRange().getValues();

  const map = {};
  for (let i = 1; i < data.length; i++) {
    const key = String(data[i][0]).trim();
    const val = String(data[i][1] || '').trim();
    if (key) map[key] = val;
  }

  const bankszamla = map['ARMADILLO_BANKSZAMLA'] || '';
  if (!bankszamla) throw new Error(
    'ARMADILLO_BANKSZAMLA nincs beállítva a CONFIG fülön! Adj hozzá sort: A=ARMADILLO_BANKSZAMLA, B=számlaszám');

  const adoszam = map['ARMADILLO_ADOSZAM'] || '';
  if (!adoszam) throw new Error(
    'ARMADILLO_ADOSZAM nincs beállítva a CONFIG fülön! Adj hozzá sort: A=ARMADILLO_ADOSZAM, B=adószám (pl. 12345678-2-41)');

  const cegNev = map['ARMADILLO_CEG_NEV'] || '';
  if (!cegNev) throw new Error(
    'ARMADILLO_CEG_NEV nincs beállítva a CONFIG fülön! Adj hozzá sort: A=ARMADILLO_CEG_NEV, B=cég neve');

  const jogcim = map['MAGNET_JOGCIM'] || '';
  if (!jogcim) throw new Error(
    'MAGNET_JOGCIM nincs beállítva a CONFIG fülön! P9 feladat: MagNet Business-ben leellenőrizni a jogcím kódot, majd beírni. (3 karakter, pl. "K  ")');

  const split = _splitBankAccount_(bankszamla);

  return {
    bankszerv:  split.bankszerv,
    szamlaszam: split.szamlaszam,
    adoszam:    adoszam,
    cegNev:     asciiTranslit(cegNev).substring(0, 35),
    jogcim:     jogcim,
  };
}

/**
 * Bankszámlaszámot splitteli bankszerv (8 char) + számlaszám (16 char) részekre.
 * Bemenet bármilyen formátum: "16200234-10056789-00000000" vagy "162002341005678900000000"
 * @param {string} accountStr
 * @returns {{ bankszerv: string, szamlaszam: string }}
 */
function _splitBankAccount_(accountStr) {
  const clean = String(accountStr || '').replace(/[^0-9]/g, '');
  return {
    bankszerv:  clean.substring(0, 8),   // első 8 jegy = bankkód + fiókkód + CDV
    szamlaszam: clean.substring(8),      // maradék = számlaszám (tipikusan 16 jegy)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESZTELŐ FÜGGVÉNYEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GIRO CSÁT.121 fájlformátum tesztelése + rekord hossz ellenőrzés.
 * Futtatás: Script Editor → testBatchFormat → ▶ Run
 */
function testBatchFormat() {
  console.log('GIRO CSÁT.121 formátum teszt...');

  const testRows = [
    {
      szamlaId:    'INV-TEST-001',
      szallitoNev: 'Teszt Szállító Kft',
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
      szallitoNev: 'Arvizturő Fúrógép Bt',
      adoszam:     '87654321-2-13',
      szamlaszam:  'AFB/2026/17',
      osszeg:      85000,
      deviza:      'HUF',
      fizhatarido: '2026-04-30',
      bankszamla:  '44444444-55555555-66666666',
      rowIndex:    3,
    },
  ];

  const testSenderInfo = {
    bankszerv:  '16200234',
    szamlaszam: '1005678900000000',
    adoszam:    '12345678241',
    cegNev:     'Armadillo Design Kft',
    jogcim:     'K  ',  // Teszt — P9 alapján cserélendő
  };

  const utalasDate = new Date(2026, 3, 15); // 2026-04-15
  const kotegId    = 'KOTEG-TEST-001';

  try {
    const content = _buildMagnetContent_(testRows, utalasDate, testSenderInfo, kotegId);
    const lines   = content.split(MAGNET_CRLF).filter(function(l) { return l.length > 0; });

    console.log('Sorok száma: ' + lines.length + ' (várt: ' + (testRows.length + 2) + ')');
    lines.forEach(function(line, i) {
      const isLast   = (i === lines.length - 1);
      const label    = i === 0 ? 'FEJ ' : (isLast ? 'LÁB ' : 'TÉTEL[' + i + ']');
      const expected = i === 0 ? MAGNET_FEJ_LEN : (isLast ? MAGNET_LAB_LEN : MAGNET_TETEL_LEN);
      const ok       = line.length === expected;
      console.log(label + ': ' + line.length + ' kar ' + (ok ? '✓' : '✗ HIBA (várt: ' + expected + ')'));
      // FEJ kritikus mezők ellenőrzése
      if (i === 0) {
        console.log('  F210 rekordtípus  [1-2]  : "' + line.substring(0, 2) + '" (várt: "01")');
        console.log('  F211 üzenettípus  [3-8]  : "' + line.substring(2, 8) + '" (várt: "ATUTAL")');
        console.log('  F213 adószám      [10-22]: "' + line.substring(9, 22) + '"');
        console.log('  F215.1 bankszerv  [35-42]: "' + line.substring(34, 42) + '"');
        console.log('  F217 jogcím       [67-69]: "' + line.substring(66, 69) + '"');
      }
      // TÉTEL kritikus mezők
      if (i > 0 && !isLast) {
        console.log('  T210 rekordtípus  [1-2]  : "' + line.substring(0, 2) + '" (várt: "02")');
        console.log('  T213 összeg       [17-26]: "' + line.substring(16, 26) + '"');
        console.log('  T214.1 bankszerv  [27-34]: "' + line.substring(26, 34) + '"');
        console.log('  T219 közlemény    [180+] : "' + line.substring(179, 197) + '" (18 effektív)');
      }
      // LÁB mezők
      if (isLast) {
        console.log('  Z210 rekordtípus  [1-2] : "' + line.substring(0, 2) + '" (várt: "03")');
        console.log('  Z211 tételszám    [3-8] : "' + line.substring(2, 8) + '"');
        console.log('  Z212 összeg       [9-24]: "' + line.substring(8, 24) + '"');
      }
    });
    console.log('✅ Formátum teszt kész');
  } catch (e) {
    console.error('✗ Formátum teszt HIBA: ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// P11 — 1 FT PRÓBAUTALÁS (GIRO formátum + forint/fillér validáció)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * P11 teszt: 1 Ft-os próbautalás Armadillo saját számlájára.
 * Célja: MagNet NetBank importja validálja a GIRO CSÁT.121 formátumot és az összeg egységet.
 *
 * ELŐFELTÉTELEK (SSOT sheet CONFIG fül):
 *   ARMADILLO_BANKSZAMLA  = cég bankszámlaszáma
 *   ARMADILLO_ADOSZAM     = cég adószáma
 *   ARMADILLO_CEG_NEV     = cég neve
 *   MAGNET_JOGCIM         = 3 karakter jogcím kód (P9 alapján)
 *
 * FUTTATÁS: Script Editor → testP11OneFt → ▶ Run
 *
 * ÉRTELMEZÉS:
 *   Ha MagNet importálta hibátlanul → GIRO formátum OK, BATCH_AMOUNT_UNIT = 'HUF' helyes
 *   Ha "állomány típusa" hiba       → FEJ F211 mező nem "ATUTAL" (nem fordulhat elő az új kóddal)
 *   Ha összeg hiba                  → Config.gs → BATCH_AMOUNT_UNIT: 'FILLER' (nem várható)
 *   Ha más formátum hiba            → melyik mező, hányadik pozíció? → fejlesztőnek visszajelzés
 */
function testP11OneFt() {
  if (!CONFIG.TEST_MODE) {
    throw new Error('testP11OneFt() csak TEST_MODE=true esetén futtatható!');
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('P11 — 1 Ft próbautalás (GIRO CSÁT.121 formátum teszt)');
  console.log('BATCH_AMOUNT_UNIT: ' + CONFIG.BATCH_AMOUNT_UNIT +
    ' (spec szerint Ft kötelező → HUF helyes)');
  console.log('═══════════════════════════════════════════════════════');

  const senderInfo = _getSenderInfo_();
  const fullAccount = senderInfo.bankszerv + senderInfo.szamlaszam;

  console.log('Küldő bankszerv : ' + senderInfo.bankszerv);
  console.log('Küldő számlaszám: ' + senderInfo.szamlaszam);
  console.log('Jogcím          : "' + senderInfo.jogcim + '"');
  console.log('Cég neve        : ' + senderInfo.cegNev);

  // Célszámla = saját számla (belső utalás = nulla kockázat, az 1 Ft visszaérkezik)
  const testRow = {
    szamlaId:    'P11-TEST-1FT',
    szallitoNev: 'Armadillo Design Kft PROBA',
    adoszam:     '',
    szamlaszam:  'P11-1FT-PROBA',
    osszeg:      1,
    deviza:      'HUF',
    fizhatarido: '',
    bankszamla:  fullAccount, // saját számlára utal — az 1 Ft visszajön
    rowIndex:    0,
  };

  const utalasDate = getNextWorkday(new Date(), 1);
  const kotegId    = 'P11-' + formatDate(new Date()).replace(/-/g, '');

  const content = _buildMagnetContent_([testRow], utalasDate, senderInfo, kotegId);

  // Fájl tartalom kiírása soronként
  const lines = content.split(MAGNET_CRLF).filter(function(l) { return l.length > 0; });
  console.log('');
  console.log('═══ FÁJL TARTALOM (' + lines.length + ' sor) ═══');
  lines.forEach(function(line, i) {
    const label = i === 0 ? 'FEJ ' : (i === lines.length - 1 ? 'LÁB ' : 'TÉTL');
    console.log(label + ' [' + line.length + ' kar]: ' + line);
  });

  // Kulcs mezők kiemelése
  const fej  = lines[0];
  const tete = lines[1];
  const lab  = lines[lines.length - 1];
  console.log('');
  console.log('═══ KULCS MEZŐK ELLENŐRZÉSE ═══');
  console.log('FEJ F211 üzenettípus  [3-8] : "' + fej.substring(2, 8) + '" (várt: "ATUTAL")');
  console.log('FEJ F217 jogcím       [67-69]: "' + fej.substring(66, 69) + '"');
  console.log('TÉTEL T213 összeg   [17-26]: "' + tete.substring(16, 26) + '" (' +
    _amountToMagnet_(1) + ' ' + CONFIG.BATCH_AMOUNT_UNIT + ')');
  console.log('LÁB Z210 rekordtípus [1-2] : "' + lab.substring(0, 2) + '" (várt: "03")');
  console.log('LÁB Z212 összeg      [9-24]: "' + lab.substring(8, 24) + '"');

  // Drive mentés
  let driveUrl;
  try {
    const saved = _saveBatchToDrive_(content, kotegId, utalasDate);
    driveUrl = saved.fileUrl;
  } catch (e) {
    console.error('Drive mentés hiba: ' + e.message);
    console.log('Fájl tartalom (manuális másoláshoz):\n' + content);
    return;
  }

  console.log('');
  console.log('Drive URL: ' + driveUrl);
  console.log('');
  console.log('═══ TEENDŐK (Péter) ═══');
  console.log('1. Töltsd le a fájlt a Drive-ról: ' + driveUrl);
  console.log('2. MagNet Business → Csoportos átutalás → Köteg feltöltés → fájl kiválasztása');
  console.log('3a. Ha MagNet importálta: GIRO CSÁT.121 formátum OK → P11 KÉSZ');
  console.log('3b. Ha összeg hiba: Config.gs → BATCH_AMOUNT_UNIT: "FILLER" → újra teszt');
  console.log('3c. Ha más formátum hiba: melyik mező, hányadik sor → fejlesztőnek visszajelzés');
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
    { val: '01',     len: 2,  align: 'L', pad: ' ', expected: '01'        },
    { val: 'ATUTAL', len: 6,  align: 'L', pad: ' ', expected: 'ATUTAL'    },
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
