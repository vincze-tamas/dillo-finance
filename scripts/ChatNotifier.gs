/**
 * ChatNotifier.gs
 * Armadillo Pénzügyi Automatizáció — Google Chat értesítők
 *
 * 3 webhook csatorna (TEST_MODE=true esetén mind az Admin webhook-ra megy):
 *   OPS     → 🟢 Pénzügy-Jóváhagyások space (Ági + Márk)
 *   FINANCE → 🏦 Pénzügy-Utalások space (Péter)
 *   ADMIN   → 🤖 IT Rendszerlogok space (IT)
 *
 * Publikus függvények:
 *   notifyNewInvoice(szamlaId, szallitoNev, osszeg, deviza, statusz, driveUrl)
 *   notifyStatusChange(szamlaId, szallitoNev, osszeg, deviza, regiStatusz, ujStatusz, jovahagyoNev, visszautasitasOka)
 *   notifyOpsDigest(projektRows, hianyosRows, utalasDate)
 *   notifyWednesdayDigest(pendingRows, utalasDate, allandoRows)
 *   notifyBatchReady(kotegId, szamlakSzama, osszeg, driveUrl)
 *   notifyAdmin() — Utils.gs-ben definiált, itt NEM duplikáljuk
 */

// ─────────────────────────────────────────────────────────────────────────────
// ÚJ SZÁMLA ÉRTESÍTŐ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Új számla beérkezésekor hívja a GeminiOCR / SheetWriter folyamat.
 * OPS webhookra megy — Ági és Márk látja.
 *
 * @param {string} szamlaId
 * @param {string} szallitoNev
 * @param {number} osszeg      - Nettó összeg
 * @param {string} deviza
 * @param {string} statusz     - 'BEÉRKEZETT' | 'HIÁNYOS_PO' | 'AI_HIBA' | ...
 * @param {string} driveUrl
 */
