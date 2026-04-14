/**
 * GeminiOCR.gs
 * Armadillo Pénzügyi Automatizáció — Gemini OCR + PO matching + státusz-döntés
 *
 * Belépési pont: processInvoiceWithGemini(pdfBlob, metadata)
 *   → Gemini API hívás (withRetry, 30s/60s/90s backoff)
 *   → JSON parse + PO aggregálás (kód végzi, nem Gemini)
 *   → Státusz-döntés
 *   → SheetWriter hívás (atomikus írás)
 *   → Visszaadja { szallitoNev, szamlaszam, kelt } a Drive fájl átnevezéséhez
 *
 * GEMINI MODEL: gemini-2.0-flash
 * API KEY: PropertiesService → 'GEMINI_API_KEY' (getGeminiApiKey() — Config.gs)
 */

// ─────────────────────────────────────────────────────────────────────────────
// KONSTANSOK
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_MODEL    = 'gemini-2.0-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

// ─────────────────────────────────────────────────────────────────────────────
// FŐ BELÉPÉSI PONT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Feldolgoz egy számla PDF-et: OCR → PO matching → státusz → SheetWriter.
 * GmailDrive.gs hívja a Drive mentés után.
 *
 * @param {Blob}   pdfBlob   - A PDF fájl tartalma
 * @param {{
 *   gmailMessageId: string,
 *   subject:        string,
 *   from:           string,
 *   date:           Date,
 *   driveFileId:    string,
 *   driveUrl:       string,
 *   fileName:       string,
 * }} metadata
 * @returns {{ szallitoNev: string, szamlaszam: string, kelt: string }|null}
 */
