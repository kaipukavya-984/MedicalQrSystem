'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  SecureHealth QR — scanner.js
//  Handles: camera init, QR detection, payload parsing, UI state management
// ─────────────────────────────────────────────────────────────────────────────

// ─── State ────────────────────────────────────────────────────────────────────
let html5QrCode  = null;   // Html5Qrcode instance
let scanComplete = false;  // prevents double-processing

// ─── DOM refs (populated on DOMContentLoaded) ─────────────────────────────────
let readerEl, placeholderEl, startBtn, stopBtn, scanLine, vfCorners;
let statusDot, statusText;
let howCard, errorCard, pubCard, accessCard;
let chipBlood, chipAllergy, chipDonor, chipPhone, callBtn;

// ─────────────────────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Grab all DOM references once
  readerEl      = document.getElementById('reader');
  placeholderEl = document.getElementById('placeholder');
  startBtn      = document.getElementById('startBtn');
  stopBtn       = document.getElementById('stopBtn');
  scanLine      = document.getElementById('scanLine');
  vfCorners     = document.getElementById('vfCorners');
  statusDot     = document.getElementById('statusDot');
  statusText    = document.getElementById('statusText');
  howCard       = document.getElementById('howCard');
  errorCard     = document.getElementById('errorCard');
  pubCard       = document.getElementById('pubCard');
  accessCard    = document.getElementById('accessCard');
  chipBlood     = document.getElementById('chipBlood');
  chipAllergy   = document.getElementById('chipAllergy');
  chipDonor     = document.getElementById('chipDonor');
  chipPhone     = document.getElementById('chipPhone');
  callBtn       = document.getElementById('callBtn');

  // Wire up buttons
  startBtn.addEventListener('click', startScanner);
  stopBtn.addEventListener('click',  stopScanner);

  document.getElementById('fileInput')
    .addEventListener('change', scanFromFile);

  document.getElementById('uploadBtn')
    .addEventListener('click', () => document.getElementById('fileInput').click());

  document.getElementById('btnPin')
    .addEventListener('click', () => goToAccess('pin'));

  document.getElementById('btnOverride')
    .addEventListener('click', () => goToAccess('override'));

  // Auto-demo mode via URL param: scanner.html?demo=1
  if (new URLSearchParams(window.location.search).get('demo') === '1') {
    setTimeout(loadDemo, 400);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  CAMERA — START
// ─────────────────────────────────────────────────────────────────────────────
function startScanner() {
  if (!window.Html5Qrcode) {
    setStatus('error', 'Scanner library not loaded');
    showError('The scanner library failed to load. Please refresh the page.');
    return;
  }

  // Show camera area
  placeholderEl.style.display = 'none';
  readerEl.style.display      = 'block';
  startBtn.classList.add('hidden');
  stopBtn.classList.add('visible');

  setStatus('active', 'Scanning for QR code...');
  scanLine.classList.add('active');

  html5QrCode = new Html5Qrcode('reader');

  const config = {
    fps:         10,
    qrbox:       { width: 220, height: 220 },
    aspectRatio: 1.0
  };

  html5QrCode
    .start({ facingMode: 'environment' }, config, onScanSuccess, onScanFrameError)
    .catch(handleCameraError);
}

// ─────────────────────────────────────────────────────────────────────────────
//  CAMERA — STOP
// ─────────────────────────────────────────────────────────────────────────────
function stopScanner() {
  if (html5QrCode) {
    html5QrCode.stop().catch(() => {});
    html5QrCode = null;
  }

  placeholderEl.style.display = 'flex';
  readerEl.style.display      = 'none';
  startBtn.classList.remove('hidden');
  stopBtn.classList.remove('visible');
  scanLine.classList.remove('active');

  if (!scanComplete) setStatus('', 'Camera stopped');
}

// ─────────────────────────────────────────────────────────────────────────────
//  CAMERA — ERROR HANDLER
// ─────────────────────────────────────────────────────────────────────────────
function handleCameraError(err) {
  console.error('Camera error:', err);

  setStatus('error', 'Camera unavailable');
  showError(
    'Camera access was denied or is unavailable.<br/>' +
    '• On mobile: allow camera in browser settings<br/>' +
    '• On desktop: use Live Server (not file://)<br/>' +
    '• Or use <strong>Upload QR Image</strong> below'
  );

  placeholderEl.style.display = 'flex';
  readerEl.style.display      = 'none';
  startBtn.classList.remove('hidden');
  stopBtn.classList.remove('visible');
  scanLine.classList.remove('active');
}

// ─────────────────────────────────────────────────────────────────────────────
//  SCAN — SUCCESS CALLBACK
// ─────────────────────────────────────────────────────────────────────────────
function onScanSuccess(decodedText) {
  if (scanComplete) return;   // ignore duplicate frames
  scanComplete = true;

  // Stop camera
  if (html5QrCode) {
    html5QrCode.stop().catch(() => {});
  }

  // Update UI to success state
  scanLine.classList.remove('active');
  scanLine.classList.add('success');
  vfCorners.classList.add('success');
  stopBtn.classList.remove('visible');

  setStatus('success', '✓ QR scanned successfully!');

  // Parse and process
  try {
    const payload = JSON.parse(decodedText);
    processPayload(payload);
  } catch (e) {
    setStatus('error', 'Invalid QR code');
    showError('This QR code could not be read.<br/>Make sure it is a valid SecureHealth QR.');
    scanComplete = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SCAN — PER-FRAME ERROR (suppress — fires on every frame with no QR)
// ─────────────────────────────────────────────────────────────────────────────
function onScanFrameError() { /* intentionally empty */ }

// ─────────────────────────────────────────────────────────────────────────────
//  SCAN FROM UPLOADED IMAGE FILE
// ─────────────────────────────────────────────────────────────────────────────
function scanFromFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  setStatus('active', 'Reading image...');
  placeholderEl.style.display = 'none';
  readerEl.style.display      = 'block';

  // Create a temporary scanner instance for file scanning
  const fileScanner = new Html5Qrcode('reader');

  fileScanner
    .scanFile(file, /* showImage= */ false)
    .then(decodedText => {
      fileScanner.clear();
      placeholderEl.style.display = 'flex';
      readerEl.style.display      = 'none';
      onScanSuccess(decodedText);
    })
    .catch(err => {
      console.error('File scan error:', err);
      fileScanner.clear();
      placeholderEl.style.display = 'flex';
      readerEl.style.display      = 'none';
      setStatus('error', 'Could not read QR from image');
      showError(
        'No QR code found in the uploaded image.<br/>' +
        'Make sure the image is clear, well-lit, and not cropped.'
      );
    });

  // Reset file input so same file can be re-uploaded
  event.target.value = '';
}

// ─────────────────────────────────────────────────────────────────────────────
//  PAYLOAD PROCESSING
// ─────────────────────────────────────────────────────────────────────────────
function processPayload(payload) {

  // ── Handle local-mode QR (short ID → localStorage) ──
  if (payload.local === true && payload.id) {
    const stored = localStorage.getItem(payload.id);
    if (stored) {
      try {
        payload = JSON.parse(stored);
      } catch (e) {
        showError('Local QR data is corrupted. Patient may need to regenerate their QR.');
        scanComplete = false;
        return;
      }
    } else {
      showError(
        'QR references local data that is no longer available on this device.<br/>' +
        'Patient needs to regenerate their QR code.'
      );
      scanComplete = false;
      return;
    }
  }

  // ── Validate SecureHealth QR ──
  const version = payload.v || payload.version;
  if (!version) {
    showError('This is not a valid SecureHealth QR code.');
    scanComplete = false;
    return;
  }

  // ── Extract public data ──
  // Supports compact format (p.b, p.a, p.d, p.e) and legacy format (public.bloodType ...)
  const pub        = payload.p || payload.public || {};
  const bloodType  = pub.b  ?? pub.bloodType      ?? 'Unknown';
  const hasAllergy = pub.a  != null ? !!pub.a : !!(pub.hasAllergies);
  const isDonor    = pub.d  != null ? !!pub.d : !!(pub.isDonor);
  const phone      = pub.e  ?? pub.emergencyPhone  ?? null;

  // ── Render public chips ──
  chipBlood.textContent   = bloodType;
  chipAllergy.textContent = hasAllergy ? 'YES — PIN for full details' : 'None reported';
  chipDonor.textContent   = isDonor    ? 'YES'                        : 'No';
  chipPhone.textContent   = phone      || '—';

  // ── Call button ──
  if (phone) {
    callBtn.href        = 'tel:' + phone;
    callBtn.textContent = '📞 Call ' + phone;
    callBtn.style.display = 'flex';
  } else {
    callBtn.style.display = 'none';
  }

  // ── Show result cards, hide how-to ──
  if (howCard)    howCard.style.display = 'none';
  if (errorCard)  errorCard.classList.remove('visible');
  if (pubCard)    pubCard.classList.add('visible');
  if (accessCard) accessCard.classList.add('visible');

  // ── Save payload to sessionStorage for access.html ──
  sessionStorage.setItem('scannedPayload', JSON.stringify(payload));
}

// ─────────────────────────────────────────────────────────────────────────────
//  NAVIGATION — go to access.html with chosen method
// ─────────────────────────────────────────────────────────────────────────────
function goToAccess(type) {
  sessionStorage.setItem('accessType', type);
  window.location.href = 'access.html';
}

// ─────────────────────────────────────────────────────────────────────────────
//  DEMO MODE — load sample patient data without camera
// ─────────────────────────────────────────────────────────────────────────────
function loadDemo() {
  const demoPayload = {
    v:  '1',
    p:  { b: 'O−', a: 1, d: 1, e: '9876543210' },
    pk: 'DEMO_PIN_ENCRYPTED',
    ok: 'DEMO_OVERRIDE_ENCRYPTED'
  };

  const demoPrivate = {
    name:       'Ravi Kumar',
    dob:        '1985-01-12',
    gender:     'Male',
    allergies:  ['Penicillin', 'Peanuts'],
    medications:['Metformin 500mg'],
    conditions: ['Type 2 Diabetes'],
    emergencyContact: {
      name:     'Priya Kumar',
      phone:    '9876543210',
      relation: 'Spouse'
    },
    organDonation: {
      isDonor: true,
      organs:  ['Kidney', 'Corneas']
    }
  };

  // Pre-store decrypted data so dashboard works in demo mode
  sessionStorage.setItem('decryptedData',  JSON.stringify(demoPrivate));
  sessionStorage.setItem('scannedPayload', JSON.stringify(demoPayload));

  processPayload(demoPayload);
  setStatus('success', 'Demo data loaded');
}

// ─────────────────────────────────────────────────────────────────────────────
//  UI HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the status indicator dot + text
 * @param {'active'|'success'|'error'|''} type
 * @param {string} text
 */
function setStatus(type, text) {
  statusDot.className  = 'status-dot'  + (type ? ' ' + type : '');
  statusText.className = 'status-text' + (type ? ' ' + type : '');
  statusText.textContent = text;
}

/**
 * Show the error card with an HTML message
 * @param {string} html
 */
function showError(html) {
  if (!errorCard) return;
  errorCard.innerHTML = '⚠️ ' + html;
  errorCard.classList.add('visible');
  if (howCard) howCard.style.display = 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXPOSE globals scanner.html inline onclick handlers might need
// ─────────────────────────────────────────────────────────────────────────────
window.startScanner = startScanner;
window.stopScanner  = stopScanner;
window.loadDemo     = loadDemo;