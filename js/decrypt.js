'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  SecureHealth QR — decrypt.js
//  Handles: AES-256 decryption, tiered access control, brute-force lockout,
//           access logging, payload normalisation
//
//  Depends on:
//    - CryptoJS 4.1.1  (CDN: cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js)
//    - access.html     (DOM structure)
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const MAX_ATTEMPTS   = 5;
const LOCKOUT_MS     = 10 * 60 * 1000;   // 10 minutes
const LOCKOUT_KEY    = 'shqr_lockout';
const ACCESS_LOG_KEY = 'shqr_accessLogs';


// ─────────────────────────────────────────────────────────────────────────────
//  1. CORE AES-256 DECRYPT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempt to decrypt a CryptoJS AES ciphertext with a given key.
 * Returns the parsed JSON object on success, or null on failure.
 * Never throws — failures return null silently.
 *
 * @param {string} cipherText  - Base64 AES-256 ciphertext
 * @param {string} key         - Decryption key (PIN or override code)
 * @returns {Object|null}
 */
function decryptData(cipherText, key) {
  if (!cipherText || !key) return null;
  if (typeof CryptoJS === 'undefined') {
    console.error('[decrypt] CryptoJS not loaded.');
    return null;
  }

  try {
    const bytes      = CryptoJS.AES.decrypt(cipherText, key);
    const plainText  = bytes.toString(CryptoJS.enc.Utf8);

    // Empty string means wrong key
    if (!plainText) return null;

    return JSON.parse(plainText);
  } catch (e) {
    // JSON parse error or malformed ciphertext — wrong key
    return null;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
//  2. PAYLOAD NORMALISER
//     Handles both compact (v1) and legacy payload key formats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise a scanned QR payload to a consistent shape regardless of
 * whether it uses compact keys (v, p, pk, ok) or legacy keys
 * (version, public, pinLocked, overrideLocked).
 *
 * Also resolves local-mode payloads (id + local:true) from localStorage.
 *
 * @param {Object} rawPayload   - Parsed JSON from QR scan
 * @returns {{ ok: true, payload: Object } | { ok: false, error: string }}
 */
function normalisePayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return { ok: false, error: 'Payload is not a valid object.' };
  }

  // ── Resolve local-mode QR ──
  if (rawPayload.local === true && rawPayload.id) {
    const stored = localStorage.getItem(rawPayload.id);
    if (!stored) {
      return {
        ok: false,
        error: 'QR references local data that no longer exists on this device. Patient needs to regenerate their QR.'
      };
    }
    try {
      rawPayload = JSON.parse(stored);
    } catch (e) {
      return { ok: false, error: 'Local QR data is corrupted.' };
    }
  }

  // ── Validate version ──
  const version = rawPayload.v || rawPayload.version;
  if (!version) {
    return { ok: false, error: 'Not a valid SecureHealth QR code.' };
  }

  // ── Normalise to unified structure ──
  const normalised = {
    version:        version,
    pinLocked:      rawPayload.pk || rawPayload.pinLocked      || '',
    overrideLocked: rawPayload.ok || rawPayload.overrideLocked || '',
    public:         _normalisePublic(rawPayload.p  || rawPayload.public || {}),
    createdAt:      rawPayload.t  || rawPayload.createdAt || null
  };

  if (!normalised.pinLocked && !normalised.overrideLocked) {
    return { ok: false, error: 'QR payload contains no encrypted data.' };
  }

  return { ok: true, payload: normalised };
}

/**
 * Normalise compact public data keys (b, a, d, e) to full key names.
 * @private
 */
