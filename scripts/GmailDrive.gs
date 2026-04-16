/**
 * GmailDrive.gs
 * Armadillo Pénzügyi Automatizáció — Gmail befogadó + PDF Drive mentés
 *
 * TRIGGER: 15 perces time-driven trigger hívja a processNewInvoices()-t
 * Beállítás: Triggers.gs → setupTimeTrigger() — autobot@armadillo.hu fiókból!
 *
 * Feldolgozási sorrend (szigorú):
 *   1. Deduplikáció — Gmail message ID ellenőrzés a BEJÖVŐ_SZÁMLÁK W oszlopában
 *   2. PDF mentés Drive-ra — ha sikertelen: email marad unread, retry következő futáskor
 *   3. GeminiOCR hívás — OCR + SSOT írás
 *   4. Email megjelölése olvasottként — CSAK sikeres feldolgozás után
 *
 * Ha bármely email feldolgozása hibázik, a többi email feldolgozása folytatódik.
 */

// ─────────────────────────────────────────────────────────────────────────────
// FŐ BELÉPÉSI PONT — TRIGGER HÍVJA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 15 percenként fut. Feldolgozza az autobot@ inbox összes új számla-emailjét.
 * NE nevezd át — a Triggers.gs erre a névre hivatkozik.
 */
function processNewInvoices() {
  console.log('════════════════════════════════════════');
  console.log('processNewInvoices indítás: ' + new Date().toISOString());
  console.log('TEST_MODE: ' + CONFIG.TEST_MODE);
  console.log('════════════════════════════════════════');
  _assertProductionConfig_();

  const threads = GmailApp.search(CONFIG.GMAIL_QUERY);

  if (threads.length === 0) {
    console.log('Nincs új email. Kilépés.');
    return;
  }

  console.log('Talált szálak száma: ' + threads.length);

  // Deduplikáció cache — egyszer olvassuk a W oszlopot, ne minden emailnél
  const processedIds = _loadProcessedMessageIds_();
  console.log('Már feldolgozott Gmail ID-k száma: ' + processedIds.size);

  let processed = 0;
  let skipped   = 0;
  let errors    = 0;

  threads.forEach(function(thread) {
    const messages = thread.getMessages();

    messages.forEach(function(message) {
      // Csak olvasatlan üzenetek
      if (!message.isUnread()) return;

      const msgId = message.getId();

      // ── Deduplikáció
      if (processedIds.has(msgId)) {
        console.log('Kihagyva (már feldolgozva): ' + msgId);
        skipped++;
        return;
      }

      // ── Feldolgozás
      try {
        const result = _processMessage_(message, processedIds);
        if (result === 'NO_PDF') {
          // Nincs PDF csatolmány — olvasottnak jelöljük, nem kell újrapróbálni
          message.markRead();
          console.log('Kihagyva (nincs PDF): ' + msgId + ' | ' + message.getSubject());
          skipped++;
        } else if (result === 'OK') {
          message.markRead();
          _applyProcessedLabel_(message); // Gmail label: "Armadillo/Feldolgozva"
          processedIds.add(msgId); // cache frissítés
          processed++;
        } else if (result === 'DRIVE_ERROR') {
          // MI-06: DRIVE_ERROR is hiba — számolódik, hogy az összefoglaló logban látsszon
          errors++;
          console.warn('Drive mentés sikertelen, retry következő körben: ' + msgId);
          // email marad unread → retry következő körben
        }
      } catch (err) {
        errors++;
        console.error('Email feldolgozási hiba [' + msgId + ']: ' + err.message);
        notifyAdmin(
          'Email feldolgozási hiba',
          'Gmail Message ID: ' + msgId +
          '\nTárgy: ' + message.getSubject() +
          '\nFeladó: ' + message.getFrom(),
          err
        );
        // Email marad unread — retry következő futáskor
      }
    });
  });

  console.log('════════════════════════════════════════');
  console.log('Összefoglaló: feldolgozva=' + processed +
    ', kihagyva=' + skipped + ', hiba=' + errors);
  console.log('════════════════════════════════════════');
}

// ─────────────────────────────────────────────────────────────────────────────
// EGYEDI EMAIL FELDOLGOZÁS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Feldolgoz egyetlen Gmail üzenetet.
 * @param {GmailMessage} message
 * @param {Set<string>}  processedIds  - Futásonkénti cache (referencia)
 * @returns {'OK'|'NO_PDF'|'DRIVE_ERROR'}
 */
