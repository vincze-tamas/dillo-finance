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
// STÁTUSZGÉP — KÖZÖS STATE MACHINE (Validation.gs + _onBejovoszamlaStatuszChange_ is használja)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Érvényes státusz átmenetek definíciója.
 * Kulcs = régi státusz, érték = megengedett új státuszok tömbje.
 * Üres tömb = terminális (semmi nem engedett). Hiányzó kulcs = ismeretlen → nincs korlát.
 *
 * Module-level Object.freeze — egyszer épül, NEM épül újra minden trigger hívásnál.
 * Validation.gs és _onBejovoszamlaStatuszChange_ egyaránt innen olvas.
 */
const STATUSZ_ATMENETEK_ = Object.freeze({
  'BEÉRKEZETT':    ['JÓVÁHAGYVA', 'VISSZAUTASÍTVA'],
  'HIÁNYOS_PO':    ['JÓVÁHAGYVA', 'VISSZAUTASÍTVA', 'BEÉRKEZETT'],
  'AI_HIBA':       ['BEÉRKEZETT'],
  'LOCK_TIMEOUT':  ['BEÉRKEZETT'],
  'JÓVÁHAGYVA':    ['UTALVA', 'VISSZAUTASÍTVA'],
  'VISSZAUTASÍTVA': [],  // terminális
  'UTALVA':         [],  // terminális
});

/**
 * Megvizsgálja, hogy a régi → új státusz átmenet tiltott-e.
 * Felhasználja: Validation.gs _getAuditAction_() + _onBejovoszamlaStatuszChange_() guard.
 *
 * @param {string} regiStatusz - előző státusz ('' ha cella üres volt)
 * @param {string} ujStatusz   - új státusz
 * @returns {boolean} true = TILTOTT, false = engedélyezett
 */
