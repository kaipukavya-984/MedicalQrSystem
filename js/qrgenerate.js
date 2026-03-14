'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  SecureHealth QR — qrgenerate.js
//  Handles: payload loading, QR rendering (Qrious), override code reveal,
//           copy/share, download, print, session cleanup
//
//  Depends on:
//    - Qrious 4.0.2  (loaded via CDN in generate.html)
//    - sessionStorage keys: 'qrPayload', 'overrideCode'
// ─────────────────────────────────────────────────────────────────────────────

// ─── State ────────────────────────────────────────────────────────────────────
let overrideCode = '';    // the EMR-XXXX-XXXX string
let qrPayload    = null;  // compact payload object stored in QR
let isRevealed   = false; // toggle state for override code blur

// ─── DOM refs ─────────────────────────────────────────────────────────────────
let codeTextEl, revealBtn, copyBtn, shareBtn;
let qrCanvas, qrStatus;
let pubChipsEl;

// ─────────────────────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Grab DOM refs
  codeTextEl = document.getElementById('codeText');
  revealBtn  = document.getElementById('revealBtn');
  copyBtn    = document.getElementById('copyBtn');
  shareBtn   = document.getElementById('shareBtn');
  qrCanvas   = document.getElementById('qrCanvas');
  qrStatus   = document.getElementById('qrStatus');
  pubChipsEl = document.getElementById('pubChips');

  // Wire buttons
  revealBtn.addEventListener('click', toggleReveal);
  copyBtn.addEventListener('click',   copyCode);
  shareBtn.addEventListener('click',  shareCode);

  document.getElementById('btnDownload')
    .addEventListener('click', downloadQR);

  document.getElementById('btnPrint')
    .addEventListener('click', printQR);

  document.getElementById('btnDone')
    .addEventListener('click', clearSession);

  // Load data and render
  loadData();
});

// ─────────────────────────────────────────────────────────────────────────────
//  LOAD DATA FROM SESSION STORAGE
// ─────────────────────────────────────────────────────────────────────────────
function loadData() {
  const rawPayload  = sessionStorage.getItem('qrPayload');
  const rawOverride = sessionStorage.getItem('overrideCode');

  if (!rawPayload || !rawOverride) {
    loadDemoData();
    return;
  }

  const full   = JSON.parse(rawPayload);
  overrideCode = rawOverride;

  // Build compact payload — short key names reduce QR data size
  const pub = full.public || {};
  qrPayload = {
    v:  '1',
    p: {
      b: pub.bloodType      || '',
      a: pub.hasAllergies   ? 1 : 0,
      d: pub.isDonor        ? 1 : 0,
      e: pub.emergencyPhone || ''
    },
    pk: full.pinLocked      || '',
    ok: full.overrideLocked || ''
  };

  renderPage();
}

// ─────────────────────────────────────────────────────────────────────────────
//  DEMO DATA
// ─────────────────────────────────────────────────────────────────────────────
function loadDemoData() {
  overrideCode = 'EMR-4K9X-PLMR';
  qrPayload    = {
    v:  '1',
    p:  { b: 'O−', a: 1, d: 1, e: '9876543210' },
    pk: 'DEMO_PIN_ENCRYPTED_DATA',
    ok: 'DEMO_OVERRIDE_ENCRYPTED_DATA'
  };

  const banner = document.createElement('div');
  banner.style.cssText = [
    'background:rgba(244,162,97,0.09)',
    'border:1px solid rgba(244,162,97,0.28)',
    'border-radius:9px',
    'padding:9px 16px',
    'font-size:0.74rem',
    'color:#b36a2a',
    'margin:10px 36px -10px',
    'position:relative',
    'z-index:2'
  ].join(';');
  banner.textContent = '🎭 Demo mode — sample data shown';

  const main = document.querySelector('main');
  if (main) main.insertAdjacentElement('beforebegin', banner);

  renderPage();
}

