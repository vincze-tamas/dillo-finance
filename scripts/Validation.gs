/**
 * Validation.gs
 * Armadillo Pénzügyi Automatizáció — Szerkesztési validáció
 *
 * TRIGGER TÍPUSA: onEditInstallable (NEM simple onEdit!)
 * Azért kell installable: a validateRow() SpreadsheetApp.openById()-t hív,
 * ami simple onEdit-ből nem érhető el megbízhatóan másik sheeten.
 *
 * TRIGGER BEÁLLÍTÁSA: Triggers.gs → setupOnEditTrigger() → ▶ Run
 * (autobot@armadillo.hu fiókból!)
 *
 * Mit figyel:
 *   SZÁMLA_TÉTELEK J  (PO/Projektszám)  → FK ellenőrzés PROJEKTEK.A-ban + M rekalkuláció
 *   SZÁMLA_TÉTELEK K  (PO_CONFIDENCE)   → 0–100 range ellenőrzés + M rekalkuláció
 *   PROJEKTEK A       (Projektszám)     → regex ^[A-Z]{3,4}[0-9]{4}$
 *   PARTNEREK H       (Allokációs sablon) → formátum ellenőrzés (warning)
 *
 * Hibás cella: piros háttér + note a cellán + console.warn
 * Helyes cella: háttér + note törölve
 */

// ─────────────────────────────────────────────────────────────────────────────
// BELÉPÉSI PONT — INSTALLABLE TRIGGER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Az installable onEdit trigger hívja meg.
 * NE nevezd át — a Triggers.gs erre a névre hivatkozik.
 * @param {GoogleAppsScript.Events.SheetsOnEdit} e
 */