function _isStatuszTiltott_(regiStatusz, ujStatusz) {
  if (!regiStatusz) return false; // üres régi → script first write → mindig engedett
  const megengedett = STATUSZ_ATMENETEK_.hasOwnProperty(regiStatusz)
    ? STATUSZ_ATMENETEK_[regiStatusz]
    : null; // ismeretlen régi érték → engedjük (forward compat)
  return megengedett !== null && megengedett.indexOf(ujStatusz) === -1;
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
  // STATUSZ_ATMENETEK_ és _isStatuszTiltott_() fentebb definiálva (module-level).
  // Audit: NEM hívjuk _writeAuditRow_-t itt — a Validation.gs universal audit
  // (_getAuditAction_) már STATUSZ_TILTOTT_ATMENET action-nel logolta.
  // Így pontosan 1 audit bejegyzés keletkezik (dupla log elkerülve).

  const regiTrimmed = regiStatusz.trim();
  const ujTrimmed   = ujStatusz.trim();

  if (_isStatuszTiltott_(regiTrimmed, ujTrimmed)) {
    // 1. Visszaállítás
    sheet.getRange(row, c.STATUSZ).setValue(regiTrimmed);

    // 2. Felhasználói értesítő — terminális vs. nem engedélyezett eset eltér
    const megengedett = STATUSZ_ATMENETEK_.hasOwnProperty(regiTrimmed)
      ? STATUSZ_ATMENETEK_[regiTrimmed] : [];
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

  // ── VISSZAUTASÍTVA → visszautasítás email + PDF áthelyezés ───────────────
  if (ujTrimmed === 'VISSZAUTASÍTVA') {
    const adoszam     = String(rowData[c.ADOSZAM       - 1] || '');
    const szamlaszam  = String(rowData[c.SZAMLASZAM    - 1] || szamlaId);
    const driveFileId = String(rowData[c.DRIVE_FILE_ID - 1] || '');

    try {
      _sendRejectionEmailToPartner_(adoszam, szallitoNev, szamlaszam, visszautasitasOka);
    } catch (e) {
      console.error('Visszautasítás email hiba: ' + e.message);
      notifyAdmin('Visszautasítás email sikertelen', e.message, e);
    }

    if (driveFileId) {
      try {
        _movePdfToRejectedFolder_(driveFileId);
      } catch (e) {
        console.error('PDF áthelyezés hiba: ' + e.message);
        notifyAdmin('PDF áthelyezés sikertelen', e.message, e);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VISSZAUTASÍTÁS SEGÉDFÜGGVÉNYEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Partner email keresése adószám alapján a PARTNEREK fülből.
 * @param {string} adoszam
 * @returns {string|null} email cím, vagy null ha nincs találat / üres
 */
function _getPartnerEmail_(adoszam) {
  if (!adoszam) return null;
  try {
    const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.TABS.PARTNEREK);
    if (!sheet) { console.warn('_getPartnerEmail_: PARTNEREK fül nem található.'); return null; }
    const data = sheet.getDataRange().getValues();
    const c    = CONFIG.COLS.PARTNER;
    for (let i = 1; i < data.length; i++) { // 0. sor = fejléc
      if (String(data[i][c.ADOSZAM - 1]).trim() === adoszam.trim()) {
        const email = String(data[i][c.EMAIL - 1]).trim();
        console.log('  Partner email megtalálva: ' + email + ' (adószám: ' + adoszam + ')');
        return email || null;
      }
    }
    console.warn('  Partner nem található a PARTNEREK fülön: ' + adoszam);
    return null;
  } catch (e) {
    console.error('_getPartnerEmail_ hiba: ' + e.message);
    return null;
  }
}

/**
 * Visszautasítás email küldése a partnernek.
 *
 * TEST_MODE = true  → email az ADMIN_EMAIL-re megy (nem a valódi partnernek)
 * TEST_MODE = false → email a partner PARTNEREK.E oszlopában lévő cimre megy;
 *                     ha nincs partner email, fallback → ADMIN_EMAIL + figyelmeztetés
 *
 * @param {string} adoszam          - Szállító adószáma (PARTNEREK lookup kulcsa)
 * @param {string} szallitoNev      - Szállító neve (levéltörzsbe kerül)
 * @param {string} szamlaszam       - Számla sorszáma (tárgy + levéltörzs)
 * @param {string} visszautasitasOka- T oszlop értéke (opcionális — üres string ha nincs)
 */
function _sendRejectionEmailToPartner_(adoszam, szallitoNev, szamlaszam, visszautasitasOka) {
  const partnerEmail = _getPartnerEmail_(adoszam);

  // TEST_MODE: mindig ADMIN_EMAIL-re megy, a valódi cím a logban látható
  const toEmail = CONFIG.TEST_MODE
    ? CONFIG.ADMIN_EMAIL
    : (partnerEmail || CONFIG.ADMIN_EMAIL);

  if (!toEmail) {
    console.warn('Visszautasítás email: nincs elérhető célcím — email nem küldve.');
    return;
  }

  const subject = '[Armadillo] Számla visszautasítva — ' + szamlaszam;
  const body =
    'Tisztelt Partnerünk!\n\n' +
    'A(z) ' + szamlaszam + ' számú számlájának befogadását visszautasítottuk.\n' +
    (visszautasitasOka
      ? '\nVisszautasítás oka:\n' + visszautasitasOka + '\n'
      : '') +
    '\nKérjük, javított számlát küldjön, vagy vegye fel velünk a kapcsolatot.\n\n' +
    'Üdvözlettel,\n' +
    'Armadillo Design Kft.\n' +
    'szamlazas@armadillo.hu';

  GmailApp.sendEmail(toEmail, subject, body);
  console.log('✅ Visszautasítás email elküldve → ' + toEmail +
    (CONFIG.TEST_MODE
      ? ' [TEST_MODE — valódi partner email: ' + (partnerEmail || 'nincs a PARTNEREK fülön') + ']'
      : ''));
}

/**
 * PDF fájl áthelyezése a Visszautasított Drive mappába.
 * Eltávolítja a fájlt az eredeti (Bejövő) mappából is.
 * Hibatűrő: ha a REJECTED_FOLDER_ID nincs beállítva, csak logol — nem dob kivételt.
 *
 * @param {string} fileId - Drive fájl ID (BEJÖVŐ_SZÁMLÁK M oszlop)
 */
function _movePdfToRejectedFolder_(fileId) {
  if (!CONFIG.REJECTED_FOLDER_ID) {
    console.warn('REJECTED_FOLDER_ID nincs beállítva a Configban — PDF nem helyezhető át.');
    return;
  }
  const file           = DriveApp.getFileById(fileId);
  const rejectedFolder = DriveApp.getFolderById(CONFIG.REJECTED_FOLDER_ID);

  // Jelenlegi szülő mappák lekérése AZ ÁTHELYEZÉS ELŐTT
  // (Drive API: getParents() iterator, moveFile() szintaxis GAS-ban nem mindig stabil)
  const parentIds = [];
  const parents   = file.getParents();
  while (parents.hasNext()) {
    parentIds.push(parents.next().getId());
  }

  // Hozzáad az új (Visszautasított) mappához
  rejectedFolder.addFile(file);

  // Eltávolít minden korábbi szülőből (a Visszautasított mappát kivéve)
  parentIds.forEach(function(pid) {
    if (pid !== CONFIG.REJECTED_FOLDER_ID) {
      try {
        DriveApp.getFolderById(pid).removeFile(file);
      } catch (e) {
        console.warn('  Régi mappa eltávolítás sikertelen (' + pid + '): ' + e.message);
      }
    }
  });

  console.log('✅ PDF áthelyezve → Visszautasított mappa: "' + file.getName() + '"');
}
