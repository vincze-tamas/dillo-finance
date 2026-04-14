/**
 * Utils.gs
 * Armadillo Pénzügyi Automatizáció — Segédfüggvények
 *
 * Tartalom:
 *  - withRetry()         Exponenciális backoff wrapper API hívásokhoz
 *  - getNextWorkday()    Következő banki munkanap (ünnepnapok + áthelyezett szombatok figyelembevételével)
 *  - notifyAdmin()       Admin email + Admin Chat webhook hibaértesítő
 *  - acquireLock()       LockService wrapper — LOCK_TIMEOUT hiba ha nem sikerül
 *  - formatDate()        YYYY-MM-DD formátum
 *  - hungarianMonth()    "04_Április" formátum (Drive mappa névhez)
 *  - asciiTranslit()     Magyar ékezetek → ASCII (MagNet batch fájlhoz)
 *  - generateId()        Egyedi ID generálás (Számlák, Allokációk)
 */

// ─────────────────────────────────────────────────────────────────────────────
// RETRY WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exponenciális backoff-fal ismétli meg a függvényt hiba esetén.
 * Alapértelmezett: 3 próbálkozás, 30s → 60s → 90s várakozás.
 *
 * @param {Function} fn          - A meghívandó függvény (paraméter nélküli, értéket ad vissza)
 * @param {number}   maxRetries  - Max próbálkozás (alapértelmezett: 3)
 * @param {number}   baseDelayMs - Első várakozás ms-ban (alapértelmezett: 30000)
 * @returns {*} A függvény visszatérési értéke
 * @throws Ha az összes próbálkozás sikertelen
 */
