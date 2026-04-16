/**
 * Validation.gs
 * Armadillo Pénzügyi Automatizáció — Szerkesztési validáció + univerzális audit
 *
 * TRIGGER TÍPUSA: onEditInstallable (NEM simple onEdit!)
 * Azért kell installable: SpreadsheetApp.openById() és Session.getActiveUser()
 * csak installable triggerből működik megbízhatóan.
 *
 * TRIGGER BEÁLLÍTÁSA: Triggers.gs → setupOnEditTrigger() → ▶ Run
 * (autobot@armadillo.hu fiókból!)
 *
 * Architektúra (végrehajtási sorrend):
 *   1. AUDIT_LOG védelem  — user szerkesztés → revert + alert + AUDIT_LOG_TAMPER_ATTEMPT log
 *   2. Early exit 1       — tömeges szerkesztés (copy-paste, oszloprendezés)
 *   3. Early exit 2       — no-op (e.oldValue === e.value, pl. Enter változtatás nélkül)
 *   4. Early exit 3       — nem üzleti fül (pl. saját fül, diagram)
 *   5. Early exit 4       — fejléc sor (row === 1)
 *   6. KOTEG_ID guard     — BEJÖVŐ_SZÁMLÁK V oszlop → revert + alert + notifyAdmin
 *   7. UNIVERZÁLIS AUDIT  — minden üzleti fül, minden oszlop (AuditLog.gs)
 *   8. VALIDÁCIÓ          — csak releváns oszlopokon (FK, regex, range, státuszgép)
 *
 * Figyelt üzleti fülek (audit):
 *   BEJÖVŐ_SZÁMLÁK, SZÁMLA_TÉTELEK, PROJEKTEK, PARTNEREK,
 *   KÖTEGEK, KIMENŐ_SZÁMLÁK, CONFIG, ALLOKÁCIÓK
 *
 * Validáció (csak ezeken az oszlopokon):
 *   BEJÖVŐ_SZÁMLÁK Q  (Státusz)         → státuszgép + Chat értesítő + Jóváhagyó auto-fill
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
  // ── AUDIT_LOG VÉDELEM — user SOHA nem szerkesztheti
  // onEditInstallable csak user editeknél sül el (GAS garancia),
  // script appendRow() nem triggereli → nincs végtelen loop kockázat.
  const editedSheet = e.range.getSheet();
  if (editedSheet.getName() === CONFIG.TABS.AUDIT_LOG) {
    // Cella visszaállítása az eredeti értékre
    if (e.oldValue !== undefined) {
      e.range.setValue(e.oldValue);
    } else {
      e.range.clearContent();
    }
    // Kísérlet naplózása (logAudit_ → getActiveUser, e event objektum)
    logAudit_(e, AUDIT_MUVELET.AUDITNAPLO_SZERKESZTESI_KISERLET);
    SpreadsheetApp.getUi().alert(
      '⛔ AUDIT_LOG nem szerkeszthető!\n\n' +
      'Az auditnapló kizárólag automatikusan kerül kitöltésre.\n' +
      'A módosítási kísérlet naplózva.\n\n' +
      'Cella visszaállítva.'
    );
    return;
  }

  // ── Early exit 1: tömeges szerkesztés (pl. copy-paste, oszloprendezés)
  if (e.range.getNumRows() > 1 || e.range.getNumColumns() > 1) return;

  // ── Early exit 2: érték nem változott (pl. Enter gomb változtatás nélkül)
  // e.oldValue undefined  → cella előzőleg üres volt (új adat) → engedjük át
  // e.value undefined/null → cella törölve → '' ként kezeljük, nem "undefined"-ként
  if (e.oldValue !== undefined) {
    const oldStr = String(e.oldValue);
    const newStr = (e.value !== undefined && e.value !== null) ? String(e.value) : '';
    if (oldStr === newStr) return;
  }

  const sheet   = editedSheet;
  const tabName = sheet.getName();
  const row     = e.range.getRow();
  const col     = e.range.getColumn();
  const value   = e.range.getValue();

  // ── Early exit 3: nem üzleti fül (pl. saját segédfül, diagram lap)
  const businessTabs = [
    CONFIG.TABS.BEJOVO_SZAMLAK,
    CONFIG.TABS.SZAMLA_TETELEK,
    CONFIG.TABS.PROJEKTEK,
    CONFIG.TABS.PARTNEREK,
    CONFIG.TABS.KOTEGEK,
    CONFIG.TABS.KIMENO_SZAMLAK,
    CONFIG.TABS.CONFIG,
    CONFIG.TABS.ALLOKACIOK_TAB,
  ];
  if (businessTabs.indexOf(tabName) === -1) return;

  // ── Early exit 4: fejléc sor
  if (row === 1) return;

  // ── KOTEG_ID guard (BEJÖVŐ_SZÁMLÁK V oszlop)
  // Külön blokk: visszaállít + alert + notifyAdmin — a normál audit flow előtt fut.
  if (tabName === CONFIG.TABS.BEJOVO_SZAMLAK && col === CONFIG.COLS.BEJOVO.KOTEG_ID) {
    const oldVal = String(e.oldValue || '').trim();
    const newVal = String(value       || '').trim();
    if (oldVal !== '' && oldVal !== newVal) {
      // Audit ELŐBB — a próbált értéket rögzítjük, nem a visszaállítottat
      logAudit_(e, AUDIT_MUVELET.KOTEG_ID_FELULIRAS_KISERLET);
      e.range.setValue(oldVal); // visszaállítás
      const who    = Session.getActiveUser().getEmail() || 'ismeretlen';
      const logMsg = 'KOTEG_ID felülírási kísérlet | ' + who +
                     ' | cella: ' + e.range.getA1Notation() +
                     ' | próbált érték: "' + newVal + '"' +
                     ' | eredeti: "' + oldVal + '"' +
                     ' | ' + new Date().toISOString();
      notifyAdmin('⛔ KOTEG_ID felülírási kísérlet', logMsg);
      SpreadsheetApp.getUi().alert(
        '⛔ KOTEG_ID nem módosítható!\n\n' +
        'Ez a mező automatikusan kerül kitöltésre a batch generáláskor.\n' +
        'Eredeti érték visszaállítva: ' + oldVal + '\n\n' +
        'A kísérlet naplózva és az IT értesítve.'
      );
      return; // csak guard-olt esetben — első írás áteső (audit is logolva alább)
    }
    // oldVal üres (első írás) VAGY azonos értékre mentés → fall-through universal audithoz
  }

  // ── UNIVERZÁLIS AUDIT LOG — minden üzleti fül, minden oszlop
  // A validáció ELŐTT fut, hogy a próbált értéket rögzítsük.
  logAudit_(e, _getAuditAction_(tabName, col, e));

  // ── Validáció + routing — csak a releváns oszlopokra
  // Többi fül (KÖTEGEK, KIMENŐ_SZÁMLÁK, CONFIG, ALLOKÁCIÓK): csak audit, validáció nem kell.
  try {
    if (tabName === CONFIG.TABS.BEJOVO_SZAMLAK) {
      if (col === CONFIG.COLS.BEJOVO.STATUSZ) {
        _onBejovoszamlaStatuszChange_(sheet, row, String(value || ''), String(e.oldValue || ''));
      }
    } else if (tabName === CONFIG.TABS.SZAMLA_TETELEK) {
      if (col === CONFIG.COLS.TETEL.PO || col === CONFIG.COLS.TETEL.PO_CONFIDENCE) {
        _validateTetelRow_(sheet, row, col, value);
      }
    } else if (tabName === CONFIG.TABS.PROJEKTEK) {
      if (col === 1) {
        _validateProjektszam_(sheet, row, value);
        refreshPODropdown_(); // Setup.gs — J dropdown szinkronban marad
      }
    } else if (tabName === CONFIG.TABS.PARTNEREK) {
      if (col === CONFIG.COLS.PARTNER.ALLOKACIOASSABLON) {
        _validateAllokaciosSablon_(sheet, row, value);
      }
    }
  } catch (err) {
    // Validáció belső hiba → ne törjük el a felhasználó munkáját, csak naplózzuk
    console.error('onEditInstallable validáció hiba: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT ACTION MEGHATÁROZÁS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Meghatározza az audit action típust a szerkesztett fül és oszlop alapján.
 * Minden üzleti fülre egyedi típus — az AUDIT_LOG-ban szűrhető.
 *
 * @param {string} tabName
 * @param {number} col
 * @param {GoogleAppsScript.Events.SheetsOnEdit} e
 * @returns {string}
 */