function onEditInstallable(e) {
  // ── Early exit 1: tömeges szerkesztés (pl. copy-paste, oszloprendezés)
  if (e.range.getNumRows() > 1 || e.range.getNumColumns() > 1) return;

  const sheet   = e.range.getSheet();
  const tabName = sheet.getName();
  const row     = e.range.getRow();
  const col     = e.range.getColumn();
  const value   = e.range.getValue();

  // ── Early exit 2: nem figyelt fül
  const watchedTabs = [
    CONFIG.TABS.BEJOVO_SZAMLAK,
    CONFIG.TABS.SZAMLA_TETELEK,
    CONFIG.TABS.PROJEKTEK,
    CONFIG.TABS.PARTNEREK,
  ];
  if (watchedTabs.indexOf(tabName) === -1) return;

  // ── Early exit 3: fejléc sor
  if (row === 1) return;

  // ── Early exit 4: nem releváns oszlop az adott fülön
  if (tabName === CONFIG.TABS.BEJOVO_SZAMLAK) {
    // KOTEG_ID (V) readonly védelem — ha valaki felülírná, visszaállítjuk
    if (col === CONFIG.COLS.BEJOVO.KOTEG_ID) {
      const oldVal = String(e.oldValue || '').trim();
      const newVal = String(value       || '').trim();
      if (oldVal !== '' && oldVal !== newVal) {
        // Audit log ELŐBB — hogy a próbált értéket rögzítsük, nem a visszaállítottat
        logAudit_(e, 'KOTEG_ID_OVERWRITE_ATTEMPT');

        e.range.setValue(oldVal); // visszaállítás

        // Ki próbálta meg?
        const who   = Session.getActiveUser().getEmail() || 'ismeretlen';
        const when  = new Date().toISOString();
        const cell  = e.range.getA1Notation();
        const logMsg = 'KOTEG_ID felülírási kísérlet | ' + who +
                       ' | cella: ' + cell +
                       ' | próbált érték: "' + newVal + '"' +
                       ' | eredeti: "' + oldVal + '"' +
                       ' | ' + when;

        // Admin Chat + email értesítő
        notifyAdmin('⛔ KOTEG_ID felülírási kísérlet', logMsg);

        // 3. Alert a felhasználónak
        SpreadsheetApp.getUi().alert(
          '⛔ KOTEG_ID nem módosítható!\n\n' +
          'Ez a mező automatikusan kerül kitöltésre a batch generáláskor.\n' +
          'Eredeti érték visszaállítva: ' + oldVal + '\n\n' +
          'A kísérlet naplózva és az IT értesítve.'
        );
      }
      return;
    }
    if (col !== CONFIG.COLS.BEJOVO.STATUSZ) return; // Q oszlop
  } else if (tabName === CONFIG.TABS.SZAMLA_TETELEK) {
    if (col !== CONFIG.COLS.TETEL.PO && col !== CONFIG.COLS.TETEL.PO_CONFIDENCE) return;
  } else if (tabName === CONFIG.TABS.PROJEKTEK) {
    if (col !== 1) return; // A oszlop
  } else if (tabName === CONFIG.TABS.PARTNEREK) {
    if (col !== CONFIG.COLS.PARTNER.ALLOKACIOASSABLON) return; // H oszlop
  }

  // ── Audit log — minden figyelt szerkesztés rögzítve (AuditLog.gs)
  // A KOTEG_ID eset külön loggolódik fentebb (KOTEG_ID_OVERWRITE_ATTEMPT),
  // ide már nem jut el (return után). Minden más eset itt naplózódik.
  const auditAction = (function() {
    if (tabName === CONFIG.TABS.BEJOVO_SZAMLAK)  return 'STATUSZ_VALTOZAS';
    if (tabName === CONFIG.TABS.SZAMLA_TETELEK)  return 'PO_MODOSITAS';
    if (tabName === CONFIG.TABS.PROJEKTEK)        return 'PROJEKT_MODOSITAS';
    if (tabName === CONFIG.TABS.PARTNEREK)        return 'PARTNER_MODOSITAS';
    return 'CELLAMODOSITAS';
  })();
  logAudit_(e, auditAction);

  // ── Routing fülönként
  try {
    if (tabName === CONFIG.TABS.BEJOVO_SZAMLAK) {
      // Státusz változás → Chat értesítő + jóváhagyás dátum
      _onBejovoszamlaStatuszChange_(sheet, row, String(value || ''), String(e.oldValue || ''));
    } else if (tabName === CONFIG.TABS.SZAMLA_TETELEK) {
      _validateTetelRow_(sheet, row, col, value);
    } else if (tabName === CONFIG.TABS.PROJEKTEK) {
      _validateProjektszam_(sheet, row, value);
      // Projekt hozzáadva / módosítva / törölve → J dropdown szinkronban marad
      refreshPODropdown_();  // Setup.gs
    } else if (tabName === CONFIG.TABS.PARTNEREK) {
      _validateAllokaciosSablon_(sheet, row, value);
    }
  } catch (err) {
    // Validáció belső hiba → ne törjük el a felhasználó munkáját, csak naplózzuk
    console.error('onEditInstallable validáció hiba: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SZÁMLA_TÉTELEK VALIDÁCIÓ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SZÁMLA_TÉTELEK sor validálása J vagy K oszlop változásakor.
 * Mindig újraszámolja az M oszlopot (PO_VALIDÁLT).
 *
 * @param {Sheet}  sheet
 * @param {number} row
 * @param {number} col    - 10 (J=PO) vagy 11 (K=PO_CONFIDENCE)
 * @param {*}      value  - Az új érték
 */
function _validateTetelRow_(sheet, row, col, value) {
  const rowData        = sheet.getRange(row, 1, 1, CONFIG.COLS.TETEL.PO_VALIDALT)
                               .getValues()[0];
  const poValue        = rowData[CONFIG.COLS.TETEL.PO - 1];           // J
  const confidenceValue= rowData[CONFIG.COLS.TETEL.PO_CONFIDENCE - 1]; // K

  // MIN-04: `valid` változó nem kerül visszaadásra — jelenleg csak belső hibaszámláló célra,
  // de az összes hibát az `errors` tömb kezeli. Jövőbeni refactor szál.
  let valid = true;
  const errors = [];

  // ── J oszlop: FK ellenőrzés PROJEKTEK.A-ban
  if (col === CONFIG.COLS.TETEL.PO) {
    const poStr = String(value || '').trim();

    if (poStr === '') {
      // Üres J → NEM validált, de nem "hiba" — a script is írhatja
      _clearCellError_(sheet, row, CONFIG.COLS.TETEL.PO);
    } else {
      const poExists = _isProjektszamValid_(poStr);
      if (!poExists) {
        valid = false;
        errors.push('PO "' + poStr + '" nem szerepel a PROJEKTEK fülön (A oszlop)');
        _setCellError_(sheet, row, CONFIG.COLS.TETEL.PO,
          'PO nem találh a PROJEKTEK-ben: ' + poStr);
      } else {
        _clearCellError_(sheet, row, CONFIG.COLS.TETEL.PO);
      }
    }
  }

  // ── K oszlop: 0–100 range ellenőrzés
  if (col === CONFIG.COLS.TETEL.PO_CONFIDENCE) {
    const conf = Number(value);
    if (value !== '' && value !== null && (isNaN(conf) || conf < 0 || conf > 100)) {
      valid = false;
      errors.push('PO_CONFIDENCE értéke ' + value + ' — érvényes tartomány: 0–100');
      _setCellError_(sheet, row, CONFIG.COLS.TETEL.PO_CONFIDENCE,
        'Érvénytelen érték: ' + value + ' (0–100 kell)');
    } else {
      _clearCellError_(sheet, row, CONFIG.COLS.TETEL.PO_CONFIDENCE);
    }
  }

  // ── M oszlop: PO_VALIDÁLT újraszámítása
  // Mindig lefut, függetlenül attól, hogy J vagy K változott
  // KOZ-02 korlát: ez a trigger nem ismeri a partner kategóriáját (ÁLLANDÓ/MEGOSZTOTT),
  // mert a SZÁMLA_TÉTELEK fülön nincs kategória oszlop. MEGOSZTOTT számla tételeinél
  // a PO_VALIDÁLT értéke 'NEM' lesz akkor is, ha a fejlécsor státusza BEÉRKEZETT/JÓVÁHAGYVA.
  // Ez a viselkedés a tervezett: az M oszlop csak PO-ellenőrzési segédadat, nem
  // blokkolja a számlafeldolgozást. Teljes megoldás: SZAMLA_ID alapján visszaolvasni
  // a BEJÖVŐ_SZÁMLÁK K oszlopát — de ez extra API hívás, Fázis 6-ra halasztva.
  const currentPo   = String(poValue   || '').trim();
  const currentConf = Number(confidenceValue);

  let poValidalt;
  if (currentPo === '') {
    poValidalt = 'NEM'; // Nincs PO → nem validált
  } else {
    const fkOk   = _isProjektszamValid_(currentPo);
    const confOk = !isNaN(currentConf) && currentConf >= CONFIG.PO_CONFIDENCE_THRESHOLD;
    poValidalt   = (fkOk && confOk) ? 'IGEN' : 'NEM';
  }

  sheet.getRange(row, CONFIG.COLS.TETEL.PO_VALIDALT).setValue(poValidalt);

  // Validációs hibák: piros cella + note elegendő (CONFIG-ba nem logolunk)
  if (errors.length > 0) {
    errors.forEach(function(err) {
      console.warn('TETEL_VALIDÁCIÓ_HIBA sor ' + row + ': ' + err);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJEKTEK VALIDÁCIÓ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PROJEKTEK A oszlop: projektszám regex ellenőrzés.
 * Regex: ^[A-Z]{3,4}[0-9]{4}$ — pl. IMME2601, FCA2601
 *
 * @param {Sheet}  sheet
 * @param {number} row
 * @param {*}      value
 */
function _validateProjektszam_(sheet, row, value) {
  const str = String(value || '').trim();

  if (str === '') {
    _clearCellError_(sheet, row, 1);
    return;
  }

  if (!CONFIG.PROJEKTSZAM_REGEX.test(str)) {
    _setCellError_(sheet, row, 1,
      'Érvénytelen formátum: "' + str + '"\nElvárt: 3–4 nagybetű + 4 szám\nPl.: IMME2601, FCA2601');
    console.warn('PROJEKTSZAM_HIBA sor ' + row + ': "' + str + '"');
  } else {
    _clearCellError_(sheet, row, 1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTNEREK VALIDÁCIÓ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PARTNEREK H oszlop (Allokációs sablon): formátum ellenőrzés.
 * Elfogadott formátumok:
 *   "AKTÍV_PROJEKTEK_EGYENLŐ"
 *   "PROJEKTKOD:SZAZALEK;..." — pl. "IMME2601:40;FCA2601:35;ÁLTALÁNOS:25"
 *   Összeg = 100% (warning ha nem)
 *
 * @param {Sheet}  sheet
 * @param {number} row
 * @param {*}      value
 */
function _validateAllokaciosSablon_(sheet, row, value) {
  const str = String(value || '').trim();

  if (str === '') {
    _clearCellError_(sheet, row, CONFIG.COLS.PARTNER.ALLOKACIOASSABLON);
    return;
  }

  // Speciális értékek
  if (str === 'AKTÍV_PROJEKTEK_EGYENLŐ') {
    _clearCellError_(sheet, row, CONFIG.COLS.PARTNER.ALLOKACIOASSABLON);
    return;
  }

  // "KOD:SZAZALEK;..." formátum ellenőrzés
  const parts = str.split(';').map(function(s) { return s.trim(); }).filter(Boolean);
  let totalPct = 0;
  const formatErrors = [];

  parts.forEach(function(part) {
    const kv = part.split(':');
    if (kv.length !== 2) {
      formatErrors.push('"' + part + '" nem "KOD:SZAZALEK" formátum');
      return;
    }
    const code = kv[0].trim();
    const pct  = Number(kv[1].trim());

    if (code !== 'ÁLTALÁNOS' && !CONFIG.PROJEKTSZAM_REGEX.test(code)) {
      formatErrors.push('"' + code + '" érvénytelen projektszám (és nem ÁLTALÁNOS)');
    }
    if (isNaN(pct) || pct <= 0 || pct > 100) {
      formatErrors.push('"' + kv[1].trim() + '" érvénytelen százalék (1–100 kell)');
    } else {
      totalPct += pct;
    }
  });

  if (formatErrors.length > 0) {
    _setCellError_(sheet, row, CONFIG.COLS.PARTNER.ALLOKACIOASSABLON,
      'Érvénytelen sablon:\n' + formatErrors.join('\n') +
      '\nElvárt: "IMME2601:40;FCA2601:35;ÁLTALÁNOS:25"');
    console.warn('ALLOKACIO_SABLON_HIBA sor ' + row + ': ' + formatErrors.join('; '));
    return;
  }

  // Összeg ellenőrzés: 100% kell
  if (Math.round(totalPct) !== 100) {
    // Warning-only: piros helyett narancssárga
    sheet.getRange(row, CONFIG.COLS.PARTNER.ALLOKACIOASSABLON).setBackground('#fff2cc'); // halvány sárga
    sheet.getRange(row, CONFIG.COLS.PARTNER.ALLOKACIOASSABLON).setNote(
      '⚠️ Arányok összege: ' + totalPct + '% (100% kellene)');
    console.warn('ALLOKACIO_OSSZEG_WARNING sor ' + row + ': arányok összege ' + totalPct + '%');
  } else {
    _clearCellError_(sheet, row, CONFIG.COLS.PARTNER.ALLOKACIOASSABLON);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FK SEGÉDFÜGGVÉNY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Megnézi, hogy a projektszám szerepel-e a PROJEKTEK fül A oszlopában.
 * KOZ-08: megosztott cache — Utils.gs loadValidProjects() tárolja az adatot.
 * Előny: GeminiOCR.gs, SheetWriter.gs és Validation.gs ugyanazt a cache-t
 * használja → trigger-futáson belül nincs inkonzisztencia.
 * Cache törlése: loadValidProjects._cache = null (validateAllTetelek() csinálja)
 * @param {string} projektszam
 * @returns {boolean}
 */
function _isProjektszamValid_(projektszam) {
  const projects = loadValidProjects(); // Utils.gs megosztott cache
  return projects.indexOf(String(projektszam).trim()) !== -1;
}

// ─────────────────────────────────────────────────────────────────────────────
// CELLAFORMÁZÁS SEGÉDFÜGGVÉNYEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Piros háttér + note a hibás cellára.
 * @param {Sheet}  sheet
 * @param {number} row
 * @param {number} col
 * @param {string} message
 */
function _setCellError_(sheet, row, col, message) {
  const cell = sheet.getRange(row, col);
  cell.setBackground('#f4cccc'); // halvány piros
  cell.setNote('⛔ ' + message);
}

/**
 * Törli a piros hátteret és a note-ot ha a cella javítva lett.
 * @param {Sheet}  sheet
 * @param {number} row
 * @param {number} col
 */
function _clearCellError_(sheet, row, col) {
  const cell = sheet.getRange(row, col);
  cell.setBackground(null);
  cell.clearNote();
}


// ─────────────────────────────────────────────────────────────────────────────
// MANUÁLIS TELJES SOR VALIDÁCIÓ (batch futtatáshoz)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Végigmegy az összes SZÁMLA_TÉTELEK soron és validálja a J/K/M mezőket.
 * Hasznos: Setup után, vagy ha kézzel módosítottak adatokat.
 * Futtatás: Script Editor → validateAllTetelek → ▶ Run
 */
function validateAllTetelek() {
  console.log('SZÁMLA_TÉTELEK teljes validáció...');
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.TABS.SZAMLA_TETELEK);
  const last  = sheet.getLastRow();

  if (last < 2) {
    console.log('Nincs adat a SZÁMLA_TÉTELEK fülön.');
    return;
  }

  // Cache törlése — friss adatot olvasunk (Utils.gs megosztott cache)
  loadValidProjects._cache = null;

  let errCount = 0;
  for (let row = 2; row <= last; row++) {
    const rowData = sheet.getRange(row, 1, 1, CONFIG.COLS.TETEL.PO_VALIDALT).getValues()[0];
    const po      = String(rowData[CONFIG.COLS.TETEL.PO - 1] || '').trim();
    const conf    = Number(rowData[CONFIG.COLS.TETEL.PO_CONFIDENCE - 1]);

    // J validáció
    if (po !== '' && !_isProjektszamValid_(po)) {
      _setCellError_(sheet, row, CONFIG.COLS.TETEL.PO,
        'PO "' + po + '" nem szerepel a PROJEKTEK fülön');
      errCount++;
    } else {
      _clearCellError_(sheet, row, CONFIG.COLS.TETEL.PO);
    }

    // K validáció
    const confRaw = rowData[CONFIG.COLS.TETEL.PO_CONFIDENCE - 1];
    if (confRaw !== '' && confRaw !== null && (isNaN(conf) || conf < 0 || conf > 100)) {
      _setCellError_(sheet, row, CONFIG.COLS.TETEL.PO_CONFIDENCE,
        'Érvénytelen: ' + confRaw + ' (0–100 kell)');
      errCount++;
    } else {
      _clearCellError_(sheet, row, CONFIG.COLS.TETEL.PO_CONFIDENCE);
    }

    // M újraszámítás
    let poValidalt;
    if (po === '') {
      poValidalt = 'NEM';
    } else {
      const fkOk   = _isProjektszamValid_(po);
      const confOk = !isNaN(conf) && conf >= CONFIG.PO_CONFIDENCE_THRESHOLD;
      poValidalt   = (fkOk && confOk) ? 'IGEN' : 'NEM';
    }
    sheet.getRange(row, CONFIG.COLS.TETEL.PO_VALIDALT).setValue(poValidalt);
  }

  console.log('✅ Validáció kész. Hibás sorok: ' + errCount + ' / ' + (last - 1));
}

/**
 * Végigmegy az összes PROJEKTEK soron és validálja az A oszlop formátumát.
 * Futtatás: Script Editor → validateAllProjektek → ▶ Run
 */
function validateAllProjektek() {
  console.log('PROJEKTEK teljes validáció...');
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.TABS.PROJEKTEK);
  const last  = sheet.getLastRow();

  if (last < 2) {
    console.log('Nincs adat a PROJEKTEK fülön.');
    return;
  }

  let errCount = 0;
  for (let row = 2; row <= last; row++) {
    const val = String(sheet.getRange(row, 1).getValue() || '').trim();
    if (val === '') continue;

    if (!CONFIG.PROJEKTSZAM_REGEX.test(val)) {
      _setCellError_(sheet, row, 1,
        'Érvénytelen: "' + val + '"\nElvárt: 3–4 nagybetű + 4 szám (pl. IMME2601)');
      errCount++;
    } else {
      _clearCellError_(sheet, row, 1);
    }
  }

  console.log('✅ Validáció kész. Hibás sorok: ' + errCount + ' / ' + (last - 1));
}