function withRetry(fn, maxRetries, baseDelayMs) {
  maxRetries  = maxRetries  || 3;
  baseDelayMs = baseDelayMs || 30000;

  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * attempt; // 30s, 60s, 90s
        console.warn('withRetry: ' + attempt + '. próbálkozás sikertelen. ' +
          'Várakozás: ' + (delayMs / 1000) + 's. Hiba: ' + e.message);
        Utilities.sleep(delayMs);
      }
    }
  }
  throw new Error('withRetry: ' + maxRetries + ' próbálkozás után is sikertelen. ' +
    'Utolsó hiba: ' + lastError.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// KÖVETKEZŐ BANKI MUNKANAP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Visszaadja a megadott dátumhoz képest a következő banki munkanapot.
 * Figyelembe veszi:
 *  - hétvégéket
 *  - a CONFIG fülön HOLIDAYS_{ÉV} kulcsban tárolt ünnepnapokat
 *  - a CONFIG fülön WORKING_SATURDAYS_{ÉV} kulcsban tárolt áthelyezett munkanapokat
 *
 * Ha HOLIDAYS vagy WORKING_SATURDAYS státusza nem "VERIFIED", logol de nem áll meg
 * — a rendszer működik, de a naptár pontossága nem garantált.
 *
 * @param {Date}   fromDate  - Kiindulási dátum (alapértelmezett: ma)
 * @param {number} addDays   - Hány munkanapot adjunk hozzá (alapértelmezett: 0 = maga a nap, ha munkanap)
 * @returns {Date}
 */
function getNextWorkday(fromDate, addDays) {
  fromDate = fromDate || new Date();
  addDays  = (addDays === undefined) ? 0 : addDays;

  // CONFIG fül egyszeri olvasás futásonként — futásonkénti cache a redundáns API hívások ellen.
  // Egy trigger-futáson belül a CONFIG nem változik, cache biztonságos.
  // Ez 4× _getConfigSet_ hívást vált ki eddig (= 4 getDataRange().getValues()) → most 1×.
  if (!getNextWorkday._configCache) {
    const ss          = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const configSheet = ss.getSheetByName(CONFIG.TABS.CONFIG);
    getNextWorkday._configCache = configSheet.getDataRange().getValues();
  }
  const configData = getNextWorkday._configCache;

  const year           = fromDate.getFullYear();
  const holidays       = _getConfigSetFromData_(configData, 'HOLIDAYS_'         + year);
  const workingSats    = _getConfigSetFromData_(configData, 'WORKING_SATURDAYS_' + year);
  const holidaysNext   = _getConfigSetFromData_(configData, 'HOLIDAYS_'         + (year + 1));
  const workingSatsNext= _getConfigSetFromData_(configData, 'WORKING_SATURDAYS_' + (year + 1));

  const allHolidays    = new Set([...holidays,    ...holidaysNext]);
  const allWorkingSats = new Set([...workingSats,  ...workingSatsNext]);

  // Ha az aktuális évi lista nem VERIFIED, figyelmeztetünk
  const status = _getConfigStatusFromData_(configData, 'HOLIDAYS_' + year);
  if (status && status !== 'VERIFIED') {
    console.warn('getNextWorkday: HOLIDAYS_' + year +
      ' státusza "' + status + '" — nem VERIFIED. Dátumszámítás pontatlan lehet!');
  }
  const satStatus = _getConfigStatusFromData_(configData, 'WORKING_SATURDAYS_' + year);
  if (satStatus && satStatus !== 'VERIFIED') {
    console.warn('getNextWorkday: WORKING_SATURDAYS_' + year +
      ' státusza "' + satStatus + '" — nem VERIFIED. Dátumszámítás pontatlan lehet!');
  }

  let current  = new Date(fromDate);
  current.setHours(0, 0, 0, 0);
  let remaining = addDays;

  // Ha addDays=0 és az aktuális nap munkanap → visszaadjuk
  // Különben előre lépkedünk
  if (!_isWorkday_(current, allHolidays, allWorkingSats)) {
    // Ha a kiindulási nap nem munkanap, ugrunk a következőre
    remaining = Math.max(remaining, 1);
  }

  while (remaining > 0) {
    current.setDate(current.getDate() + 1);
    if (_isWorkday_(current, allHolidays, allWorkingSats)) {
      remaining--;
    }
  }

  return current;
}

/**
 * @param {Date}   date
 * @param {Set}    holidays
 * @param {Set}    workingSats
 * @returns {boolean}
 */
function _isWorkday_(date, holidays, workingSats) {
  const dayOfWeek = date.getDay(); // 0=vasárnap, 6=szombat
  const iso       = formatDate(date);

  if (holidays.has(iso)) return false;       // Ünnepnap
  if (dayOfWeek === 0)   return false;       // Vasárnap
  if (dayOfWeek === 6)   return workingSats.has(iso); // Szombat: csak ha áthelyezett
  return true;
}

/**
 * Kiolvas egy vesszővel tagolt dátum-listát a CONFIG fülről (kulcs alapján).
 *
 * @deprecated KOZ-05: Ez a függvény minden híváskor újra beolvassa a teljes CONFIG fület
 * (`getDataRange().getValues()`), ami 4× redundáns API hívást okoz `getNextWorkday()`-nként.
 * Helyette használd: `_getConfigSetFromData_(data, key)` — előre betöltött adatokból olvas.
 * A `getNextWorkday()` már az új, cached változatot használja.
 * Ez a függvény csak visszamenőleges kompatibilitás miatt maradt itt.
 *
 * @param {Sheet}  sheet
 * @param {string} key
 * @returns {Set<string>}
 */
function _getConfigSet_(sheet, key) {
  const data = sheet.getDataRange().getValues();
  return _getConfigSetFromData_(data, key);
}

/**
 * Visszaadja a CONFIG fülön egy kulcs státusz oszlopát (C oszlop).
 *
 * @deprecated KOZ-05: Ez a függvény minden híváskor újra beolvassa a teljes CONFIG fület.
 * Helyette használd: `_getConfigStatusFromData_(data, key)` — előre betöltött adatokból olvas.
 *
 * @param {Sheet}  sheet
 * @param {string} key
 * @returns {string|null}
 */
function _getConfigStatus_(sheet, key) {
  const data = sheet.getDataRange().getValues();
  return _getConfigStatusFromData_(data, key);
}

/**
 * Kiolvas egy vesszővel tagolt dátum-listát az előre betöltött CONFIG adatokból.
 * Kizárólag getNextWorkday() hívja — a futásonkénti cache-ből olvas, nem a Sheet API-ból.
 * @param {Array[][]} data  - configSheet.getDataRange().getValues() eredménye
 * @param {string}    key
 * @returns {Set<string>}
 */
function _getConfigSetFromData_(data, key) {
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      const raw = String(data[i][1] || '').trim();
      if (!raw) return new Set();
      return new Set(raw.split(',').map(function(s) { return s.trim(); }).filter(Boolean));
    }
  }
  return new Set();
}

/**
 * Visszaadja egy kulcs státusz oszlopát (C oszlop) az előre betöltött CONFIG adatokból.
 * Kizárólag getNextWorkday() hívja — a futásonkénti cache-ből olvas, nem a Sheet API-ból.
 * @param {Array[][]} data  - configSheet.getDataRange().getValues() eredménye
 * @param {string}    key
 * @returns {string|null}
 */
