'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  SecureHealth QR — encrypt.js
//  Handles: AES-256 encryption, payload building, override code generation,
//           form data collection, validation
//
//  Depends on:
//    - CryptoJS 4.1.1  (CDN: cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js)
//    - patient.html    (DOM form structure)
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
//  1. OVERRIDE CODE GENERATOR
//     Produces a random EMR-XXXX-XXXX style code
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random emergency override code.
 * Format: EMR-XXXX-XXXX  (X = alphanumeric, ambiguous chars excluded)
 * @returns {string}  e.g. "EMR-4K9X-PLMR"
 */
function generateOverrideCode() {
  // Exclude visually ambiguous characters: 0/O, 1/I/L
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  let code = 'EMR-';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  code += '-';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code; // e.g. "EMR-4K9X-PLMR"
}


// ─────────────────────────────────────────────────────────────────────────────
//  2. AES-256 ENCRYPTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt a JavaScript object with AES-256 using CryptoJS.
 * The key is never stored — only the ciphertext is saved.
 *
 * @param {Object} data   - Plain JS object to encrypt
 * @param {string} key    - Encryption key (PIN or override code)
 * @returns {string}      - Base64 ciphertext string
 * @throws {Error}        - If CryptoJS is not loaded
 */
function encryptData(data, key) {
  if (typeof CryptoJS === 'undefined') {
    throw new Error('CryptoJS is not loaded. Add the CDN script to your HTML.');
  }

  const plainText  = JSON.stringify(data);
  const cipherText = CryptoJS.AES.encrypt(plainText, key).toString();

  return cipherText;
}


// ─────────────────────────────────────────────────────────────────────────────
//  3. PAYLOAD BUILDER
//     Builds the complete QR payload from patient form data + PIN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the full encrypted QR payload from patient data and PIN.
 *
 * Payload structure:
 * {
 *   version:        string    — schema version
 *   public:         Object    — visible without PIN (blood type, flags)
 *   pinLocked:      string    — AES(privateData, PIN)
 *   overrideLocked: string    — AES(privateData, overrideCode)
 *   createdAt:      string    — ISO timestamp
 * }
 *
 * @param {Object} privateData  - Full patient record (name, allergies, etc.)
 * @param {Object} publicData   - Non-sensitive flags (blood type, isDonor, etc.)
 * @param {string} pin          - Patient's chosen PIN
 * @returns {{ payload: Object, overrideCode: string }}
 */
function buildQRPayload(privateData, publicData, pin) {
  const overrideCode = generateOverrideCode();

  const pinEncrypted      = encryptData(privateData, pin);
  const overrideEncrypted = encryptData(privateData, overrideCode);

  const payload = {
    version:        '1.0',
    public:         publicData,
    pinLocked:      pinEncrypted,
    overrideLocked: overrideEncrypted,
    createdAt:      new Date().toISOString()
  };

  return { payload, overrideCode };
}


// ─────────────────────────────────────────────────────────────────────────────
//  4. FORM DATA COLLECTOR
//     Reads patient.html form fields and returns structured objects
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collect all tag values from a tag-input area.
 * Tags are <div class="tag"> elements with data-val attributes.
 *
 * @param {string} areaId  - ID of the tag area container
 * @returns {string[]}
 */
function collectTags(areaId) {
  const area = document.getElementById(areaId);
  if (!area) return [];
  return [...area.querySelectorAll('.tag')]
    .map(tag => tag.dataset.val || tag.textContent.replace('✕', '').trim())
    .filter(Boolean);
}

/**
 * Collect selected checkboxes from a grid.
 * Looks for .check-item.checked elements with data-val attributes.
 *
 * @param {string} gridId  - ID of the checkbox grid container
 * @returns {string[]}
 */
function collectChecked(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return [];
  return [...grid.querySelectorAll('.check-item.checked')]
    .map(item => item.dataset.val)
    .filter(Boolean);
}

/**
 * Collect selected organs from the organ donation grid.
 *
 * @returns {string[]}
 */
function collectOrgans() {
  return [...document.querySelectorAll('.organ-item.checked')]
    .map(item => item.dataset.val)
    .filter(Boolean);
}

/**
 * Read a form field value safely.
 *
 * @param {string} id
 * @returns {string}
 */
