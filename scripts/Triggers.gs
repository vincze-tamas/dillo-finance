/**
 * Triggers.gs
 * Armadillo Pénzügyi Automatizáció — Trigger telepítő / eltávolító
 *
 * FUTTATÁS: autobot@armadillo.hu fiókból, Script Editor-ban
 * SORREND:
 *   1. setupSSOT()        — Setup.gs
 *   2. protectSSOT()      — Setup.gs
 *   3. setupAllTriggers() — Triggers.gs  ← ez a fájl
 *
 * Triggerek összefoglalója:
 *   onEditInstallable      — SSOT sheet szerkesztésekor (Validation + ChatNotifier)
 *   processNewInvoices     — 15 percenként (GmailDrive.gs)
 *   wednesdayMorningDigest — Minden nap 09:00 (WednesdayWorkflow.gs)
 *   wednesdayAfternoonBatch— Minden nap 14:00 (WednesdayWorkflow.gs)
 *   monthlyFirstOfMonth    — Minden hónap 1-jén 09:00 (éves teendők)
 */

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER NEVEK — egyetlen helyen definiálva
// ─────────────────────────────────────────────────────────────────────────────

const TRIGGER_FUNCTIONS = {
  ON_EDIT:          'onEditInstallable',
  GMAIL_POLLER:     'processNewInvoices',
  MORNING_DIGEST:   'wednesdayMorningDigest',
  AFTERNOON_BATCH:  'wednesdayAfternoonBatch',
  MONTHLY:          'monthlyFirstOfMonth',
};

// ─────────────────────────────────────────────────────────────────────────────
// TELEPÍTÉS — FŐ BELÉPÉSI PONT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Telepíti az összes triggert. Idempotens — meglévő triggereket nem duplikálja.
 * Futtatás: Script Editor → setupAllTriggers → ▶ Run
 */
function setupAllTriggers() {
  console.log('════════════════════════════════════════');
  console.log('Trigger telepítés...');
  console.log('TEST_MODE: ' + CONFIG.TEST_MODE);
  console.log('SPREADSHEET_ID: ' + CONFIG.SPREADSHEET_ID);
  console.log('════════════════════════════════════════');

  if (!CONFIG.SPREADSHEET_ID) {
    throw new Error('CONFIG.SPREADSHEET_ID nincs beállítva!');
  }

  const existing = _getExistingTriggerFunctions_();
  console.log('Meglévő triggerek: [' + Array.from(existing).join(', ') + ']');

  _ensureOnEditTrigger_(existing);
  _ensureTimeTrigger_(existing, TRIGGER_FUNCTIONS.GMAIL_POLLER,    'everyMinutes', 15);
  _ensureTimeTrigger_(existing, TRIGGER_FUNCTIONS.MORNING_DIGEST,  'everyDays',    1,  9);
  _ensureTimeTrigger_(existing, TRIGGER_FUNCTIONS.AFTERNOON_BATCH, 'everyDays',    1,  14);
  _ensureTimeTrigger_(existing, TRIGGER_FUNCTIONS.MONTHLY,         'onMonthDay',   1,  9);

  console.log('════════════════════════════════════════');
  console.log('✅ Trigger telepítés kész.');
  listTriggers();
}

// ─────────────────────────────────────────────────────────────────────────────
// EGYEDI TRIGGER TELEPÍTŐK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Installable onEdit trigger — csak ha még nem létezik.
 * @param {Set<string>} existing
 */
function _ensureOnEditTrigger_(existing) {
  if (existing.has(TRIGGER_FUNCTIONS.ON_EDIT)) {
    console.log('ℹ️  onEdit trigger már létezik — kihagyva.');
    return;
  }
  ScriptApp.newTrigger(TRIGGER_FUNCTIONS.ON_EDIT)
    .forSpreadsheet(CONFIG.SPREADSHEET_ID)
    .onEdit()
    .create();
  console.log('✓ onEdit trigger telepítve → ' + TRIGGER_FUNCTIONS.ON_EDIT);
}