function notifyNewInvoice(szamlaId, szallitoNev, osszeg, deviza, statusz, driveUrl) {
  const icon    = _statuszIcon_(statusz);
  const prefix  = CONFIG.TEST_MODE ? '[TEST] ' : '';
  const osszeFormatted = _formatAmount_(osszeg, deviza);

  // SSOT sheet URL — mindig ugyanaz a spreadsheet, config-ból képzett link
  const sheetUrl = CONFIG.SPREADSHEET_ID
    ? 'https://docs.google.com/spreadsheets/d/' + CONFIG.SPREADSHEET_ID
    : '';
  const sheetLink = sheetUrl ? '\n• <' + sheetUrl + '|SSOT sheet megnyitása>' : '';

  let text;
  if (statusz === 'BEÉRKEZETT') {
    text = icon + ' *' + prefix + 'Új számla érkezett — jóváhagyásra vár*\n' +
           '• Szállító: *' + szallitoNev + '*\n' +
           '• Összeg: ' + osszeFormatted + '\n' +
           '• Azonosító: `' + szamlaId + '`\n' +
           '• <' + driveUrl + '|Számla PDF megnyitása>' + sheetLink;
    _sendToWebhook_(CONFIG.CHAT_WEBHOOK_OPS, text);

  } else if (statusz === 'HIÁNYOS_PO') {
    text = icon + ' *' + prefix + 'Hiányos projekt azonosítás — kézi javítás szükséges*\n' +
           '• Szállító: *' + szallitoNev + '*\n' +
           '• Összeg: ' + osszeFormatted + '\n' +
           '• Azonosító: `' + szamlaId + '`\n' +
           '• <' + sheetUrl + '|Teendő: BEJÖVŐ_SZÁMLÁK fülön N oszlop ellenőrzése>\n' +
           '• <' + driveUrl + '|Számla PDF megnyitása>';
    _sendToWebhook_(CONFIG.CHAT_WEBHOOK_OPS, text);

  } else if (statusz === 'AI_HIBA') {
    text = icon + ' *' + prefix + 'OCR feldolgozás sikertelen*\n' +
           '• Szállító: ' + (szallitoNev || 'ismeretlen') + '\n' +
           '• Azonosító: `' + szamlaId + '`\n' +
           '• <' + driveUrl + '|Számla PDF megnyitása>' + sheetLink + '\n' +
           '• Teendő: manuális adatbevitel vagy újrafeldolgozás';
    _sendToWebhook_(CONFIG.CHAT_WEBHOOK_ADMIN, text);

  } else {
    // Egyéb státusz → Admin-ra logoljuk
    text = icon + ' *' + prefix + szamlaId + '* státusz: ' + statusz;
    _sendToWebhook_(CONFIG.CHAT_WEBHOOK_ADMIN, text);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STÁTUSZVÁLTÁS ÉRTESÍTŐ (onEdit trigger hívja)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BEJÖVŐ_SZÁMLÁK Q oszlop változásakor hívja az onEditInstallable trigger.
 * Routing státusz alapján:
 *   JÓVÁHAGYVA   → Finance (Péter utalja)
 *   VISSZAUTASÍTVA → OPS (Ági tájékoztatva) + Finance (Péter nem utal)
 *   UTALVA       → OPS (lezárva)
 *   Egyéb        → Admin log
 *
 * @param {string} szamlaId
 * @param {string} szallitoNev
 * @param {number} osszeg
 * @param {string} deviza
 * @param {string} regiStatusz
 * @param {string} ujStatusz
 * @param {string} jovahagyoNev
 * @param {string} [visszautasitasOka]  - KOZ-07: T oszlop értéke, VISSZAUTASÍTVA esetén kerül a Chat üzenetbe
 */
function notifyStatusChange(szamlaId, szallitoNev, osszeg, deviza,
                            regiStatusz, ujStatusz, jovahagyoNev, visszautasitasOka) {
  const icon   = _statuszIcon_(ujStatusz);
  const prefix = CONFIG.TEST_MODE ? '[TEST] ' : '';
  const osszeFormatted = _formatAmount_(osszeg, deviza);
  const jov    = jovahagyoNev ? ' (' + jovahagyoNev + ')' : '';

  let text;

  if (ujStatusz === 'JÓVÁHAGYVA') {
    text = icon + ' *' + prefix + 'Számla jóváhagyva — utalásra vár*\n' +
           '• Szállító: *' + szallitoNev + '*\n' +
           '• Összeg: ' + osszeFormatted + '\n' +
           '• Azonosító: `' + szamlaId + '`\n' +
           '• Jóváhagyta: ' + (jovahagyoNev || '–') + '\n' +
           '• Szerdai kötegbe kerül';
    _sendToWebhook_(CONFIG.CHAT_WEBHOOK_FINANCE, text);

  } else if (ujStatusz === 'VISSZAUTASÍTVA') {
    text = icon + ' *' + prefix + 'Számla visszautasítva*\n' +
           '• Szállító: *' + szallitoNev + '*\n' +
           '• Összeg: ' + osszeFormatted + '\n' +
           '• Azonosító: `' + szamlaId + '`\n' +
           '• Visszautasította: ' + (jovahagyoNev || '–') + '\n' +
           '• Ok: ' + (visszautasitasOka || '–');
    // OPS-re és Finance-re is megy — TEST_MODE-ban mindkettő Admin-ra mutat,
    // de csak egyszer küldjük ki (dedup), hogy ne jöjjön dupla üzenet
    _sendToWebhook_(CONFIG.CHAT_WEBHOOK_OPS, text);
    if (CONFIG.CHAT_WEBHOOK_FINANCE !== CONFIG.CHAT_WEBHOOK_OPS) {
      _sendToWebhook_(CONFIG.CHAT_WEBHOOK_FINANCE, text);
    }

  } else if (ujStatusz === 'UTALVA') {
    text = icon + ' *' + prefix + 'Számla utalva*\n' +
           '• Szállító: *' + szallitoNev + '*\n' +
           '• Összeg: ' + osszeFormatted + '\n' +
           '• Azonosító: `' + szamlaId + '`' + jov;
    _sendToWebhook_(CONFIG.CHAT_WEBHOOK_OPS, text);

  } else {
    // Státuszváltás logolása Admin-ra (pl. HIÁNYOS_PO → BEÉRKEZETT javítás után)
    text = '🔄 *' + prefix + szamlaId + '* státusz: ' +
           regiStatusz + ' → *' + ujStatusz + '*' + jov;
    _sendToWebhook_(CONFIG.CHAT_WEBHOOK_ADMIN, text);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SZERDA 9:00 — OPS DIGEST (Ági + Márk)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Szerda reggel 9:00-kor a WednesdayWorkflow.gs hívja.
 * OPS webhook → Ági és Márk látja.
 *
 * Tartalom:
 *   1. BEÉRKEZETT + PROJEKT kategória → jóváhagyásra vár
 *   2. HIÁNYOS_PO → kézi review, tétel-szintű bontással (sor | PO | Conf% | reasoning)
 *
 * @param {Array<{szamlaId, szallitoNev, osszeg, deviza, fizhatarido}>} projektRows
 *   BEÉRKEZETT + PROJEKT kategóriájú számlák
 * @param {Array<{szamlaId, szallitoNev, osszeg, deviza, fizhatarido, tetelek[]}>} hianyosRows
 *   HIÁNYOS_PO számlák tétel-szintű bontással
 * @param {Date} utalasDate  - A következő banki munkanap (getNextWorkday())
 */
function notifyOpsDigest(projektRows, hianyosRows, utalasDate) {
  const prefix    = CONFIG.TEST_MODE ? '[TEST] ' : '';
  const utalasStr = formatDate(utalasDate);

  if (projektRows.length === 0 && hianyosRows.length === 0) {
    const text = '📋 *' + prefix + 'Szerda OPS digest — nincs teendő*\n' +
                 'Nincs jóváhagyásra váró PROJEKT számla és nincs HIÁNYOS_PO tétel.';
    _sendToWebhook_(CONFIG.CHAT_WEBHOOK_OPS, text);
    return;
  }

  const todayMs     = new Date().setHours(0, 0, 0, 0);
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  /**
   * @param {string} fizhatarido  - 'YYYY-MM-DD' vagy ''
   * @returns {string}  urgency marker vagy ''
   */
  function _urgency(fizhatarido) {
    if (!fizhatarido) return '';
    const hatMs = new Date(fizhatarido).setHours(0, 0, 0, 0);
    if (hatMs < todayMs) return ' ⚠️ *LEJÁRT*';
    if (hatMs - todayMs <= sevenDaysMs) return ' ⚠️ *<7 nap*';
    return '';
  }

  const sections = [];

  // ── 1. BEÉRKEZETT PROJEKT — jóváhagyásra vár
  if (projektRows.length > 0) {
    const lines = projektRows.map(function(r) {
      return '  • ' + r.szallitoNev +
             ' — ' + _formatAmount_(r.osszeg, r.deviza) +
             ' (határidő: ' + (r.fizhatarido || '–') + ')' +
             _urgency(r.fizhatarido);
    }).join('\n');
    sections.push('*📥 Jóváhagyásra vár — PROJEKT (' + projektRows.length + ' db):*\n' + lines);
  }

  // ── 2. HIÁNYOS_PO — kézi review, tétel-szintű bontással
  if (hianyosRows.length > 0) {
    const hianyosLines = hianyosRows.map(function(r) {
      let header = '  ⚠️ *' + r.szallitoNev + '* — ' +
                   _formatAmount_(r.osszeg, r.deviza) +
                   ' (`' + r.szamlaId + '`)' +
                   _urgency(r.fizhatarido);

      if (r.tetelek && r.tetelek.length > 0) {
        const tetelLines = r.tetelek.map(function(t) {
          const conf = (t.poConfidence !== undefined && t.poConfidence !== '')
            ? String(Math.round(Number(t.poConfidence))) + '%'
            : '?';
          const reasoning = t.poReasoning
            ? ' | ' + String(t.poReasoning).substring(0, 60)
            : '';
          return '      sor ' + (t.tetelSzam || '?') +
                 ': "' + String(t.leiras).substring(0, 40) + '"' +
                 ' → PO: ' + t.po +
                 ' | Conf: ' + conf +
                 reasoning;
        }).join('\n');
        header += '\n' + tetelLines;
      }
      return header;
    }).join('\n');

    sections.push(
      '*⚠️ HIÁNYOS_PO — kézi review (' + hianyosRows.length + ' db):*\n' +
      hianyosLines + '\n' +
      '_Teendő: PO kézzel → BEÉRKEZETT, vagy visszautasítás → VISSZAUTASÍTVA_'
    );
  }

  const totalRows = projektRows.length + hianyosRows.length;
  const text = '📋 *' + prefix + 'Szerda OPS digest — ' + totalRows + ' tétel*\n' +
               '• Tervezett utalási nap: *' + utalasStr + '*\n\n' +
               sections.join('\n\n');

  _sendToWebhook_(CONFIG.CHAT_WEBHOOK_OPS, text);
}

// ─────────────────────────────────────────────────────────────────────────────
// SZERDA 9:00 — FINANCE DIGEST (Péter)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Szerda reggel 9:00-kor a WednesdayWorkflow.gs hívja.
 * Finance webhook → Péter látja.
 *
 * Tartalom:
 *   1. BEÉRKEZETT + ÁLLANDÓ kategória → jóváhagyásra vár
 *   2. JÓVÁHAGYVA → utalásra vár (14:00-kor megy a kötegbe)
 *
 * @param {Array<{szamlaId, szallitoNev, osszeg, deviza, fizhatarido}>} pendingRows
 *   JÓVÁHAGYVA státuszú számlák (14:00-kor batch-be kerülnek)
 * @param {Date} utalasDate  - A következő banki munkanap (getNextWorkday())
 * @param {Array<{szamlaId, szallitoNev, osszeg, deviza, fizhatarido}>} [allandoRows]
 *   BEÉRKEZETT + ÁLLANDÓ kategóriájú számlák (opcionális, jóváhagyásra vár)
 */
function notifyWednesdayDigest(pendingRows, utalasDate, allandoRows) {
  const prefix    = CONFIG.TEST_MODE ? '[TEST] ' : '';
  const utalasStr = formatDate(utalasDate);
  const allando   = allandoRows || [];

  if (pendingRows.length === 0 && allando.length === 0) {
    const text = '📋 *' + prefix + 'Szerda Finance digest — nincs teendő*\n' +
                 'Nincs JÓVÁHAGYVA utalandó számla és nincs jóváhagyásra váró ÁLLANDÓ számla.';
    _sendToWebhook_(CONFIG.CHAT_WEBHOOK_FINANCE, text);
    return;
  }

  const todayMs     = new Date().setHours(0, 0, 0, 0);
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  function _urgency(fizhatarido) {
    if (!fizhatarido) return '';
    const hatMs = new Date(fizhatarido).setHours(0, 0, 0, 0);
    if (hatMs < todayMs) return ' ⚠️ *LEJÁRT*';
    if (hatMs - todayMs <= sevenDaysMs) return ' ⚠️ *<7 nap*';
    return '';
  }

  function _buildItemLines(rows) {
    const MAX_ROWS    = 10;
    const displayRows = rows.slice(0, MAX_ROWS);
    const extraCount  = rows.length - displayRows.length;
    let lines = displayRows.map(function(r) {
      return '  • ' + r.szallitoNev +
             ' — ' + _formatAmount_(r.osszeg, r.deviza) +
             ' (határidő: ' + (r.fizhatarido || '–') + ')' +
             _urgency(r.fizhatarido);
    }).join('\n');
    if (extraCount > 0) lines += '\n  _…és még ' + extraCount + ' számla_';
    return lines;
  }

  const sections = [];

  // ── 1. BEÉRKEZETT ÁLLANDÓ — jóváhagyásra vár
  if (allando.length > 0) {
    sections.push(
      '*🏢 Jóváhagyásra vár — ÁLLANDÓ (' + allando.length + ' db):*\n' +
      _buildItemLines(allando)
    );
  }

  // ── 2. JÓVÁHAGYVA — utalásra vár (14:00-kor batch generálás)
  if (pendingRows.length > 0) {
    // Összesítés devizánként
    const totals = {};
    pendingRows.forEach(function(r) {
      const dev = r.deviza || 'HUF';
      totals[dev] = (totals[dev] || 0) + (Number(r.osszeg) || 0);
    });
    const totalStr = Object.keys(totals).map(function(dev) {
      return _formatAmount_(totals[dev], dev);
    }).join(' + ');

    sections.push(
      '*💸 Utalásra vár — ' + pendingRows.length + ' db (összesen: ' + totalStr + '):*\n' +
      _buildItemLines(pendingRows)
    );
  }

  const totalTetelCount = pendingRows.length + allando.length;
  const text = '📋 *' + prefix + 'Szerda Finance digest — ' + totalTetelCount + ' tétel*\n' +
               '• Tervezett utalási nap: *' + utalasStr + '*\n\n' +
               sections.join('\n\n') + '\n\n' +
               '_Köteg generálás: 14:00-kor automatikusan._';

  _sendToWebhook_(CONFIG.CHAT_WEBHOOK_FINANCE, text);
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH KÉSZ ÉRTESÍTŐ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Szerda 14:00-kor a BatchGenerator.gs hívja, miután a .txt fájl elkészült.
 * Finance webhook → Péter feltölti MagNet-be.
 *
 * @param {string} kotegId
 * @param {number} szamlakSzama
 * @param {number} osszeg         - HUF összeg
 * @param {string} driveUrl       - A .txt fájl Drive URL-je
 * @param {string} utalasDate     - Utalási dátum string (YYYY-MM-DD)
 */
function notifyBatchReady(kotegId, szamlakSzama, osszeg, driveUrl, utalasDate) {
  const prefix = CONFIG.TEST_MODE ? '[TEST] ' : '';

  const text = '🏦 *' + prefix + 'MagNet átutalási csomag kész — feltöltésre vár*\n' +
               '• Köteg: `' + kotegId + '`\n' +
               '• Számlák: ' + szamlakSzama + ' db\n' +
               '• Összeg: *' + _formatAmount_(osszeg, 'HUF') + '*\n' +
               '• Utalási nap: *' + utalasDate + '*\n' +
               '• <' + driveUrl + '|CS-ÁTUTALÁS fájl letöltése>\n\n' +
               '*Teendő:* MagNet Business → Átutalások → Csoportos feltöltés';

  _sendToWebhook_(CONFIG.CHAT_WEBHOOK_FINANCE, text);
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK KÜLDŐ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Google Chat webhook üzenetet küld a megadott URL-re.
 * Ha a webhook sikertelen → Gmail fallback (notifyAdmin pattern).
 * Tesztmódban mindig az Admin webhook-ra megy (CONFIG-ban irányítva).
 *
 * @param {string} webhookUrl
 * @param {string} text         - Google Chat markdown szöveg
 */
function _sendToWebhook_(webhookUrl, text) {
  if (!webhookUrl) {
    console.warn('_sendToWebhook_: webhook URL nincs beállítva, kihagyva. Szöveg: ' +
      text.substring(0, 80));
    return;
  }

  try {
    const payload = { text: text };
    const response = UrlFetchApp.fetch(webhookUrl, {
      method:             'post',
      contentType:        'application/json',
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    if (code !== 200) {
      throw new Error('HTTP ' + code + ': ' + response.getContentText().substring(0, 200));
    }

  } catch (e) {
    console.error('Chat webhook hiba: ' + e.message);
    // Gmail fallback — ne hívjuk notifyAdmin()-t (végtelen rekurzió elkerülése)
    try {
      GmailApp.sendEmail(
        CONFIG.ADMIN_EMAIL,
        (CONFIG.TEST_MODE ? '[TEST] ' : '') + 'Armadillo Chat webhook hiba',
        'Webhook URL: ' + webhookUrl.substring(0, 60) + '...\n' +
        'Hiba: ' + e.message + '\n\n' +
        'Eredeti üzenet:\n' + text
      );
    } catch (emailErr) {
      console.error('Gmail fallback is sikertelen: ' + emailErr.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SEGÉDFÜGGVÉNYEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Státuszhoz tartozó emoji ikont ad vissza.
 * @param {string} statusz
 * @returns {string}
 */
function _statuszIcon_(statusz) {
  const icons = {
    'BEÉRKEZETT':    '📥',
    'HIÁNYOS_PO':    '⚠️',
    'VISSZAUTASÍTVA':'❌',
    'JÓVÁHAGYVA':    '✅',
    'UTALVA':        '💸',
    'AI_HIBA':       '🔴',
    'LOCK_TIMEOUT':  '🔒',
  };
  return icons[statusz] || '🔔';
}

/**
 * Összeget formáz olvasható formátumra.
 * Pl.: 127000, 'HUF' → '127 000 HUF'
 * @param {number} osszeg
 * @param {string} deviza
 * @returns {string}
 */
function _formatAmount_(osszeg, deviza) {
  if (!osszeg && osszeg !== 0) return '–';
  const num = Number(osszeg);
  if (isNaN(num)) return String(osszeg);
  const formatted = Math.round(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return formatted + ' ' + (deviza || 'HUF');
}

// ─────────────────────────────────────────────────────────────────────────────
// TESZTELŐ FÜGGVÉNYEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Az összes értesítő típust küldi — staging webhook-ra (TEST_MODE=true kell).
 * Futtatás: Script Editor → testAllNotifications → ▶ Run
 */
function testAllNotifications() {
  if (!CONFIG.TEST_MODE) {
    throw new Error('testAllNotifications() csak TEST_MODE=true esetén futtatható!');
  }
  if (!CONFIG.CHAT_WEBHOOK_ADMIN) {
    throw new Error('CONFIG.CHAT_WEBHOOK_ADMIN nincs beállítva!');
  }

  console.log('Értesítők tesztelése — mind az Admin webhook-ra megy (TEST_MODE)...');

  notifyNewInvoice(
    'INV-20260408-TEST1', 'Teszt Szállító Kft.', 127000, 'HUF',
    'BEÉRKEZETT', 'https://drive.google.com/file/d/FAKE'
  );
  console.log('✓ BEÉRKEZETT küldve');

  notifyNewInvoice(
    'INV-20260408-TEST2', 'Ismeretlen Partner Kft.', 85000, 'HUF',
    'HIÁNYOS_PO', 'https://drive.google.com/file/d/FAKE'
  );
  console.log('✓ HIÁNYOS_PO küldve');

  notifyStatusChange(
    'INV-20260408-TEST1', 'Teszt Szállító Kft.', 127000, 'HUF',
    'BEÉRKEZETT', 'JÓVÁHAGYVA', 'Ági'
  );
  console.log('✓ JÓVÁHAGYVA küldve');

  notifyStatusChange(
    'INV-20260408-TEST3', 'Visszautasított Kft.', 50000, 'HUF',
    'BEÉRKEZETT', 'VISSZAUTASÍTVA', 'Márk'
  );
  console.log('✓ VISSZAUTASÍTVA küldve');

  // OPS digest
  notifyOpsDigest(
    [
      { szamlaId: 'INV-001', szallitoNev: 'Alpha Kft.',  osszeg: 127000, deviza: 'HUF', fizhatarido: '2026-04-15' },
      { szamlaId: 'INV-002', szallitoNev: 'Beta Bt.',    osszeg: 85000,  deviza: 'HUF', fizhatarido: '2026-04-20' },
    ],
    [
      {
        szamlaId: 'INV-004', szallitoNev: 'Delta Kft.', osszeg: 50000, deviza: 'HUF', fizhatarido: '2026-04-15',
        poSummary: 'HIÁNYOS',
        tetelek: [
          { tetelSzam: 1, leiras: 'Tervezési díj', po: '–',        poConfidence: 42, poReasoning: 'Nem azonosítható PO', poValidalt: 'NEM' },
          { tetelSzam: 2, leiras: 'Anyagköltség',  po: 'IMME2601', poConfidence: 98, poReasoning: 'Egyértelmű egyezés',  poValidalt: 'IGEN' },
        ],
      },
    ],
    new Date(2026, 3, 15)
  );
  console.log('✓ OPS digest küldve');

  // Finance digest
  notifyWednesdayDigest(
    [
      { szamlaId: 'INV-003', szallitoNev: 'Gamma Zrt.', osszeg: 220000, deviza: 'HUF', fizhatarido: '2026-04-15' },
    ],
    new Date(2026, 3, 15),
    [
      { szamlaId: 'INV-005', szallitoNev: 'Bérleti Kft.', osszeg: 180000, deviza: 'HUF', fizhatarido: '2026-04-30' },
    ]
  );
  console.log('✓ Finance digest küldve');

  notifyBatchReady(
    'KOTEG-20260408-XY12', 3, 432000,
    'https://drive.google.com/file/d/FAKE_BATCH',
    '2026-04-15'
  );
  console.log('✓ Batch kész küldve');

  notifyAdmin(
    'Teszt admin értesítő',
    'Ez egy teszthiba üzenet az Admin webhookra.',
    new Error('Szimulált hiba stack trace-szel')
  );
  console.log('✓ Admin értesítő küldve');

  console.log('════════════════════════════════════════');
  console.log('✅ Minden értesítő elküldve. Ellenőrizd az Admin Chat space-t!');
}