function _processMessage_(message, processedIds) {
  const msgId   = message.getId();
  const subject = message.getSubject();
  const from    = message.getFrom();
  const date    = message.getDate();

  console.log('Feldolgozás: [' + msgId + '] "' + subject + '" — ' + from);

  // ── 1. PDF csatolmányok keresése
  const attachments = message.getAttachments();
  const pdfAttachments = attachments.filter(function(att) {
    return att.getContentType() === 'application/pdf' ||
           att.getName().toLowerCase().endsWith('.pdf');
  });

  if (pdfAttachments.length === 0) {
    console.log('  → Nincs PDF csatolmány, kihagyva.');
    return 'NO_PDF';
  }

  console.log('  → PDF csatolmányok száma: ' + pdfAttachments.length);

  // ── 2. PDF mentés Drive-ra (ELSŐ lépés — ha sikertelen, megállunk)
  // Ha több PDF van: mindegyiket mentjük, az elsőt dolgozzuk fel OCR-ral
  const savedFiles = [];

  for (let i = 0; i < pdfAttachments.length; i++) {
    const att = pdfAttachments[i];
    try {
      const fileInfo = withRetry(function() {
        return _savePdfToDrive_(att, date, msgId, i);
      }, 3, 10000); // 10s backoff PDF Drive mentésnél (gyorsabb mint Gemini)

      savedFiles.push(fileInfo);
      console.log('  → PDF mentve: ' + fileInfo.fileName + ' (ID: ' + fileInfo.fileId + ')');
    } catch (driveErr) {
      console.error('  → Drive mentés sikertelen: ' + driveErr.message);
      notifyAdmin(
        'PDF Drive mentés sikertelen',
        'Gmail Message ID: ' + msgId + '\nTárgy: ' + subject +
        '\nCsatolmány: ' + att.getName(),
        driveErr
      );
      // Email marad unread → retry
      return 'DRIVE_ERROR';
    }
  }

  // ── 3. GeminiOCR hívás az első (fő) PDF-re
  const primaryFile = savedFiles[0];
  const primaryBlob = pdfAttachments[0].copyBlob();

  const metadata = {
    gmailMessageId: msgId,
    subject:        subject,
    from:           from,
    date:           date,
    driveFileId:    primaryFile.fileId,
    driveUrl:       primaryFile.fileUrl,
    fileName:       primaryFile.fileName,
  };

  // GeminiOCR.gs-ben definiált — feldolgoz + SheetWriter-t hív
  // Visszaadja a kinyert { szallitoNev, szamlaszam, kelt } adatokat az átnevezéshez
  const extracted = processInvoiceWithGemini(primaryBlob, metadata);

  // ── 4. PDF átnevezése a végleges névre: partnernév_yyyymmdd_számlaszám.pdf
  // Az OCR után van meg a partner neve, a számlaszám és a dátum
  if (extracted && extracted.szallitoNev && extracted.szamlaszam) {
    try {
      const finalName = _buildFinalFileName_(
        extracted.szallitoNev,
        extracted.kelt || date,
        extracted.szamlaszam
      );
      const driveFile = DriveApp.getFileById(primaryFile.fileId);
      driveFile.setName(finalName);
      console.log('  → PDF átnevezve: ' + finalName);
    } catch (renameErr) {
      // Átnevezés hiba nem kritikus — a feldolgozás már megtörtént
      console.warn('  → PDF átnevezés sikertelen (nem kritikus): ' + renameErr.message);
    }
  }

  return 'OK';
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIVE MENTÉS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PDF blob-ot ment a Drive megfelelő éves/havi almappájába.
 * Mappa struktúra: [INVOICES_FOLDER] / [2026] / [04_Április] /
 * Ha az almappa nem létezik: automatikusan létrehozza.
 *
 * IDEIGLENES NÉV: FELDOLGOZAS_ALATT_yyyymmdd_msgId.pdf
 * Végleges névre (partnernév_yyyymmdd_számlaszám.pdf) az OCR után nevezi át
 * a _processMessage_() függvény a _buildFinalFileName_() segítségével.
 *
 * @param {Blob}   pdfBlob
 * @param {Date}   date    - Email dátuma (mappa nevéhez + temp fájlnévhez)
 * @param {string} msgId   - Gmail Message ID (temp fájlnév egyediségéhez)
 * @param {number} index   - Ha több PDF van: 0, 1, 2...
 * @returns {{ fileId: string, fileUrl: string, fileName: string }}
 */
function _savePdfToDrive_(pdfBlob, date, msgId, index) {
  // ── Célmappa megkeresése / létrehozása
  const rootFolder  = DriveApp.getFolderById(CONFIG.INVOICES_FOLDER_ID);
  const yearFolder  = _getOrCreateSubfolder_(rootFolder, String(date.getFullYear()));
  const monthFolder = _getOrCreateSubfolder_(yearFolder, hungarianMonth(date));

  // ── Ideiglenes fájlnév — OCR után kapja meg a végleges nevet
  const dateStr  = formatDate(date).replace(/-/g, '');
  const indexStr = index > 0 ? ('_' + (index + 1)) : '';
  const tempName = 'FELDOLGOZAS_ALATT_' + dateStr + '_' + msgId.substring(0, 12) + indexStr + '.pdf';

  // ── Duplikátum ellenőrzés: ha már létezik temp fájl ezzel az msgId-vel → visszaadjuk
  const existing = monthFolder.getFilesByName(tempName);
  if (existing.hasNext()) {
    const existingFile = existing.next();
    console.log('  → Temp fájl már létezik: ' + tempName);
    return {
      fileId:   existingFile.getId(),
      fileUrl:  existingFile.getUrl(),
      fileName: tempName,
    };
  }

  // ── Fájl létrehozása ideiglenes névvel
  const blob = pdfBlob.setName(tempName);
  const file = monthFolder.createFile(blob);

  return {
    fileId:   file.getId(),
    fileUrl:  file.getUrl(),
    fileName: tempName,
  };
}

/**
 * Összeállítja a végleges fájlnevet az OCR által kinyert adatokból.
 * Formátum: partnernév_yyyymmdd_számlaszám.pdf
 *
 * @param {string}     szallitoNev  - Szállító neve (Gemini által kinyerve)
 * @param {Date|string} kelt        - Számla kelte
 * @param {string}     szamlaszam   - Számlaszám (Gemini által kinyerve)
 * @returns {string}
 */
function _buildFinalFileName_(szallitoNev, kelt, szamlaszam) {
  const partner  = _sanitizeFilename_(szallitoNev).substring(0, 30);
  const dateStr  = formatDate(kelt instanceof Date ? kelt : new Date(kelt)).replace(/-/g, '');
  const invoice  = _sanitizeFilename_(szamlaszam).substring(0, 30);
  return partner + '_' + dateStr + '_' + invoice + '.pdf';
}

/**
 * Megkeres vagy létrehoz egy almappát. Idempotens.
 * @param {Folder} parent
 * @param {string} name
 * @returns {Folder}
 */
function _getOrCreateSubfolder_(parent, name) {
  const existing = parent.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return parent.createFolder(name);
}

/**
 * Stringet biztonságos fájlnévvé alakítja: ékezetek → ASCII, spec.karakterek → '_'.
 * MIN-04: a 50 karakteres vágás itt soha nem aktiválódik, mert a hívó
 * `_buildFinalFileName_()` már `.substring(0, 30)`-ra vágja a bemenetet.
 * A `.substring(0, 50)` visszamenőleges kompatibilitásból maradt.
 * @param {string} subject
 * @returns {string}
 */
function _sanitizeFilename_(subject) {
  return asciiTranslit(subject)
    .replace(/[^a-zA-Z0-9_\-]/g, '_')  // nem alfanumerikus → _
    .replace(/__+/g, '_')               // dupla aláhúzások összevonása
    .replace(/^_|_$/g, '')              // kezdő/záró _ törlése
    .substring(0, 50)
    || 'szamla';                        // ha teljesen üres marad
}

// ─────────────────────────────────────────────────────────────────────────────
// GMAIL LABEL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "Armadillo/Feldolgozva" label-t alkalmaz a feldolgozott emailre.
 * Emberek számára is látható: Gmail-ben az email szálhoz hozzárendelt label.
 * TEST_MODE-ban "[TEST] Armadillo/Feldolgozva" label kerül rá.
 * Ha a label nem létezik: automatikusan létrehozza.
 * Hiba esetén csak logol — ne törje el a feldolgozást.
 *
 * @param {GmailMessage} message
 */
function _applyProcessedLabel_(message) {
  try {
    const labelName = (CONFIG.TEST_MODE ? '[TEST] ' : '') + 'Armadillo/Feldolgozva';
    let label = GmailApp.getUserLabelByName(labelName);
    if (!label) label = GmailApp.createLabel(labelName);
    label.addToThread(message.getThread());
    console.log('  → Gmail label alkalmazva: "' + labelName + '"');
  } catch (e) {
    console.warn('  → Gmail label sikertelen (nem kritikus): ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEDUPLIKÁCIÓ — GMAIL MESSAGE ID CACHE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Betölti a már feldolgozott Gmail Message ID-kat a BEJÖVŐ_SZÁMLÁK W oszlopából.
 * Egyszer fut futásonként — ne hívd meg többször.
 * @returns {Set<string>}
 */
function _loadProcessedMessageIds_() {
  try {
    const ss      = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet   = ss.getSheetByName(CONFIG.TABS.BEJOVO_SZAMLAK);
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) return new Set();

    const wCol  = CONFIG.COLS.BEJOVO.GMAIL_MESSAGE_ID; // 23 = W
    const values= sheet.getRange(2, wCol, lastRow - 1, 1).getValues();

    return new Set(
      values
        .map(function(r) { return String(r[0]).trim(); })
        .filter(Boolean)
    );
  } catch (e) {
    console.error('_loadProcessedMessageIds_ hiba: ' + e.message);
    return new Set(); // Ha nem sikerül olvasni → ne blokkoljon, de logolunk
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TESZTELŐ FÜGGVÉNYEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manuális teszt: az aktuális inbox státuszát írja ki, nem dolgoz fel semmit.
 * Futtatás: Script Editor → checkInbox → ▶ Run
 */
function checkInbox() {
  console.log('Inbox ellenőrzés — lekérdezés: "' + CONFIG.GMAIL_QUERY + '"');
  const threads = GmailApp.search(CONFIG.GMAIL_QUERY);
  console.log('Találatok: ' + threads.length + ' szál');

  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(msg) {
      if (!msg.isUnread()) return;
      const atts    = msg.getAttachments();
      const pdfAtts = atts.filter(function(a) {
        return a.getContentType() === 'application/pdf' ||
               a.getName().toLowerCase().endsWith('.pdf');
      });
      console.log(
        '  [' + msg.getId() + '] "' + msg.getSubject() + '"' +
        ' | PDF: ' + pdfAtts.length +
        ' | Összes csatolmány: ' + atts.length +
        ' | ' + msg.getDate().toISOString().slice(0, 10)
      );
    });
  });

  const processedIds = _loadProcessedMessageIds_();
  console.log('Már feldolgozott ID-k a sheet-en: ' + processedIds.size);
}

/**
 * Teszteli a Drive mappa struktúra létrehozását — nem ír valódi fájlt.
 * Futtatás: Script Editor → testDriveFolderCreation → ▶ Run
 */
function testDriveFolderCreation() {
  console.log('Drive mappa struktúra teszt...');

  if (!CONFIG.INVOICES_FOLDER_ID) {
    throw new Error('CONFIG.INVOICES_FOLDER_ID nincs beállítva!');
  }

  const rootFolder  = DriveApp.getFolderById(CONFIG.INVOICES_FOLDER_ID);
  const now         = new Date();
  const yearFolder  = _getOrCreateSubfolder_(rootFolder, String(now.getFullYear()));
  const monthFolder = _getOrCreateSubfolder_(yearFolder, hungarianMonth(now));

  console.log('✓ Gyökér mappa: ' + rootFolder.getName());
  console.log('✓ Év mappa: '     + yearFolder.getName()  + ' (ID: ' + yearFolder.getId()  + ')');
  console.log('✓ Hónap mappa: '  + monthFolder.getName() + ' (ID: ' + monthFolder.getId() + ')');
  console.log('✓ Teljes útvonal: ' +
    rootFolder.getName() + ' / ' +
    yearFolder.getName()  + ' / ' +
    monthFolder.getName());
}

/**
 * Végleges fájlnév összeállításának tesztelése.
 * Futtatás: Script Editor → testBuildFinalFileName → ▶ Run
 */
function testBuildFinalFileName() {
  const cases = [
    ['Teszt Szállító Kft.',    new Date(2026, 3, 8), 'SZ-2026/045'],
    ['Armadillo Design Kft.',  new Date(2026, 2, 1), 'AD-2026/001'],
    ['Bp.III.PM.HIV.adó főoszt.', new Date(2026, 0, 15), '2026/INKA/1234'],
    ['F Automobil',            new Date(2026, 3, 1), 'FCA-INV-0042'],
  ];
  cases.forEach(function(c) {
    console.log(_buildFinalFileName_(c[0], c[1], c[2]));
  });
  // Várt kimenet pl.:
  // Teszt_Szallito_Kft_20260408_SZ-2026_045.pdf
  // Armadillo_Design_Kft_20260301_AD-2026_001.pdf
}