function field(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

/**
 * Collect the complete patient form data into private + public objects.
 *
 * @param {string} selectedBloodType  - Blood type selected via pill buttons
 * @param {boolean} isDonor           - Whether patient is an organ donor
 * @returns {{ privateData: Object, publicData: Object }}
 */
function collectFormData(selectedBloodType, isDonor) {
  const allergies   = collectTags('allergyArea');
  const medications = collectTags('medicineArea');
  const conditions  = collectChecked('conditionGrid');
  const organs      = isDonor ? collectOrgans() : [];

  const privateData = {
    name:       field('name'),
    dob:        field('dob'),
    gender:     field('gender'),
    bloodType:  selectedBloodType,
    allergies,
    medications,
    conditions,
    emergencyContact: {
      name:     field('contactName'),
      phone:    field('contactPhone'),
      relation: field('contactRelation')
    },
    organDonation: {
      isDonor,
      organs
    }
  };

  // Public data — visible without PIN
  const publicData = {
    bloodType:      selectedBloodType,
    hasAllergies:   allergies.length > 0,
    isDonor,
    emergencyPhone: field('contactPhone')
  };

  return { privateData, publicData };
}


// ─────────────────────────────────────────────────────────────────────────────
//  5. FORM VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate all required patient form fields.
 * Returns { valid: true } or { valid: false, message: string }
 *
 * @param {string} selectedBloodType
 * @param {string} pin
 * @param {string} confirmPin
 * @returns {{ valid: boolean, message?: string }}
 */
function validateForm(selectedBloodType, pin, confirmPin) {
  if (!field('name')) {
    return { valid: false, message: 'Please enter your full name.' };
  }

  if (!field('dob')) {
    return { valid: false, message: 'Please enter your date of birth.' };
  }

  if (!selectedBloodType) {
    return { valid: false, message: 'Please select your blood type.' };
  }

  if (!field('contactName')) {
    return { valid: false, message: 'Please enter an emergency contact name.' };
  }

  if (!field('contactPhone')) {
    return { valid: false, message: 'Please enter an emergency contact phone number.' };
  }

  if (pin.length < 4) {
    return { valid: false, message: 'PIN must be at least 4 digits.' };
  }

  if (pin !== confirmPin) {
    return { valid: false, message: 'PINs do not match. Please re-enter.' };
  }

  return { valid: true };
}


// ─────────────────────────────────────────────────────────────────────────────
//  6. MAIN SUBMIT HANDLER
//     Called by patient.html when the Generate QR button is tapped
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entry point called from patient.html submit button.
 * Validates → encrypts → stores → navigates to generate.html
 *
 * @param {string} selectedBloodType  - From blood pill selection
 * @param {boolean} isDonor           - From organ donation toggle
 * @param {string} pin                - From PIN numpad
 * @param {string} confirmPin         - From confirm PIN numpad
 */
function submitPatientForm(selectedBloodType, isDonor, pin, confirmPin) {
  // ── Validate ──
  const validation = validateForm(selectedBloodType, pin, confirmPin);
  if (!validation.valid) {
    showFormError(validation.message);
    return;
  }

  hideFormError();

  // ── Collect form data ──
  const { privateData, publicData } = collectFormData(selectedBloodType, isDonor);

  // ── Build encrypted payload ──
  let payload, overrideCode;
  try {
    ({ payload, overrideCode } = buildQRPayload(privateData, publicData, pin));
  } catch (err) {
    showFormError('Encryption failed: ' + err.message);
    return;
  }

  // ── Store in sessionStorage for generate.html ──
  sessionStorage.setItem('qrPayload',    JSON.stringify(payload));
  sessionStorage.setItem('overrideCode', overrideCode);

  // ── Navigate ──
  window.location.href = 'generate.html';
}


// ─────────────────────────────────────────────────────────────────────────────
//  7. UI HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Show the form error banner with a message.
 * @param {string} message
 */
function showFormError(message) {
  const el  = document.getElementById('formError');
  const msg = document.getElementById('formErrorMsg');
  if (!el || !msg) return;
  msg.textContent = message;
  el.classList.add('visible');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * Hide the form error banner.
 */
function hideFormError() {
  const el = document.getElementById('formError');
  if (el) el.classList.remove('visible');
}


// ─────────────────────────────────────────────────────────────────────────────
//  8. EXPORTS — expose to patient.html global scope
// ─────────────────────────────────────────────────────────────────────────────
window.EncryptModule = {
  generateOverrideCode,
  encryptData,
  buildQRPayload,
  collectFormData,
  collectTags,
  collectChecked,
  collectOrgans,
  validateForm,
  submitPatientForm,
  showFormError,
  hideFormError
};