function _getAuditAction_(tabName, col, e) {
  if (tabName === CONFIG.TABS.BEJOVO_SZAMLAK) {
    if (col === CONFIG.COLS.BEJOVO.STATUSZ) {
      const ujStr   = String(e.value    || '').trim();
      const regiStr = String(e.oldValue || '').trim();
      // Tiltott átmenet → STATUSZ_TILTOTT_ATMENET (egyetlen bejegyzés, nincs dupla log)
      // _isStatuszTiltott_ definiálva: Triggers.gs module-level
      if (_isStatuszTiltott_(regiStr, ujStr)) return AUDIT_MUVELET.STATUSZ_TILTOTT_ATMENET;
      // UTALVA → Péter zárja le a köteg utalást
      return ujStr.toUpperCase() === 'UTALVA'
        ? AUDIT_MUVELET.FIZETES_MEGEROSITVE : AUDIT_MUVELET.STATUSZ_VALTOZAS;
    }
    return AUDIT_MUVELET.SZAMLA_MODOSITAS; // egyéb oszlop (pl. kézzel javított összeg, PO_REASONING)
  }
  if (tabName === CONFIG.TABS.SZAMLA_TETELEK) {
    // PO-specifikus oszlopok: saját típus a szűrhetőség miatt
    return (col === CONFIG.COLS.TETEL.PO || col === CONFIG.COLS.TETEL.PO_CONFIDENCE)
      ? AUDIT_MUVELET.PO_MODOSITAS : AUDIT_MUVELET.TETEL_MODOSITAS;
  }
  if (tabName === CONFIG.TABS.PROJEKTEK)      return AUDIT_MUVELET.PROJEKT_MODOSITAS;
  if (tabName === CONFIG.TABS.PARTNEREK)      return AUDIT_MUVELET.PARTNER_MODOSITAS;
  if (tabName === CONFIG.TABS.KOTEGEK)        return AUDIT_MUVELET.KOTEG_MODOSITAS;
  if (tabName === CONFIG.TABS.KIMENO_SZAMLAK) return AUDIT_MUVELET.KIMENO_SZAMLA_MODOSITAS;
  if (tabName === CONFIG.TABS.CONFIG)         return AUDIT_MUVELET.KONFIG_MODOSITAS; // ⚠️ PÉNZÜGYI KOCKÁZAT
  if (tabName === CONFIG.TABS.ALLOKACIOK_TAB) return AUDIT_MUVELET.ALLOKACIO_MODOSITAS;
  return AUDIT_MUVELET.CELLA_MODOSITAS;
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
          'PO nem található a PROJEKTEK-ben: ' + poStr);
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
  // Kategória-alapú bypass: ha a számla ÁLLANDÓ vagy MEGOSZTOTT → PO_VALIDÁLT = 'N/A'
  // SZAMLA_ID-n keresztül visszaolvassuk a BEJÖVŐ_SZÁMLÁK K oszlopát (1 extra hívás).
  const szamlaId  = String(rowData[CONFIG.COLS.TETEL.SZAMLA_ID - 1] || '').trim();
  const kategoria = szamlaId ? _getBejovoszamlaKategoria_(szamlaId) : '';

  let poValidalt;
  if (kategoria === CONFIG.KATEGORIAK.ALLANDO ||
      kategoria === CONFIG.KATEGORIAK.MEGOSZTOTT) {
    poValidalt = 'N/A'; // PO nem kötelező — bypass
  } else {
    // PROJEKT vagy ismeretlen kategória: PO ellenőrzés
    const currentPo   = String(poValue   || '').trim();
    const currentConf = Number(confidenceValue);
    if (currentPo === '') {
      poValidalt = 'NEM';
    } else {
      const fkOk   = _isProjektszamValid_(currentPo);
      const confOk = !isNaN(currentConf) && currentConf >= CONFIG.PO_CONFIDENCE_THRESHOLD;
      poValidalt   = (fkOk && confOk) ? 'IGEN' : 'NEM';
    }
  }

  sheet.getRange(row, CONFIG.COLS.TETEL.PO_VALIDALT).setValue(poValidalt);

  // Validációs hibák: piros cella + note elegendő (CONFIG-ba nem logolunk)
  if (errors.length > 0) {
    errors.forEach(function(err) {
      console.warn('TETEL_VALIDÁCIÓ_HIBA sor ' + row + ': ' + err);
    });
  }
}

/**
 * SZAMLA_ID alapján visszaolvassa a BEJÖVŐ_SZÁMLÁK K (KATEGORIA) oszlopát.
 * Cél: ÁLLANDÓ/MEGOSZTOTT számlák tételeire N/A PO_VALIDÁLT kerüljön.
 * @param {string} szamlaId
 * @returns {string}  pl. 'PROJEKT', 'ÁLLANDÓ', 'MEGOSZTOTT', vagy '' ha nem találja
 */
function _getBejovoszamlaKategoria_(szamlaId) {
  try {
    const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.TABS.BEJOVO_SZAMLAK);
    if (!sheet || sheet.getLastRow() < 2) return '';
    const c    = CONFIG.COLS.BEJOVO;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, c.KATEGORIA).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][c.SZAMLA_ID - 1] || '').trim() === szamlaId) {
        return String(data[i][c.KATEGORIA - 1] || '').trim();
      }
    }
  } catch (e) {
    console.warn('_getBejovoszamlaKategoria_ hiba: ' + e.message);
  }
  return '';
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