function processInvoiceWithGemini(pdfBlob, metadata) {
  console.log('GeminiOCR: feldolgozás indul — ' + metadata.fileName);

  let extracted = null;

  try {
    // ── 1. Projektek lista betöltése a prompthoz (Gemini kontextus)
    const validProjects = loadValidProjects(); // Utils.gs — megosztott cache
    console.log('  Érvényes projektek száma: ' + validProjects.length);

    // ── 2. Gemini API hívás withRetry wrapperrel
    const rawJson = withRetry(function() {
      return _callGeminiApi_(pdfBlob, validProjects);
    }, 3, 30000);

    // ── 3. JSON parse
    extracted = _parseGeminiResponse_(rawJson);
    console.log('  OCR kész: ' + extracted.szallito_nev +
      ' | ' + extracted.szamlaszam + ' | ' + extracted.kelt);

  } catch (err) {
    console.error('GeminiOCR hiba: ' + err.message);
    // Audit: OCR sikertelen
    logAuditScript_(AUDIT_MUVELET.OCR_HIBA, AUDIT_ENTITAS.SZAMLA,
      metadata.fileName, 'Gemini OCR', '', err.message.substring(0, 200));
    // AI_HIBA státuszú sort írunk a sheet-be
    writeInvoiceError(metadata, 'AI_HIBA', err.message);
    notifyAdmin('GeminiOCR feldolgozási hiba', metadata.fileName + ': ' + err.message, err);
    return null;
  }

  try {
    // ── 4. Partner kategória lekérése (ÁLLANDÓ bypass ellenőrzéshez)
    const kategoria = _getPartnerKategoria_(extracted.szallito_nev, extracted.szallito_adoszam);
    console.log('  Partner kategória: ' + (kategoria || 'ismeretlen'));

    // ── 5. PO aggregálás (kód végzi, nem Gemini)
    const poAgg = _aggregatePO_(extracted.tetelek, kategoria);
    console.log('  PO_SUMMARY: ' + poAgg.poSummary + ' | Conf: ' + poAgg.poConfidence);

    // ── 6. Státusz-döntés
    const statusz = _decideStatusz_(extracted.tetelek, kategoria, poAgg);
    console.log('  Státusz: ' + statusz);

    // ── 7. SheetWriter hívás — atomikus SSOT írás
    const szamlaId = writeInvoiceToSheet(extracted, metadata, poAgg, statusz, kategoria);
    console.log('  SheetWriter: sikeres → ' + szamlaId);

    // Audit: OCR + SheetWriter sikeresen lefutott — szamlaId már ismert, pontos rowId
    logAuditScript_(AUDIT_MUVELET.OCR_KESZ, AUDIT_ENTITAS.SZAMLA,
      szamlaId, 'Gemini OCR', '',
      (extracted.szallito_nev || '?') + ' | ' + (extracted.szamlaszam || '?'));

    // ── 8. Chat értesítő (Ági / Admin)  [MI-01: volt dupla 8-as, javítva → 8 + 9]
    try {
      notifyNewInvoice(
        szamlaId,
        extracted.szallito_nev  || '',
        extracted.osszeg_netto  || 0,
        extracted.deviza        || 'HUF',
        statusz,
        metadata.driveUrl       || ''
      );
    } catch (notifyErr) {
      // Értesítés hiba nem kritikus — a számla már be van írva
      console.warn('  notifyNewInvoice hiba (nem kritikus): ' + notifyErr.message);
    }

  } catch (err) {
    console.error('GeminiOCR post-processing hiba: ' + err.message);
    writeInvoiceError(metadata, 'AI_HIBA', 'Post-processing: ' + err.message);
    notifyAdmin('GeminiOCR post-processing hiba', metadata.fileName + ': ' + err.message, err);
    return null;
  }

  // ── 9. Visszaadjuk az átnevezéshez szükséges adatokat
  return {
    szallitoNev: extracted.szallito_nev || '',
    szamlaszam:  extracted.szamlaszam  || '',
    kelt:        extracted.kelt        || '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI API HÍVÁS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Elküldi a PDF-et a Gemini API-nak és visszaadja a nyers JSON stringet.
 * @param {Blob}     pdfBlob
 * @param {string[]} validProjects  - Érvényes projektszámok listája (kontextushoz)
 * @returns {string}  nyers JSON string
 */
function _callGeminiApi_(pdfBlob, validProjects) {
  const apiKey  = getGeminiApiKey();
  const url     = GEMINI_API_BASE + GEMINI_MODEL + ':generateContent?key=' + apiKey;

  const pdfBase64 = Utilities.base64Encode(pdfBlob.getBytes());

  const projectList = validProjects.length > 0
    ? validProjects.join(', ')
    : '(még nincs projekt a rendszerben)';

  const prompt = _buildPrompt_(projectList);

  const requestBody = {
    contents: [{
      parts: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: pdfBase64,
          },
        },
        { text: prompt },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema:   _getResponseSchema_(),
      temperature:      0,   // determinisztikus kimenet számlafeldolgozásnál
    },
  };

  const response = UrlFetchApp.fetch(url, {
    method:             'post',
    contentType:        'application/json',
    payload:            JSON.stringify(requestBody),
    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();
  const bodyText   = response.getContentText();

  if (statusCode !== 200) {
    throw new Error('Gemini API hiba ' + statusCode + ': ' + bodyText.substring(0, 300));
  }

  const responseObj = JSON.parse(bodyText);

  if (!responseObj.candidates || responseObj.candidates.length === 0) {
    throw new Error('Gemini: üres candidates tömb. Response: ' + bodyText.substring(0, 300));
  }

  const candidate = responseObj.candidates[0];
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new Error('Gemini finishReason: ' + candidate.finishReason);
  }

  return candidate.content.parts[0].text;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Összeállítja a Gemini promptot.
 * A projekt lista lehetővé teszi, hogy Gemini pontosabban matchelje a PO-kat.
 * @param {string} projectList  - Vesszővel elválasztott projektszámok
 * @returns {string}
 */
function _buildPrompt_(projectList) {
  return [
    'Te egy magyar számla feldolgozó rendszer OCR komponense vagy.',
    'Elemezd a csatolt PDF számla tartalmát és nyerd ki az összes mezőt pontosan.',
    '',
    'RENDSZERBEN ÉRVÉNYES PROJEKTSZÁMOK (PO matching alapja):',
    projectList,
    '',
    'FEJLÉC MEZŐK (a számla egészére vonatkoznak):',
    '- szallito_nev: szállító/kibocsátó cég neve pontosan',
    '- szallito_adoszam: szállító adószáma (pl. "12345678-2-42" vagy "12345678-2")',
    '- szamlaszam: a számla sorszáma/azonosítója',
    '- kelt: kiállítás dátuma YYYY-MM-DD formátumban',
    '- teljesites_datum: teljesítés/szállítás dátuma YYYY-MM-DD formátumban (ha nincs: egyezik kelt-tel)',
    '- fizhatarido: fizetési határidő YYYY-MM-DD formátumban',
    '- osszeg_netto: teljes nettó összeg számként (csak szám, nincs valutajel)',
    '- osszeg_brutto: teljes bruttó összeg számként',
    '- deviza: pénznem (HUF/EUR/USD, alapértelmezett: HUF)',
    '',
    'TÉTELSOROK (minden egyes sorhoz):',
    '- leiras: a tétel leírása',
    '- mennyiseg: mennyiség számként',
    '- egysegar: egységár számként',
    '- netto: nettó összeg számként',
    '- afa_szazalek: ÁFA mérték százalékban számként (pl. 27)',
    '- afa_osszeg: ÁFA összege számként',
    '- brutto: bruttó összeg számként',
    '- po: projektszám a fenti listából — ha egyértelműen azonosítható; null ha nem',
    '- po_confidence: 0–100 közötti szám, mennyire biztos a projektszám azonosítása',
    '  (100: explicit szerepel a számlán, 80-99: kontextus alapján valószínű,',
    '   50-79: lehetséges de bizonytalan, 0-49: nem azonosítható)',
    '- po_reasoning: MAGYARUL, 1-2 mondatban magyarázd el a projektszám azonosítás',
    '  alapját vagy hiányát',
    '',
    'FONTOS SZABÁLYOK:',
    '- Ha a számla egyetlen tételt tartalmaz, az is tételsorként szerepeljen',
    '- Ha nem találsz tételsorokat: hozz létre 1 sort a fejléc összegekkel',
    '- po értéke CSAK a fenti listából kerülhet ki, vagy null',
    '- Minden szám mező valódi szám legyen (ne string)',
    '- Dátumok mindig YYYY-MM-DD formátum',
    '- Ha egy mező nem olvasható/nem szerepel: null',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gemini structured output schema.
 * Kényszeríti a JSON formátumot — parse hiba valószínűsége minimális.
 */
function _getResponseSchema_() {
  return {
    type: 'object',
    properties: {
      szallito_nev:      { type: 'string'  },
      szallito_adoszam:  { type: 'string'  },
      szamlaszam:        { type: 'string'  },
      kelt:              { type: 'string'  },
      teljesites_datum:  { type: 'string'  },
      fizhatarido:       { type: 'string'  },
      osszeg_netto:      { type: 'number'  },
      osszeg_brutto:     { type: 'number'  },
      deviza:            { type: 'string'  },
      tetelek: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            leiras:        { type: 'string'  },
            mennyiseg:     { type: 'number'  },
            egysegar:      { type: 'number'  },
            netto:         { type: 'number'  },
            afa_szazalek:  { type: 'number'  },
            afa_osszeg:    { type: 'number'  },
            brutto:        { type: 'number'  },
            po:            { type: 'string'  },
            po_confidence: { type: 'number'  },
            po_reasoning:  { type: 'string'  },
          },
          required: ['leiras', 'po_confidence', 'po_reasoning'],
        },
      },
    },
    required: ['szallito_nev', 'szamlaszam', 'kelt', 'tetelek'],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON PARSE + VALIDÁCIÓ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parseolja és alapszinten validálja a Gemini JSON válaszát.
 * @param {string} rawJson
 * @returns {Object} Validált extracted objektum
 * @throws Ha a JSON nem parseolható vagy kritikus mezők hiányoznak
 */
function _parseGeminiResponse_(rawJson) {
  let obj;
  try {
    obj = JSON.parse(rawJson);
  } catch (e) {
    throw new Error('Gemini válasz nem valid JSON: ' + rawJson.substring(0, 200));
  }

  // Kötelező mezők ellenőrzése
  if (!obj.szallito_nev) throw new Error('Gemini: szallito_nev hiányzik');
  if (!obj.szamlaszam)   throw new Error('Gemini: szamlaszam hiányzik');
  if (!obj.kelt)         throw new Error('Gemini: kelt hiányzik');

  if (!obj.tetelek || !Array.isArray(obj.tetelek) || obj.tetelek.length === 0) {
    throw new Error('Gemini: tetelek tömb hiányzik vagy üres');
  }

  // Tételek szanitizálása — null értékek alapértelmezése
  obj.tetelek = obj.tetelek.map(function(t, i) {
    return {
      leiras:        t.leiras        || ('Tétel ' + (i + 1)),
      mennyiseg:     Number(t.mennyiseg)  || 1,
      egysegar:      Number(t.egysegar)   || 0,
      netto:         Number(t.netto)      || 0,
      afa_szazalek:  (t.afa_szazalek !== null && t.afa_szazalek !== undefined) ? Number(t.afa_szazalek) : 27,
      afa_osszeg:    Number(t.afa_osszeg)  || 0,
      brutto:        Number(t.brutto)      || 0,
      po:            t.po            || null,
      po_confidence: Number(t.po_confidence) || 0,
      po_reasoning:  t.po_reasoning  || 'Nem azonosítható',
    };
  });

  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// PO AGGREGÁLÁS (kód végzi — nem Gemini)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aggregálja a tétel-szintű PO adatokat a BEJÖVŐ_SZÁMLÁK fejléc szintjére.
 *
 * Szabályok:
 *   ÁLLANDÓ kategória → poSummary = 'N/A', poConfidence = 100, poReasoning = 'ÁLLANDÓ kategória'
 *   1 egyedi PO, mind IGEN → poSummary = az a PO, poConfidence = annak confidence-e
 *   Több különböző PO → poSummary = 'MULTI', poConfidence = MIN(tételek conf.)
 *   Bármely tétel po = null/üres → poSummary = 'HIÁNYOS', poConfidence = 0
 *
 * @param {Object[]} tetelek
 * @param {string}   kategoria  - Partner kategória (ÁLLANDÓ/PROJEKT/MEGOSZTOTT)
 * @returns {{ poSummary: string, poConfidence: number, poReasoning: string }}
 */
function _aggregatePO_(tetelek, kategoria) {
  // ÁLLANDÓ és MEGOSZTOTT bypass — PO ellenőrzés kihagyva
  // KOZ-01: MEGOSZTOTT rezsi-számlák PO nélkül BEÉRKEZETT státuszt kapnak,
  // mivel az allokáció az ALLOKÁCIÓK fülön történik, nem PO-alapon.
  if (kategoria === CONFIG.KATEGORIAK.ALLANDO ||
      kategoria === CONFIG.KATEGORIAK.MEGOSZTOTT) {
    return {
      poSummary:    'N/A',
      poConfidence: 100,
      poReasoning:  kategoria + ' kategóriájú partner — PO ellenőrzés kihagyva',
    };
  }

  const uniquePOs = new Set();
  let   minConf   = 100;
  let   hasEmpty  = false;

  tetelek.forEach(function(t) {
    const po   = t.po ? String(t.po).trim() : '';
    const conf = Number(t.po_confidence) || 0;

    if (!po) {
      hasEmpty = true;
      minConf  = 0;
    } else {
      uniquePOs.add(po);
      if (conf < minConf) minConf = conf;
    }
  });

  // HIÁNYOS: legalább 1 tétel PO nélkül
  if (hasEmpty) {
    return {
      poSummary:    'HIÁNYOS',
      poConfidence: 0,
      poReasoning:  'NINCS_PO',
    };
  }

  // 1 egyedi PO
  if (uniquePOs.size === 1) {
    const singlePO    = Array.from(uniquePOs)[0];
    const singleTetel = tetelek.find(function(t) { return t.po === singlePO; });
    return {
      poSummary:    singlePO,
      poConfidence: minConf,
      poReasoning:  singleTetel ? singleTetel.po_reasoning : '',
    };
  }

  // MULTI: több különböző PO
  return {
    poSummary:    'MULTI',
    poConfidence: minConf,
    poReasoning:  'MULTI_TETEL – lásd SZÁMLA_TÉTELEK',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STÁTUSZ-DÖNTÉS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Meghatározza a számla státuszát a tételek PO_VALIDÁLT értéke alapján.
 *
 * @param {Object[]} tetelek
 * @param {string}   kategoria
 * @param {{poSummary: string}} poAgg
 * @returns {'BEÉRKEZETT'|'HIÁNYOS_PO'}
 */
function _decideStatusz_(tetelek, kategoria, poAgg) {
  // ÁLLANDÓ: PO ellenőrzés nélkül BEÉRKEZETT
  if (kategoria === CONFIG.KATEGORIAK.ALLANDO) return 'BEÉRKEZETT';

  // N/A PO summary → BEÉRKEZETT (pl. MEGOSZTOTT + sablon nélkül is elfogadjuk)
  if (poAgg.poSummary === 'N/A') return 'BEÉRKEZETT';

  // Minden tételt ellenőrzünk
  const anyInvalid = tetelek.some(function(t) {
    const po   = t.po ? String(t.po).trim() : '';
    const conf = Number(t.po_confidence) || 0;
    if (!po)                                    return true; // nincs PO
    if (conf < CONFIG.PO_CONFIDENCE_THRESHOLD)  return true; // alacsony konfidencia
    if (!_isProjectInRegistry_(po))             return true; // PO nem szerepel PROJEKTEK-ben
    return false;
  });

  return anyInvalid ? 'HIÁNYOS_PO' : 'BEÉRKEZETT';
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTNER KATEGÓRIA LEKÉRÉS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Megkeresi a partner kategóriáját a PARTNEREK fülön név vagy adószám alapján.
 * Ha nem található: null (→ PROJEKT-ként kezeljük, PO ellenőrzés fut)
 *
 * @param {string} nev
 * @param {string} adoszam
 * @returns {string|null}
 */
function _getPartnerKategoria_(nev, adoszam) {
  try {
    const ss      = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet   = ss.getSheetByName(CONFIG.TABS.PARTNEREK);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;

    const cp   = CONFIG.COLS.PARTNER;
    const data = sheet.getRange(2, 1, lastRow - 1, cp.KATEGORIA).getValues();
    const nevStr    = String(nev    || '').trim().toLowerCase();
    const adoszamStr= String(adoszam || '').trim().replace(/[^0-9]/g, '');

    for (let i = 0; i < data.length; i++) {
      const rowNev     = String(data[i][cp.NEV      - 1] || '').trim().toLowerCase();
      const rowAdoszam = String(data[i][cp.ADOSZAM  - 1] || '').trim().replace(/[^0-9]/g, '');
      const rowKat     = String(data[i][cp.KATEGORIA- 1] || '').trim();

      if (!rowNev && !rowAdoszam) continue;

      // Adószám egyezés (prioritás)
      if (adoszamStr && rowAdoszam && adoszamStr === rowAdoszam) return rowKat || null;
      // Név egyezés (fallback)
      if (nevStr && rowNev && nevStr === rowNev) return rowKat || null;
    }
  } catch (e) {
    console.warn('_getPartnerKategoria_ hiba: ' + e.message);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJEKT REGISTRY LEKÉRÉS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ellenőrzi, hogy a projektszám szerepel-e a PROJEKTEK registry-ben.
 * A loadValidProjects() (Utils.gs) megosztott cache-ét használja.
 * @param {string} po
 * @returns {boolean}
 */
function _isProjectInRegistry_(po) {
  const projects = loadValidProjects();
  return projects.indexOf(String(po).trim()) !== -1;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESZTELŐ FÜGGVÉNYEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PO aggregálás unit tesztek — nem kell sheet hozzáférés.
 * Futtatás: Script Editor → testAggregatePO → ▶ Run
 */
function testAggregatePO() {
  console.log('══════════════════════════════════════');
  console.log('PO aggregálás tesztek');
  console.log('══════════════════════════════════════');

  // TC1: ÁLLANDÓ bypass
  const r1 = _aggregatePO_([], CONFIG.KATEGORIAK.ALLANDO);
  console.log('TC1 ÁLLANDÓ: summary=' + r1.poSummary +
    (r1.poSummary === 'N/A' ? ' ✓' : ' ✗'));

  // TC2: 1 PO, magas confidence
  const r2 = _aggregatePO_([
    { po: 'TEST2601', po_confidence: 98, po_reasoning: 'Explicit a számlán' },
    { po: 'TEST2601', po_confidence: 95, po_reasoning: 'Kontextus alapján' },
  ], CONFIG.KATEGORIAK.PROJEKT);
  console.log('TC2 Single PO: summary=' + r2.poSummary + ', conf=' + r2.poConfidence +
    (r2.poSummary === 'TEST2601' && r2.poConfidence === 95 ? ' ✓' : ' ✗'));

  // TC3: MULTI
  const r3 = _aggregatePO_([
    { po: 'TEST2601', po_confidence: 97, po_reasoning: 'R1' },
    { po: 'FCA2601',  po_confidence: 88, po_reasoning: 'R2' },
  ], CONFIG.KATEGORIAK.PROJEKT);
  console.log('TC3 MULTI: summary=' + r3.poSummary + ', conf=' + r3.poConfidence +
    (r3.poSummary === 'MULTI' && r3.poConfidence === 88 ? ' ✓' : ' ✗'));

  // TC4: HIÁNYOS (null PO)
  const r4 = _aggregatePO_([
    { po: 'TEST2601', po_confidence: 97, po_reasoning: 'R1' },
    { po: null,       po_confidence: 0,  po_reasoning: 'Nem azonosítható' },
  ], CONFIG.KATEGORIAK.PROJEKT);
  console.log('TC4 HIÁNYOS: summary=' + r4.poSummary +
    (r4.poSummary === 'HIÁNYOS' && r4.poConfidence === 0 ? ' ✓' : ' ✗'));

  // TC5: HIÁNYOS (low confidence)
  // _decideStatusz_ dönti el, nem _aggregatePO_ — ez csak összegez
  const r5 = _aggregatePO_([
    { po: 'TEST2601', po_confidence: 45, po_reasoning: 'Bizonytalan' },
  ], CONFIG.KATEGORIAK.PROJEKT);
  console.log('TC5 Low conf: summary=' + r5.poSummary + ', conf=' + r5.poConfidence +
    (r5.poSummary === 'TEST2601' && r5.poConfidence === 45 ? ' ✓' : ' ✗'));
  // Megjegyzés: TC5-ben poSummary=TEST2601 (nem HIÁNYOS) mert a PO létezik
  // A _decideStatusz_ fogja HIÁNYOS_PO-vá tenni conf < 95 miatt

  console.log('══════════════════════════════════════');
}

/**
 * Prompt megjelenítése ellenőrzéshez — nem hív API-t.
 * Futtatás: Script Editor → previewPrompt → ▶ Run
 */
function previewPrompt() {
  const projects = loadValidProjects();
  console.log(_buildPrompt_(projects.join(', ') || '(üres)'));
}
