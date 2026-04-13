/**
 * Config.gs
 * Armadillo Pénzügyi Automatizáció — Központi konfiguráció
 *
 * TESZT vs ÉLES váltás: TEST_MODE konstans — egyetlen kapcsoló.
 * TEST_MODE = true  → staging sheet + teszt mappák + minden chat/email → Admin webhook / autobot@
 * TEST_MODE = false → éles sheet + éles mappák + valódi webhookok
 *
 * FIGYELEM: Gemini API key-t NEM tároljuk itt — PropertiesService-ben van.
 * Beállítás: Script Editor → Project Settings → Script Properties → GEMINI_API_KEY
 */

// ─────────────────────────────────────────────────────────────────────────────
// TESZT / ÉLES KAPCSOLÓ
// ─────────────────────────────────────────────────────────────────────────────

const TEST_MODE = true; // ← EGYETLEN KAPCSOLÓ: true = teszt, false = éles

// ─────────────────────────────────────────────────────────────────────────────
// SHEET ÉS MAPPA ID-K
// ─────────────────────────────────────────────────────────────────────────────

const _IDS_ = {
  test: {
    SPREADSHEET_ID:    '',  // ← TestSetup.gs futtatása után ide kerül
    INVOICES_FOLDER_ID:'',  // ← Bejövő számlák TEST mappa ID
    REJECTED_FOLDER_ID:'',  // ← Visszautasított TEST mappa ID
    BATCHES_FOLDER_ID: '',  // ← Kötegek TEST mappa ID
  },
  prod: {
    SPREADSHEET_ID:    '',  // ← Éles SSOT sheet ID (Fázis 0 Task 01 után)
    INVOICES_FOLDER_ID:'',  // ← Éles "Bejövő számlák" mappa ID
    REJECTED_FOLDER_ID:'',  // ← Éles "Visszautasított" mappa ID
    BATCHES_FOLDER_ID: '',  // ← Éles "Kötegek" mappa ID
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CHAT WEBHOOK URL-EK
// ─────────────────────────────────────────────────────────────────────────────

const _WEBHOOKS_ = {
  test: {
    // Tesztüzemmódban minden értesítő az Admin webhook-ra megy
    OPS:     '', // ← Admin webhook URL (P2 task után)
    FINANCE: '', // ← Admin webhook URL (P2 task után)
    ADMIN:   '', // ← Admin webhook URL (P2 task után)
  },
  prod: {
    OPS:     '', // ← 🟢 Pénzügy-Jóváhagyások space webhook (Ági + Márk)
    FINANCE: '', // ← 🏦 Pénzügy-Utalások space webhook (Péter)
    ADMIN:   '', // ← 🤖 IT Rendszerlogok space webhook (IT only)
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL ROUTING
// ─────────────────────────────────────────────────────────────────────────────

const _EMAILS_ = {
  test: {
    ADMIN:   'autobot@armadillo.hu', // Tesztben minden admin email ide megy
    OPS:     'autobot@armadillo.hu',
    FINANCE: 'autobot@armadillo.hu',
  },
  prod: {
    ADMIN:   'autobot@armadillo.hu',
    OPS:     '',  // ← Ági email
    FINANCE: '',  // ← Péter email
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIKUS CONFIG OBJECT — ezt használja az összes többi script
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Az egyetlen belépési pont a konfigurációhoz.
 * Automatikusan a TEST_MODE alapján választja ki az értékeket.
 *
 * @type {{
 *   TEST_MODE: boolean,
 *   SPREADSHEET_ID: string,
 *   INVOICES_FOLDER_ID: string,
 *   REJECTED_FOLDER_ID: string,
 *   BATCHES_FOLDER_ID: string,
 *   CHAT_WEBHOOK_OPS: string,
 *   CHAT_WEBHOOK_FINANCE: string,
 *   CHAT_WEBHOOK_ADMIN: string,
 *   ADMIN_EMAIL: string,
 *   OPS_EMAIL: string,
 *   FINANCE_EMAIL: string,
 *   PO_CONFIDENCE_THRESHOLD: number,
 *   PROJEKTSZAM_REGEX: RegExp,
 *   GMAIL_QUERY: string,
 *   LOCK_TIMEOUT_MS: number,
 * }}
 */
const CONFIG = (function () {
  const env = TEST_MODE ? 'test' : 'prod';

  return {
    // ── Meta
    TEST_MODE: TEST_MODE,

    // ── Sheet + Drive
    SPREADSHEET_ID:     _IDS_[env].SPREADSHEET_ID,
    INVOICES_FOLDER_ID: _IDS_[env].INVOICES_FOLDER_ID,
    REJECTED_FOLDER_ID: _IDS_[env].REJECTED_FOLDER_ID,
    BATCHES_FOLDER_ID:  _IDS_[env].BATCHES_FOLDER_ID,

    // ── Chat webhooks
    // Tesztmódban OPS és FINANCE az Admin webhook-ra van irányítva
    CHAT_WEBHOOK_OPS:     TEST_MODE ? _WEBHOOKS_.test.ADMIN : _WEBHOOKS_.prod.OPS,
    CHAT_WEBHOOK_FINANCE: TEST_MODE ? _WEBHOOKS_.test.ADMIN : _WEBHOOKS_.prod.FINANCE,
    CHAT_WEBHOOK_ADMIN:   _WEBHOOKS_[env].ADMIN,

    // ── Emailek
    ADMIN_EMAIL:   _EMAILS_[env].ADMIN,
    OPS_EMAIL:     _EMAILS_[env].OPS,
    FINANCE_EMAIL: _EMAILS_[env].FINANCE,

    // ── Üzleti logika
    PO_CONFIDENCE_THRESHOLD: 95, // % alatti → HIÁNYOS_PO

    // ── Validáció
    // 3–4 nagybetű + 4 szám (pl. FCA2601, IMME2601)
    PROJEKTSZAM_REGEX: /^[A-Z]{3,4}[0-9]{4}$/,

    // ── Partner kategóriák (reference — nem enum, a PARTNEREK fülön tárolt szöveg)
    KATEGORIAK: {
      PROJEKT:     'PROJEKT',     // Projekthez kötött alvállalkozó
      ALLANDO:     'ÁLLANDÓ',     // Fix rezsi (bérleti díj, áram stb.)
      MEGOSZTOTT:  'MEGOSZTOTT',  // Overhead — ALLOKÁCIÓK fülön kerül szétosztásra
    },

    // ── Allokáció típusok (ALLOKÁCIÓK fül, ALLOKÁCIÓ_TÍPUS oszlop)
    ALLOKACIO_TIPUSOK: {
      MANUALIS: 'MANUÁLIS',  // Ági kézzel tölti ki
      FIX:      'FIX',       // Sablon alapján automatikus (PARTNEREK.Allokációs sablon)
      AI:       'AI',        // Fázis 6 — Gemini alapján (jelenleg nem aktív)
    },

    // ── Gmail trigger lekérdezés
    GMAIL_QUERY: 'in:inbox is:unread has:attachment',

    // ── LockService timeout (ms) — ha nem sikerül zárat szerezni, LOCK_TIMEOUT hiba
    LOCK_TIMEOUT_MS: 10000,

    // ── Tab nevek (ha a kód sheet neve szerint keres)
    TABS: {
      BEJOVO_SZAMLAK:  'BEJÖVŐ_SZÁMLÁK',
      SZAMLA_TETELEK:  'SZÁMLA_TÉTELEK',
      PROJEKTEK:       'PROJEKTEK',
      PARTNEREK:       'PARTNEREK',
      KOTEGEK:         'KÖTEGEK',
      KIMENO_SZAMLAK:  'KIMENŐ_SZÁMLÁK',
      CONFIG:          'CONFIG',
      ALLOKACIOK_TAB:  'ALLOKÁCIÓK',
    },

    // ── Oszlop indexek (1-alapú, getRange() és getLastColumn() kompatibilis)
    COLS: {
      // BEJÖVŐ_SZÁMLÁK
      BEJOVO: {
        SZAMLA_ID:          1,   // A
        SZALLITO_NEV:       2,   // B
        ADOSZAM:            3,   // C
        SZAMLASZAM:         4,   // D
        KELT:               5,   // E
        OSSZEG_NETTO:       6,   // F
        TELJESITES:         7,   // G
        FIZHATARIDO:        8,   // H
        OSSZEG_BRUTTO:      9,   // I
        DEVIZA:             10,  // J
        KATEGORIA:          11,  // K
        DRIVE_URL:          12,  // L
        DRIVE_FILE_ID:      13,  // M
        PO_SUMMARY:         14,  // N
        PO_CONFIDENCE:      15,  // O
        PO_REASONING:       16,  // P
        STATUSZ:            17,  // Q  ← onEdit figyeli
        JOVAHAGYO:          18,  // R
        JOVAHAGYAS_DATUM:   19,  // S
        VISSZAUTASITAS_OKA: 20,  // T
        UTALAS_DATUM:       21,  // U
        KOTEG_ID:           22,  // V
        GMAIL_MESSAGE_ID:   23,  // W  ← deduplikáció
      },
      // SZÁMLA_TÉTELEK
      TETEL: {
        SZAMLA_ID:       1,   // A
        TETEL_SZAM:      2,   // B
        LEIRAS:          3,   // C
        MENNYISEG:       4,   // D
        EGYSEGAR:        5,   // E
        NETTO:           6,   // F
        AFA_SZAZALEK:    7,   // G
        AFA_OSSZEG:      8,   // H
        BRUTTO:          9,   // I
        PO:              10,  // J
        PO_CONFIDENCE:   11,  // K
        PO_REASONING:    12,  // L
        PO_VALIDALT:     13,  // M  ← 'IGEN'/'NEM'
      },
      // PARTNEREK
      PARTNER: {
        NEV:               1,   // A
        ADOSZAM:           2,   // B
        BANKSZAMLA:        3,   // C
        KATEGORIA:         4,   // D
        EMAIL:             5,   // E
        FIZETESI_HATARIDO: 6,   // F
        AKTIV:             7,   // G
        ALLOKACIOASSABLON: 8,   // H
      },
      // ALLOKÁCIÓK
      ALLOKACIO: {
        ALLOKACIO_ID:    1,   // A
        SZAMLA_ID:       2,   // B
        PROJEKT:         3,   // C
        ARANY_SZAZALEK:  4,   // D
        OSSZEG_NETTO:    5,   // E
        ALLOKACIO_TIPUS: 6,   // F  ← MANUÁLIS/FIX/AI
        LETREHOZVA:      7,   // G
        MEGJEGYZES:      8,   // H
      },
    },
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI API KEY LEKÉRÉS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A Gemini API key-t PropertiesService-ből olvassa.
 * Ha nincs beállítva, hibát dob — szándékosan, hogy a hiány ne maradjon rejtve.
 * Beállítás: Script Editor → Project Settings → Script Properties → GEMINI_API_KEY = "..."
 * @returns {string}
 */
function getGeminiApiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) {
    throw new Error('GEMINI_API_KEY nincs beállítva a Script Properties-ben. ' +
      'Script Editor → Project Settings → Script Properties → Add property.');
  }
  return key;
}

// ─────────────────────────────────────────────────────────────────────────────
// KONFIGURÁCIÓ ELLENŐRZÉS (segédfüggvény — teszteléshez futtatható)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kiírja a konzolra az aktív konfigurációt.
 * Futtatás: Script Editor → válaszd ki → ▶ Run
 */
function logConfig() {
  console.log('══════════════════════════════════════');
  console.log('Armadillo Config — aktív konfiguráció');
  console.log('══════════════════════════════════════');
  console.log('TEST_MODE:          ' + CONFIG.TEST_MODE);
  console.log('SPREADSHEET_ID:     ' + (CONFIG.SPREADSHEET_ID || '⚠️  NINCS BEÁLLÍTVA'));
  console.log('INVOICES_FOLDER_ID: ' + (CONFIG.INVOICES_FOLDER_ID || '⚠️  NINCS BEÁLLÍTVA'));
  console.log('REJECTED_FOLDER_ID: ' + (CONFIG.REJECTED_FOLDER_ID || '⚠️  NINCS BEÁLLÍTVA'));
  console.log('BATCHES_FOLDER_ID:  ' + (CONFIG.BATCHES_FOLDER_ID  || '⚠️  NINCS BEÁLLÍTVA'));
  console.log('CHAT_WEBHOOK_OPS:   ' + (CONFIG.CHAT_WEBHOOK_OPS    || '⚠️  NINCS BEÁLLÍTVA'));
  console.log('CHAT_WEBHOOK_FINANCE:' + (CONFIG.CHAT_WEBHOOK_FINANCE|| '⚠️  NINCS BEÁLLÍTVA'));
  console.log('CHAT_WEBHOOK_ADMIN: ' + (CONFIG.CHAT_WEBHOOK_ADMIN  || '⚠️  NINCS BEÁLLÍTVA'));
  console.log('ADMIN_EMAIL:        ' + CONFIG.ADMIN_EMAIL);
  console.log('PO_THRESHOLD:       ' + CONFIG.PO_CONFIDENCE_THRESHOLD + '%');
  console.log('PROJEKTSZAM_REGEX:  ' + CONFIG.PROJEKTSZAM_REGEX);

  // Gemini key ellenőrzés
  try {
    const key = getGeminiApiKey();
    console.log('GEMINI_API_KEY:     ✓ beállítva (' + key.substring(0, 6) + '...)');
  } catch (e) {
    console.log('GEMINI_API_KEY:     ⚠️  ' + e.message);
  }

  console.log('══════════════════════════════════════');

  // Figyelmeztetés ha bármely kritikus mező üres
  const criticalEmpty = [
    CONFIG.SPREADSHEET_ID,
    CONFIG.INVOICES_FOLDER_ID,
    CONFIG.CHAT_WEBHOOK_ADMIN,
  ].filter(v => !v);

  if (criticalEmpty.length > 0) {
    console.log('⚠️  ' + criticalEmpty.length + ' kritikus mező NINCS BEÁLLÍTVA — töltsd ki a Config.gs-ben!');
  } else {
    console.log('✅ Minden kritikus mező be van állítva.');
  }
}