function _normalisePublic(pub) {
  return {
    bloodType:      pub.b  ?? pub.bloodType      ?? 'Unknown',
    hasAllergies:   pub.a  != null ? !!pub.a : !!(pub.hasAllergies),
    isDonor:        pub.d  != null ? !!pub.d : !!(pub.isDonor),
    emergencyPhone: pub.e  ?? pub.emergencyPhone  ?? ''
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  3. TIERED ACCESS
//     Level 0 — public data (no PIN)
//     Level 1 — override code (read-only)
//     Level 2 — personal PIN (full access)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the public (non-sensitive) data from a normalised payload.
 * Available immediately with no PIN.
 *
 * @param {Object} payload  - Normalised payload (from normalisePayload)
 * @returns {Object}        - { bloodType, hasAllergies, isDonor, emergencyPhone }
 */
function getPublicData(payload) {
  return payload.public || {};
}

/**
 * Attempt Level-1 access with an emergency override code.
 * Returns decrypted private data (read-only intent) or null.
 *
 * @param {Object} payload       - Normalised payload
 * @param {string} overrideCode  - e.g. "EMR-4K9X-PLMR"
 * @returns {Object|null}
 */
function decryptWithOverride(payload, overrideCode) {
  return decryptData(payload.overrideLocked, overrideCode);
}

/**
 * Attempt Level-2 access with the patient's personal PIN.
 * Returns decrypted private data or null.
 *
 * @param {Object} payload  - Normalised payload
 * @param {string} pin      - 4–6 digit PIN string
 * @returns {Object|null}
 */
function decryptWithPIN(payload, pin) {
  return decryptData(payload.pinLocked, pin);
}


// ─────────────────────────────────────────────────────────────────────────────
//  4. BRUTE-FORCE LOCKOUT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether access is currently locked out.
 * @returns {boolean}
 */
function isLockedOut() {
  const until = localStorage.getItem(LOCKOUT_KEY);
  if (!until) return false;

  if (Date.now() < parseInt(until, 10)) return true;

  // Lockout expired — clean up
  localStorage.removeItem(LOCKOUT_KEY);
  return false;
}

/**
 * Get remaining lockout time in milliseconds.
 * Returns 0 if not locked out.
 * @returns {number}
 */
function getLockoutRemaining() {
  const until = localStorage.getItem(LOCKOUT_KEY);
  if (!until) return 0;
  const rem = parseInt(until, 10) - Date.now();
  return rem > 0 ? rem : 0;
}

/**
 * Trigger a 10-minute lockout.
 */
function triggerLockout() {
  const until = Date.now() + LOCKOUT_MS;
  localStorage.setItem(LOCKOUT_KEY, String(until));
}

/**
 * Clear lockout manually (e.g. for testing).
 */
function clearLockout() {
  localStorage.removeItem(LOCKOUT_KEY);
}

/**
 * Format remaining lockout time as MM:SS string.
 * @param {number} ms
 * @returns {string}  e.g. "09:42"
 */
function formatLockoutTimer(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}


// ─────────────────────────────────────────────────────────────────────────────
//  5. ATTEMPT COUNTER
// ─────────────────────────────────────────────────────────────────────────────

// In-memory attempt counters (reset on page load — intentional,
// the lockout in localStorage persists across reloads)
const _attempts = { pin: 0, override: 0 };

/**
 * Record a failed attempt and return the updated count.
 * Triggers lockout automatically when MAX_ATTEMPTS is reached.
 *
 * @param {'pin'|'override'} type
 * @returns {{ count: number, lockedOut: boolean }}
 */
function recordFailedAttempt(type) {
  _attempts[type] = (_attempts[type] || 0) + 1;

  if (_attempts[type] >= MAX_ATTEMPTS) {
    triggerLockout();
    return { count: _attempts[type], lockedOut: true };
  }

  return { count: _attempts[type], lockedOut: false };
}

/**
 * Get the number of remaining attempts before lockout.
 * @param {'pin'|'override'} type
 * @returns {number}
 */
function getRemainingAttempts(type) {
  return Math.max(0, MAX_ATTEMPTS - (_attempts[type] || 0));
}

/**
 * Reset attempt counters (called after successful unlock or lockout expiry).
 */
function resetAttempts() {
  _attempts.pin      = 0;
  _attempts.override = 0;
}


// ─────────────────────────────────────────────────────────────────────────────
//  6. ACCESS LOGGING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log a successful access event to localStorage.
 * Each log entry records method, timestamp, and device fingerprint.
 * Maximum of 50 entries stored (oldest pruned).
 *
 * @param {'pin'|'override'} method
 */
function logAccess(method) {
  const logs = getAccessLogs();

  logs.push({
    timestamp: new Date().toISOString(),
    method,
    device:    navigator.userAgent.substring(0, 100)
  });

  // Keep only the 50 most recent
  const trimmed = logs.slice(-50);
  localStorage.setItem(ACCESS_LOG_KEY, JSON.stringify(trimmed));
}

/**
 * Retrieve all access logs.
 * @returns {Array<{ timestamp: string, method: string, device: string }>}
 */
function getAccessLogs() {
  try {
    return JSON.parse(localStorage.getItem(ACCESS_LOG_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

/**
 * Clear all access logs (e.g. patient wants to reset audit trail).
 */
function clearAccessLogs() {
  localStorage.removeItem(ACCESS_LOG_KEY);
}


// ─────────────────────────────────────────────────────────────────────────────
//  7. HIGH-LEVEL UNLOCK FLOW
//     Full attempt → log → navigate pipeline used by access.html
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempt to unlock a profile with a PIN.
 * Handles lockout check, decryption, attempt counting, logging, and navigation.
 *
 * @param {Object}   payload     - Normalised payload from normalisePayload()
 * @param {string}   pin         - User-entered PIN
 * @param {Function} onSuccess   - Called with decrypted data on success
 * @param {Function} onFail      - Called with { message, remaining, lockedOut }
 * @param {Function} onLocked    - Called when access is locked out
 */
function attemptPINUnlock(payload, pin, onSuccess, onFail, onLocked) {
  if (isLockedOut()) {
    onLocked(getLockoutRemaining());
    return;
  }

  if (!pin || pin.length < 4) {
    onFail({ message: 'PIN must be at least 4 digits.', remaining: getRemainingAttempts('pin'), lockedOut: false });
    return;
  }

  const result = decryptWithPIN(payload, pin);

  if (result) {
    resetAttempts();
    logAccess('pin');

    // Store for dashboard
    sessionStorage.setItem('decryptedData', JSON.stringify(result));
    sessionStorage.setItem('accessMethod',  'pin');

    onSuccess(result);
  } else {
    const { count, lockedOut } = recordFailedAttempt('pin');
    const remaining = MAX_ATTEMPTS - count;

    if (lockedOut) {
      onLocked(getLockoutRemaining());
    } else {
      onFail({
        message:   `Decryption failed. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
        remaining,
        lockedOut: false
      });
    }
  }
}

/**
 * Attempt to unlock a profile with an emergency override code.
 *
 * @param {Object}   payload     - Normalised payload from normalisePayload()
 * @param {string}   code        - Override code e.g. "EMR-4K9X-PLMR"
 * @param {Function} onSuccess   - Called with decrypted data on success
 * @param {Function} onFail      - Called with { message, remaining, lockedOut }
 * @param {Function} onLocked    - Called when access is locked out
 */
function attemptOverrideUnlock(payload, code, onSuccess, onFail, onLocked) {
  if (isLockedOut()) {
    onLocked(getLockoutRemaining());
    return;
  }

  if (!code || code.length < 10) {
    onFail({ message: 'Enter the complete EMR-XXXX-XXXX override code.', remaining: getRemainingAttempts('override'), lockedOut: false });
    return;
  }

  const result = decryptWithOverride(payload, code);

  if (result) {
    resetAttempts();
    logAccess('override');

    // Store for dashboard — flag as read-only override access
    sessionStorage.setItem('decryptedData', JSON.stringify(result));
    sessionStorage.setItem('accessMethod',  'override');

    onSuccess(result);
  } else {
    const { count, lockedOut } = recordFailedAttempt('override');
    const remaining = MAX_ATTEMPTS - count;

    if (lockedOut) {
      onLocked(getLockoutRemaining());
    } else {
      onFail({
        message:   `Decryption failed. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
        remaining,
        lockedOut: false
      });
    }
  }
}


// ─────────────────────────────────────────────────────────────────────────────
//  8. EXPORTS — expose to access.html global scope
// ─────────────────────────────────────────────────────────────────────────────
window.DecryptModule = {
  // Core
  decryptData,
  decryptWithPIN,
  decryptWithOverride,

  // Payload
  normalisePayload,
  getPublicData,

  // Lockout
  isLockedOut,
  getLockoutRemaining,
  triggerLockout,
  clearLockout,
  formatLockoutTimer,

  // Attempts
  recordFailedAttempt,
  getRemainingAttempts,
  resetAttempts,
  MAX_ATTEMPTS,

  // Logging
  logAccess,
  getAccessLogs,
  clearAccessLogs,

  // High-level flows
  attemptPINUnlock,
  attemptOverrideUnlock
};