// ─────────────────────────────────────────────────────────────────────────────
//  RENDER PAGE
// ─────────────────────────────────────────────────────────────────────────────
function renderPage() {
  renderOverrideCode();
  renderPublicChips();
  renderQR();
}

function renderOverrideCode() {
  codeTextEl.textContent = overrideCode;
  codeTextEl.classList.remove('revealed');
  copyBtn.disabled  = true;
  shareBtn.disabled = true;
}

function renderPublicChips() {
  const p          = qrPayload.p || {};
  const bloodType  = p.b || 'Unknown';
  const hasAllergy = !!p.a;
  const isDonor    = !!p.d;
  const phone      = p.e || '—';

  pubChipsEl.innerHTML = `
    <div class="chip chip-blood">🩸 ${bloodType}</div>
    <div class="chip chip-allergy">${hasAllergy ? '⚠️ Has Allergies' : '✅ No Allergies'}</div>
    <div class="chip chip-donor">${isDonor ? '💚 Organ Donor' : '❌ Not a Donor'}</div>
    <div class="chip chip-phone">📞 ${phone}</div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
//  QR GENERATION — Qrious draws directly onto <canvas id="qrCanvas">
// ─────────────────────────────────────────────────────────────────────────────
function renderQR() {
  if (typeof QRious === 'undefined') {
    setQrStatus('err', '⚠️ QR library not loaded — check internet connection');
    return;
  }

  const qrText = JSON.stringify(qrPayload);
  const kb     = (new Blob([qrText]).size / 1024).toFixed(1);

  try {
    drawQR(qrCanvas, qrText, 240);
    setQrStatus('ok', `✓ QR ready · ${kb} KB · AES-256 encrypted`);
  } catch (err) {
    console.warn('Direct QR encode failed, using fallback:', err.message);
    renderQRFallback(kb);
  }
}

function drawQR(canvas, text, size) {
  new QRious({
    element:    canvas,
    value:      text,
    size:       size,
    foreground: '#0d1b2a',
    background: '#ffffff',
    level:      'L',
    padding:    8
  });
}

function renderQRFallback(kb) {
  // Store full payload in localStorage, encode only short ID in QR
  const id        = 'shqr_' + Date.now().toString(36);
  localStorage.setItem(id, JSON.stringify(qrPayload));

  const shortText = JSON.stringify({ v: '1', id, local: true });

  try {
    drawQR(qrCanvas, shortText, 240);
    setQrStatus('ok', '✓ QR ready (local mode) · AES-256 encrypted');
  } catch (err2) {
    setQrStatus('err', '⚠️ QR generation failed: ' + err2.message);
    console.error('QR fallback also failed:', err2);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  OVERRIDE CODE — REVEAL / HIDE
// ─────────────────────────────────────────────────────────────────────────────
function toggleReveal() {
  isRevealed = !isRevealed;

  codeTextEl.classList.toggle('revealed', isRevealed);
  revealBtn.textContent = isRevealed ? '🙈 Hide' : '👁 Reveal';
  copyBtn.disabled      = !isRevealed;
  shareBtn.disabled     = !isRevealed;
}

// ─────────────────────────────────────────────────────────────────────────────
//  COPY OVERRIDE CODE
// ─────────────────────────────────────────────────────────────────────────────
function copyCode() {
  if (!overrideCode) return;

  const original  = copyBtn.textContent;
  const onSuccess = () => {
    copyBtn.textContent = '✅ Copied!';
    setTimeout(() => { copyBtn.textContent = original; }, 2200);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(overrideCode)
      .then(onSuccess)
      .catch(() => execCommandCopy(onSuccess));
  } else {
    execCommandCopy(onSuccess);
  }
}

function execCommandCopy(onSuccess) {
  const ta       = document.createElement('textarea');
  ta.value       = overrideCode;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try   { document.execCommand('copy'); onSuccess(); }
  catch (e) { console.error('execCommand copy failed:', e); }
  document.body.removeChild(ta);
}

// ─────────────────────────────────────────────────────────────────────────────
//  SHARE OVERRIDE CODE
// ─────────────────────────────────────────────────────────────────────────────
function shareCode() {
  if (!overrideCode) return;

  if (navigator.share) {
    navigator.share({
      title: 'SecureHealth QR — Emergency Override Code',
      text:  `My emergency health override code: ${overrideCode}\n\nUse this with SecureHealth QR to access my medical profile in an emergency.`
    }).catch(err => {
      if (err.name !== 'AbortError') copyCode();
    });
  } else {
    copyCode(); // fallback
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  DOWNLOAD QR AS PNG
// ─────────────────────────────────────────────────────────────────────────────
function downloadQR() {
  if (!qrCanvas || !qrCanvas.width) {
    alert('QR not ready yet.');
    return;
  }

  const pad    = 20;
  const out    = document.createElement('canvas');
  out.width    = qrCanvas.width  + pad * 2;
  out.height   = qrCanvas.height + pad * 2;
  const ctx    = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(qrCanvas, pad, pad);

  const link    = document.createElement('a');
  link.download = 'SecureHealthQR.png';
  link.href     = out.toDataURL('image/png');
  link.click();
}

// ─────────────────────────────────────────────────────────────────────────────
//  PRINT QR
// ─────────────────────────────────────────────────────────────────────────────
function printQR() {
  if (!qrCanvas) return;

  const dataUrl = qrCanvas.toDataURL('image/png');
  const p       = qrPayload?.p || {};

  const win = window.open('', '_blank');
  if (!win) { alert('Allow popups to use the print feature.'); return; }

  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>SecureHealth QR — Print</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: sans-serif;
      display: flex; flex-direction: column; align-items: center;
      padding: 48px 32px; background: #fff;
    }
    .logo  { font-size: 1.4rem; font-weight: 700; margin-bottom: 6px; }
    .sub   { color: #666; font-size: 0.78rem; margin-bottom: 28px; text-align: center; }
    img    { width: 200px; height: 200px; border: 1px solid #e0e4ea; border-radius: 8px; }
    .meta  {
      margin-top: 20px; font-size: 0.75rem; color: #333;
      text-align: center; line-height: 2;
      border-top: 1px solid #eee; padding-top: 16px;
      width: 100%; max-width: 280px;
    }
    .meta strong { color: #0d1b2a; }
    .foot { margin-top: 16px; font-size: 0.6rem; color: #aaa; text-align: center; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="logo">🏥 SecureHealth QR</div>
  <div class="sub">
    Scan for emergency medical access<br/>
    PIN required for full profile
  </div>
  <img src="${dataUrl}" alt="SecureHealth QR Code"/>
  <div class="meta">
    Blood Type: <strong>${p.b || '—'}</strong><br/>
    Allergies: <strong>${p.a ? 'Yes — ask for details' : 'None reported'}</strong><br/>
    Organ Donor: <strong>${p.d ? 'Yes' : 'No'}</strong><br/>
    Emergency Contact: <strong>${p.e || '—'}</strong>
  </div>
  <div class="foot">
    AES-256 Encrypted · SecureHealth QR · All private data requires PIN or Override Code
  </div>
  <script>window.onload = function () { window.print(); }<\/script>
</body>
</html>`);

  win.document.close();
}

// ─────────────────────────────────────────────────────────────────────────────
//  CLEAR SESSION ON DONE
// ─────────────────────────────────────────────────────────────────────────────
function clearSession() {
  sessionStorage.removeItem('overrideCode');
  sessionStorage.removeItem('qrPayload');
  // Navigation happens via href on the done button in HTML
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXPOSE globals (safety net for any inline onclick in generate.html)
// ─────────────────────────────────────────────────────────────────────────────
window.toggleReveal = toggleReveal;
window.copyCode     = copyCode;
window.shareCode    = shareCode;
window.downloadQR   = downloadQR;
window.printQR      = printQR;
window.clearSession = clearSession;