/**
 * Time-driven trigger — csak ha még nem létezik.
 * @param {Set<string>} existing
 * @param {string}      fnName        - Trigger célfunction neve
 * @param {string}      type          - 'everyMinutes' | 'everyDays' | 'onMonthDay'
 * @param {number}      intervalOrDay - Érték: percek (everyMinutes), napok (everyDays),
 *                                      vagy hónapnap 1–31 (onMonthDay). MIN-06: korábban
 *                                      `interval` volt, ami onMonthDay esetén félrevezető.
 * @param {number}      [hour]        - Napi / havi triggereknél az óra (0-23)
 */
function _ensureTimeTrigger_(existing, fnName, type, intervalOrDay, hour) {
  if (existing.has(fnName)) {
    console.log('ℹ️  ' + fnName + ' trigger már létezik — kihagyva.');
    return;
  }

  let builder = ScriptApp.newTrigger(fnName).timeBased();

  if (type === 'everyMinutes') {
    builder = builder.everyMinutes(intervalOrDay);
  } else if (type === 'everyDays') {
    builder = builder.everyDays(intervalOrDay).atHour(hour).inTimezone('Europe/Budapest');
  } else if (type === 'onMonthDay') {
    builder = builder.onMonthDay(intervalOrDay).atHour(hour).inTimezone('Europe/Budapest');
  } else {
    // MIN-05: ismeretlen type esetén explicit hiba — ne hozzon létre konfigurált trigger nélküli ütemezést
    throw new Error('_ensureTimeTrigger_: ismeretlen trigger type: "' + type + '"');
  }

  builder.create();
  console.log('✓ ' + fnName + ' trigger telepítve (' + type + ':' + intervalOrDay +
    (hour !== undefined ? ', ' + hour + ':00' : '') + ')');
}

// ─────────────────────────────────────────────────────────────────────────────
// ELTÁVOLÍTÁS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Eltávolítja az összes Armadillo triggert.
 * Hasznos: élesítés előtti reset, hibakeresés.
 * Futtatás: Script Editor → removeAllTriggers → ▶ Run
 */
function removeAllTriggers() {
  const targets = new Set(Object.values(TRIGGER_FUNCTIONS));
  const all     = ScriptApp.getProjectTriggers();
  let   removed = 0;

  all.forEach(function(t) {
    if (targets.has(t.getHandlerFunction())) {
      ScriptApp.deleteTrigger(t);
      console.log('✓ Törölve: ' + t.getHandlerFunction());
      removed++;
    }
  });

  console.log('Összes törölt trigger: ' + removed);
  if (removed === 0) console.log('ℹ️  Nem volt törölnivaló trigger.');
}

/**
 * Csak az onEdit triggert távolítja el — pl. ha újra kell telepíteni.
 * Futtatás: Script Editor → removeOnEditTrigger → ▶ Run
 */
function removeOnEditTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === TRIGGER_FUNCTIONS.ON_EDIT) {
      ScriptApp.deleteTrigger(t);
      console.log('✓ onEdit trigger törölve.');
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉVES TEENDŐK — monthlyFirstOfMonth hívja
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minden hónap 1-jén 09:00-kor fut.
 * December 1.: figyelmeztetés a következő évi naptár frissítésére.
 * Január 1.:   az előző évi LAST_DIGEST_DATE / LAST_BATCH_DATE reset.
 * NE nevezd át — Triggers.gs erre a névre hivatkozik.
 */
function monthlyFirstOfMonth() {
  const now   = new Date();
  const month = now.getMonth(); // 0-alapú: 0=jan, 11=dec

  if (month === 11) _decemberReminder_(now);
  if (month === 0)  _januaryReset_(now);
  // Más hónapokban nem csinál semmit
}

/**
 * December 1.: emlékeztetőt küld az Admin webhook-ra a naptár frissítéséről.
 * @param {Date} now
 */
function _decemberReminder_(now) {
  const nextYear = now.getFullYear() + 1;
  console.log('December 1. — éves naptár emlékeztető: ' + nextYear);

  // MIN-08: Chat és email szöveg szétválasztva.
  // A notifyAdmin() emailben is elküldi a szöveget — Chat *bold* markdown ott nyers
  // csillagként jelenne meg. Az emailMsg plain text, a chatMsg Chat-formázott.
  const chatMsg =
    '📅 *Éves teendő — naptár frissítés szükséges*\n' +
    'A CONFIG fülön add hozzá a ' + nextYear + '. évi adatokat:\n' +
    '• `HOLIDAYS_' + nextYear + '` — munkaszüneti napok (vesszővel, YYYY-MM-DD)\n' +
    '• `WORKING_SATURDAYS_' + nextYear + '` — áthelyezett munkanapok\n' +
    'Forrás: https://www.napi.hu/Magyar_gazdasag/munkaszuneti-napok.html\n' +
    'Státusz: ELLENŐRZENDŐ → VERIFIED (miután beírtad)\n\n' +
    '_Ha ez nem kerül be, a munkanap számítás ' + nextYear + '-ban pontatlan lesz._';

  const emailMsg =
    'Éves teendő — naptár frissítés szükséges\n' +
    'A CONFIG fülön add hozzá a ' + nextYear + '. évi adatokat:\n' +
    '- HOLIDAYS_' + nextYear + ' — munkaszüneti napok (vesszővel, YYYY-MM-DD)\n' +
    '- WORKING_SATURDAYS_' + nextYear + ' — áthelyezett munkanapok\n' +
    'Forrás: https://www.napi.hu/Magyar_gazdasag/munkaszuneti-napok.html\n' +
    'Státusz: ELLENŐRZENDŐ → VERIFIED (miután beírtad)\n\n' +
    'Ha ez nem kerül be, a munkanap számítás ' + nextYear + '-ban pontatlan lesz.';

  // Admin (IT) értesítés — plain text email
  notifyAdmin('Éves naptár frissítés szükséges — ' + nextYear, emailMsg);
  // OPS (Ági) értesítés — Chat markdown formázással
  _sendToWebhook_(CONFIG.CHAT_WEBHOOK_OPS, chatMsg);
}

/**
 * Január 1.: törli az előző évi LAST_DIGEST_DATE / LAST_BATCH_DATE értékeket,
 * hogy az első munkanap digest tiszta lappal indulhasson.
 * @param {Date} now
 */
function _januaryReset_(now) {
  console.log('Január 1. — digest/batch dátum reset...');
  try {
    const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.TABS.CONFIG);
    const data  = sheet.getDataRange().getValues();
    const keysToReset = ['LAST_DIGEST_DATE', 'LAST_BATCH_DATE'];

    data.forEach(function(row, i) {
      if (i === 0) return; // fejléc
      if (keysToReset.indexOf(String(row[0]).trim()) !== -1) {
        sheet.getRange(i + 1, 2).setValue('');
        sheet.getRange(i + 1, 3).setValue('RESET_JAN1');
        console.log('  Reset: ' + row[0]);
      }
    });
    console.log('✅ Január 1. reset kész.');
  } catch (e) {
    console.error('Január reset hiba: ' + e.message);
    notifyAdmin('Január 1. reset hiba', e.message, e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTÁZÁS ÉS ELLENŐRZÉS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Listázza az összes aktív triggert.
 * Futtatás: Script Editor → listTriggers → ▶ Run
 */
function listTriggers() {
  const all     = ScriptApp.getProjectTriggers();
  const targets = new Set(Object.values(TRIGGER_FUNCTIONS));

  console.log('══════════════════════════════════════');
  console.log('Aktív triggerek (' + all.length + ' db):');
  console.log('══════════════════════════════════════');

  if (all.length === 0) {
    console.log('  (nincs trigger telepítve)');
    return;
  }

  all.forEach(function(t) {
    const fn      = t.getHandlerFunction();
    const type    = t.getEventType();
    const isOurs  = targets.has(fn);
    const marker  = isOurs ? '✓' : '?';
    console.log(marker + ' [' + fn + '] — ' + type);
  });

  // Hiányzó triggerek ellenőrzése
  const existing = _getExistingTriggerFunctions_();
  const missing  = Object.values(TRIGGER_FUNCTIONS).filter(function(fn) {
    return !existing.has(fn);
  });

  if (missing.length > 0) {
    console.log('');
    console.log('⚠️  Hiányzó triggerek (' + missing.length + ' db):');
    missing.forEach(function(fn) { console.log('   → ' + fn); });
    console.log('Futtasd: setupAllTriggers()');
  } else {
    console.log('');
    console.log('✅ Minden elvárt trigger aktív.');
  }
}

/**
 * Visszaadja a meglévő trigger handler function neveket Set-ben.
 * @returns {Set<string>}
 */
function _getExistingTriggerFunctions_() {
  return new Set(
    ScriptApp.getProjectTriggers().map(function(t) { return t.getHandlerFunction(); })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDÁCIÓ.GS KIEGÉSZÍTÉS — STÁTUSZ VÁLTOZÁS DETEKTÁLÁS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ezt a függvényt az onEditInstallable() hívja, ha BEJÖVŐ_SZÁMLÁK Q oszlopa változik.
 * 1. Státuszgép guard — tiltott átmenet esetén revert + audit + alert
 * 2. JÓVÁHAGYÓ email + dátum automatikus beírása (érvényes átmenetnél)
 * 3. Chat értesítő küldése
 *
 * MEGJEGYZÉS: Ez a kód ide kerül azért, mert szorosan kapcsolódik a trigger
 * életciklushoz — de az onEditInstallable maga a Validation.gs-ben van.
 * Lásd: Validation.gs → onEditInstallable() → _onBejovoszamlaStatuszChange_() hívás.
 *
 * Érvényes átmenetek:
 *   BEÉRKEZETT    → JÓVÁHAGYVA, VISSZAUTASÍTVA
 *   HIÁNYOS_PO    → JÓVÁHAGYVA, VISSZAUTASÍTVA, BEÉRKEZETT
 *   AI_HIBA       → BEÉRKEZETT
 *   LOCK_TIMEOUT  → BEÉRKEZETT
 *   JÓVÁHAGYVA    → UTALVA, VISSZAUTASÍTVA
 *   VISSZAUTASÍTVA → (terminális — semmi)
 *   UTALVA         → (terminális — semmi)
 *
 * @param {Sheet}  sheet
 * @param {number} row
 * @param {string} ujStatusz   - Az új státusz érték (e.value)
 * @param {string} regiStatusz - Az előző érték (e.oldValue, '' ha cella üres volt)
 */
function _onBejovoszamlaStatuszChange_(sheet, row, ujStatusz, regiStatusz) {
  const c = CONFIG.COLS.BEJOVO;

  // ── STÁTUSZGÉP GUARD ──────────────────────────────────────────────────────
  // Érvényes átmenetek: kulcs = régi státusz, érték = megengedett új státuszok tömbje.
  // Terminális státusznál üres tömb → semmilyen átmenet nem megengedett.
  // Ismeretlen régi státusz (pl. jövőbeni értékek) → engedjük át (null = nincs korlát).
  const ATMENETEK = {
    'BEÉRKEZETT':    ['JÓVÁHAGYVA', 'VISSZAUTASÍTVA'],
    'HIÁNYOS_PO':    ['JÓVÁHAGYVA', 'VISSZAUTASÍTVA', 'BEÉRKEZETT'],
    'AI_HIBA':       ['BEÉRKEZETT'],
    'LOCK_TIMEOUT':  ['BEÉRKEZETT'],
    'JÓVÁHAGYVA':    ['UTALVA', 'VISSZAUTASÍTVA'],
    'VISSZAUTASÍTVA': [],  // terminális
    'UTALVA':         [],  // terminális
  };

  const regiTrimmed = regiStatusz.trim();
  const ujTrimmed   = ujStatusz.trim();

  // Üres régi érték → script/setup első beírása → engedjük át
  if (regiTrimmed !== '') {
    const megengedett = ATMENETEK.hasOwnProperty(regiTrimmed)
      ? ATMENETEK[regiTrimmed]
      : null; // ismeretlen régi érték → nem blokkoljuk (forward compat)

    if (megengedett !== null && megengedett.indexOf(ujTrimmed) === -1) {
      // ── TILTOTT ÁTMENET ───────────────────────────────────────────────────
      // 1. Visszaállítás az eredeti értékre
      sheet.getRange(row, c.STATUSZ).setValue(regiTrimmed);

      // 2. Audit: közvetlen _writeAuditRow_ hívás — logAudit_() nem érhető el itt
      //    (nincs `e` event objektum), de a forrás FELHASZNALO és az entitás SZAMLA
      const szamlaIdAudit = String(
        sheet.getRange(row, c.SZAMLA_ID).getValue() || ('sor ' + row));
      const userAudit = Session.getActiveUser().getEmail() || 'ismeretlen';
      _writeAuditRow_(userAudit, AUDIT_FORRAS.FELHASZNALO, AUDIT_ENTITAS.SZAMLA,
        AUDIT_MUVELET.STATUSZ_TILTOTT_ATMENET,
        szamlaIdAudit, 'Státusz', regiTrimmed, ujTrimmed);

      // 3. Felhasználói értesítő — terminális vs. nem engedélyezett eset eltér
      const reszletek = (megengedett.length === 0)
        ? '"' + regiTrimmed + '" végleges státusz — nem módosítható.'
        : '"' + regiTrimmed + '" → "' + ujTrimmed + '" nem engedélyezett.\n' +
          'Megengedett átmenet(ek): ' + megengedett.join(' / ');

      SpreadsheetApp.getUi().alert(
        '⛔ Érvénytelen státusz változtatás!\n\n' +
        reszletek + '\n\n' +
        'Eredeti érték visszaállítva. A kísérlet naplózva.'
      );
      return; // Korai kilépés — chat értesítő és auto-fill NEM fut le
    }
  }

  // ── ÉRVÉNYES ÁTMENET — sordata olvasás, auto-fill, chat értesítő ─────────
  // KOZ-07: c.VISSZAUTASITAS_OKA (T=20) oszlopig olvassuk a sort,
  // hogy a visszautasítás oka is bekerüljön az értesítőbe.
  const rowData = sheet.getRange(row, 1, 1, c.VISSZAUTASITAS_OKA).getValues()[0];

  const szamlaId          = String(rowData[c.SZAMLA_ID          - 1] || '');
  const szallitoNev       = String(rowData[c.SZALLITO_NEV       - 1] || '');
  const osszeg            = Number(rowData[c.OSSZEG_BRUTTO      - 1] || 0);
  const deviza            = String(rowData[c.DEVIZA             - 1] || 'HUF');
  const visszautasitasOka = String(rowData[c.VISSZAUTASITAS_OKA - 1] || '');

  const regiStatuszDisplay = regiTrimmed || '(üres)';
  console.log('Státusz változás: ' + szamlaId + ' | ' +
    regiStatuszDisplay + ' → ' + ujTrimmed);

  // JÓVÁHAGYÓ emailje: az aktív felhasználó emailje kerül a sheet-be ÉS a Chat üzenetbe
  // (aki változtatta a státuszt, annak emailje — sheet-ből olvasva még üres lenne)
  const userEmail = Session.getActiveUser().getEmail();
  const jovahagyo = userEmail || String(rowData[c.JOVAHAGYO - 1] || '');
  if (userEmail) {
    sheet.getRange(row, c.JOVAHAGYO).setValue(userEmail);
  }

  // JÓVÁHAGYÁS dátuma automatikus beírása (csak JÓVÁHAGYVA esetén)
  if (ujTrimmed === 'JÓVÁHAGYVA') {
    sheet.getRange(row, c.JOVAHAGYAS_DATUM).setValue(formatDate(new Date()));
  }

  // Chat értesítő
  try {
    notifyStatusChange(szamlaId, szallitoNev, osszeg, deviza,
      regiStatuszDisplay, ujTrimmed, jovahagyo, visszautasitasOka);
  } catch (e) {
    console.error('notifyStatusChange hiba: ' + e.message);
  }
}