function _getConfigStatusFromData_(data, key) {
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return String(data[i][2] || '');
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ÉRTESÍTŐ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kritikus hiba esetén értesíti az adminisztrátort:
 *  1. Google Chat Admin webhook (ha van)
 *  2. Email (CONFIG.ADMIN_EMAIL) — fallback, mindig fut
 *
 * @param {string} subject   - Tárgy / rövid hibaleírás
 * @param {string} body      - Részletes hibaüzenet
 * @param {Error}  [error]   - Opcionális Error objektum (stack trace-hez)
 */
function notifyAdmin(subject, body, error) {
  const fullBody = body + (error ? '\n\nStack trace:\n' + error.stack : '');
  const prefix   = CONFIG.TEST_MODE ? '[TEST] ' : '';

  // 1. Chat webhook
  if (CONFIG.CHAT_WEBHOOK_ADMIN) {
    try {
      const payload = {
        text: '🔴 *' + prefix + subject + '*\n```' + fullBody + '```',
      };
      UrlFetchApp.fetch(CONFIG.CHAT_WEBHOOK_ADMIN, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });
    } catch (webhookErr) {
      console.error('notifyAdmin: Chat webhook sikertelen: ' + webhookErr.message);
      // Nem dobjuk tovább — az email fallback fut
    }
  }

  // 2. Email fallback
  try {
    GmailApp.sendEmail(
      CONFIG.ADMIN_EMAIL,
      prefix + 'Armadillo hiba: ' + subject,
      fullBody,
    );
  } catch (emailErr) {
    // Ha az email is sikertelen, csak naplózunk — nem dobunk hibát (végtelen rekurzió elkerülése)
    console.error('notifyAdmin: Email is sikertelen: ' + emailErr.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCK SERVICE WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Megpróbál script lock-ot szerezni.
 * Ha CONFIG.LOCK_TIMEOUT_MS-en belül nem sikerül → LOCK_TIMEOUT hibát dob.
 * Használat: acquireLock() → try { ... } finally { lock.releaseLock() }
 *
 * @returns {Lock}
 * @throws {Error} 'LOCK_TIMEOUT' ha a lock nem szerezhető meg
 */
function acquireLock() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
    throw new Error('LOCK_TIMEOUT: ' + CONFIG.LOCK_TIMEOUT_MS +
      'ms után sem sikerült lock-ot szerezni. Valószínűleg párhuzamos futás.');
  }
  return lock;
}

// ─────────────────────────────────────────────────────────────────────────────
// DÁTUM SEGÉDFÜGGVÉNYEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dátumot YYYY-MM-DD stringgé alakít.
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  if (!date || !(date instanceof Date) || isNaN(date)) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

/**
 * Visszaadja az aktuális hónaphoz tartozó Drive mappa nevét.
 * Formátum: "04_Április" — konzisztens a TestSetup.gs-sel és a GmailDrive.gs-sel.
 * @param {Date} date
 * @returns {string}
 */
function hungarianMonth(date) {
  const months = [
    '01_Január',   '02_Február',  '03_Március',  '04_Április',
    '05_Május',    '06_Június',   '07_Július',   '08_Augusztus',
    '09_Szeptember','10_Október', '11_November', '12_December',
  ];
  return months[date.getMonth()];
}

// ─────────────────────────────────────────────────────────────────────────────
// ASCII TRANSZLITERÁCIÓ (MagNet batch fájlhoz)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Magyar ékezeteket és speciális karaktereket ASCII-ra cserél.
 * A MagNet CS-ÁTUTALÁS fix szélességű txt formátum csak ASCII karaktereket fogad.
 *
 * @param {string} text
 * @returns {string}
 */
function asciiTranslit(text) {
  if (!text) return '';
  return String(text)
    .replace(/á/g, 'a').replace(/Á/g, 'A')
    .replace(/é/g, 'e').replace(/É/g, 'E')
    .replace(/í/g, 'i').replace(/Í/g, 'I')
    .replace(/ó/g, 'o').replace(/Ó/g, 'O')
    .replace(/ö/g, 'o').replace(/Ö/g, 'O')
    .replace(/ő/g, 'o').replace(/Ő/g, 'O')
    .replace(/ú/g, 'u').replace(/Ú/g, 'U')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U')
    .replace(/ű/g, 'u').replace(/Ű/g, 'U')
    // Egyéb, a MagNet által nem fogadott karakterek
    .replace(/[^a-zA-Z0-9 \-.,;:()/]/g, '?');
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉRVÉNYES PROJEKTSZÁMOK CACHE (megosztott — GeminiOCR.gs + SheetWriter.gs)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Betölti az érvényes projektszámokat a PROJEKTEK fülről.
 * Futásonkénti cache — ne olvassuk újra minden tételnél.
 * Megosztott: GeminiOCR.gs és SheetWriter.gs is ezt hívja (DRY elvnek megfelelően).
 * Cache törlése: `loadValidProjects._cache = null;`
 * @returns {string[]}
 */
function loadValidProjects() {
  if (!loadValidProjects._cache) {
    try {
      const ss      = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
      const sheet   = ss.getSheetByName(CONFIG.TABS.PROJEKTEK);
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) {
        loadValidProjects._cache = [];
      } else {
        const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        loadValidProjects._cache = values
          .map(function(r) { return String(r[0]).trim(); })
          .filter(function(v) { return v && CONFIG.PROJEKTSZAM_REGEX.test(v); });
      }
    } catch (e) {
      console.warn('loadValidProjects hiba: ' + e.message);
      loadValidProjects._cache = [];
    }
  }
  return loadValidProjects._cache;
}

// ─────────────────────────────────────────────────────────────────────────────
// ID GENERÁLÁS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Egyedi azonosítót generál a megadott prefix + dátum + random kombinációjából.
 * Formátum: "INV-20260408-A3F7"
 * Deduplikáció: a Sheets-en W oszlop (Gmail message ID) elvégzi — ez csak emberi olvashatósághoz.
 *
 * @param {string} prefix  - pl. 'INV', 'ALL'
 * @returns {string}
 */
function generateId(prefix) {
  const now    = new Date();
  const date   = formatDate(now).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return prefix + '-' + date + '-' + random;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESZTELŐ FUTTATÓK (kézi futtatáshoz Script Editor-ban)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Utils unit tesztek — futtatás: Script Editor → runUtilsTests → ▶ Run
 */
function runUtilsTests() {
  console.log('══════════════════════════════════════');
  console.log('Utils tesztek');
  console.log('══════════════════════════════════════');

  // formatDate
  const d = new Date(2026, 3, 8); // 2026-04-08
  const fd = formatDate(d);
  console.log('formatDate(2026-04-08): ' + fd + (fd === '2026-04-08' ? ' ✓' : ' ✗ HIBA'));

  // hungarianMonth
  const hm = hungarianMonth(d);
  console.log('hungarianMonth(április): ' + hm + (hm === '04_Április' ? ' ✓' : ' ✗ HIBA'));

  // asciiTranslit
  const at = asciiTranslit('Árvíztűrő fúrógép');
  console.log('asciiTranslit: ' + at + (at === 'Arvizturo furogep' ? ' ✓' : ' ✗ HIBA'));

  // generateId
  const id = generateId('INV');
  console.log('generateId(INV): ' + id + (id.startsWith('INV-2026') ? ' ✓' : ' ✗ HIBA'));

  // PROJEKTSZAM_REGEX
  const re = CONFIG.PROJEKTSZAM_REGEX;
  const cases = [
    ['IMME2601', true],
    ['FCA2601',  true],
    ['AB2601',   false], // 2 betű — nem valid
    ['IMME26',   false], // csak 2 szám
    ['imme2601', false], // kisbetű
    ['I\u041C\u041C\u04152601', false], // cirill М (U+041C) ×2 + Е (U+0415) — vizuálisan IMME2601-nek látszik, valójában nem ASCII
  ];
  cases.forEach(function(c) {
    const res = re.test(c[0]);
    const ok  = res === c[1];
    console.log('regex "' + c[0] + '": ' + res + (ok ? ' ✓' : ' ✗ HIBA (várt: ' + c[1] + ')'));
  });

  // withRetry — sikeres esetben
  let callCount = 0;
  const result = withRetry(function() {
    callCount++;
    if (callCount < 3) throw new Error('szimulált hiba');
    return 'OK';
  }, 3, 100); // 100ms delay a tesztnél
  console.log('withRetry (3 próba): ' + result + ' (hívások: ' + callCount + ')' +
    (result === 'OK' && callCount === 3 ? ' ✓' : ' ✗ HIBA'));

  // withRetry — végleges hiba esetén
  let threw = false;
  try {
    withRetry(function() { throw new Error('állandó hiba'); }, 2, 100);
  } catch (e) {
    threw = true;
  }
  console.log('withRetry (max retry hit): ' + (threw ? '✓ hibát dobott' : '✗ NEM dobott hibát'));

  console.log('══════════════════════════════════════');
  console.log('getNextWorkday tesztet külön futtasd (sheet hozzáférés kell):');
  console.log('  Script Editor → testGetNextWorkday → ▶ Run');
}

/**
 * getNextWorkday integrációs teszt — a staging sheet CONFIG fülét olvassa.
 * Futtatás: Script Editor → testGetNextWorkday → ▶ Run
 */
function testGetNextWorkday() {
  console.log('getNextWorkday teszt...');
  getNextWorkday._configCache = null; // fresh olvasás

  // ── 1. Alap: péntek + 1 munkanap = hétfő
  // 2026-04-10 (péntek) → kihagyja szombat+vasárnapot → 2026-04-13 (hétfő)
  const friday = new Date(2026, 3, 10);
  const r1 = formatDate(getNextWorkday(friday, 1));
  console.log('Péntek + 1 munkanap: ' + r1 + (r1 === '2026-04-13' ? ' ✓' : ' ✗ HIBA (várt: 2026-04-13)'));

  // ── 2. Szombat (nem áthelyezett) → hétfő
  const saturday = new Date(2026, 3, 11);
  getNextWorkday._configCache = null;
  const r2 = formatDate(getNextWorkday(saturday, 0));
  console.log('Szombat (nem áthelyezett) → ' + r2 + (r2 === '2026-04-13' ? ' ✓' : ' ✗ HIBA (várt: 2026-04-13)'));

  // ── 3. WORKING_SATURDAYS ág — CONFIG-ból olvassa, ha nincs adat: figyelmeztet
  getNextWorkday._configCache = null;
  const ss         = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const cfgSheet   = ss.getSheetByName(CONFIG.TABS.CONFIG);
  const cfgData    = cfgSheet.getDataRange().getValues();
  const workingSats = _getConfigSetFromData_(cfgData, 'WORKING_SATURDAYS_2026');

  if (workingSats.size === 0) {
    console.warn('⚠️  WORKING_SATURDAYS_2026 üres a CONFIG-ban — teszt kihagyva. Task 03 után futtasd újra.');
  } else {
    const firstSat  = Array.from(workingSats).sort()[0];
    const satDate   = new Date(firstSat + 'T00:00:00');
    getNextWorkday._configCache = null;
    const r3 = formatDate(getNextWorkday(satDate, 0));
    const ok3 = r3 === firstSat;
    console.log('Áthelyezett munkanap (' + firstSat + ') addDays=0 → ' + r3 +
      (ok3 ? ' ✓ (saját napját adja vissza)' : ' ✗ HIBA (várt: ' + firstSat + ')'));
  }

  // ── 4. Ünnepnap átugrás — CONFIG-ból olvassa, ha nincs adat: figyelmeztet
  const holidays = _getConfigSetFromData_(cfgData, 'HOLIDAYS_2026');

  if (holidays.size === 0) {
    console.warn('⚠️  HOLIDAYS_2026 üres a CONFIG-ban — teszt kihagyva. Task 03 után futtasd újra.');
  } else {
    // Keresünk egy hétköznapi ünnepnapot (H–P)
    const weekdayHol = Array.from(holidays).sort().find(function(d) {
      const dow = new Date(d + 'T00:00:00').getDay();
      return dow >= 1 && dow <= 5;
    });
    if (!weekdayHol) {
      console.warn('⚠️  HOLIDAYS_2026-ban nincs hétköznapi ünnepnap — ünnepnap-teszt kihagyva.');
    } else {
      const holDate  = new Date(weekdayHol + 'T00:00:00');
      const dayBefore = new Date(holDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      getNextWorkday._configCache = null;
      const r4  = formatDate(getNextWorkday(dayBefore, 1));
      const ok4 = r4 !== weekdayHol;
      console.log('Ünnepnap (' + weekdayHol + ') átugrás → ' + r4 +
        (ok4 ? ' ✓ (nem az ünnepnap)' : ' ✗ HIBA (ünnepnapot adott vissza!)'));
    }
  }

  getNextWorkday._configCache = null; // teszt után cleanup
  console.log('getNextWorkday teszt kész.');
}
