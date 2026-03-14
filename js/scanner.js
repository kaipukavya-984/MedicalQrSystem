'use strict';

// ─────────────────────────────────────────────
// SecureHealth QR — scanner.js (REVISED)
// Fixes:
// 1. Camera start issues
// 2. Upload QR image issues
// 3. Reset scanner state
// 4. Works on desktop + mobile
// ─────────────────────────────────────────────

// ─── STATE ───────────────────────────────────
let html5QrCode = null;
let scanComplete = false;

// ─── DOM REFERENCES ──────────────────────────
let readerEl, placeholderEl, startBtn, stopBtn, scanLine, vfCorners;
let statusDot, statusText;
let howCard, errorCard, pubCard, accessCard;
let chipBlood, chipAllergy, chipDonor, chipPhone, callBtn;

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

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

startBtn.addEventListener('click', startScanner);
stopBtn.addEventListener('click', stopScanner);

document.getElementById('uploadBtn')
.addEventListener('click', () => {
document.getElementById('fileInput').click();
});

document.getElementById('fileInput')
.addEventListener('change', scanFromFile);

document.getElementById('btnPin')
.addEventListener('click', () => goToAccess('pin'));

document.getElementById('btnOverride')
.addEventListener('click', () => goToAccess('override'));

});

// ─────────────────────────────────────────────
// START CAMERA
// ─────────────────────────────────────────────
async function startScanner() {

if (!window.Html5Qrcode) {
showError("QR scanner library failed to load.");
return;
}

try {

```
scanComplete = false;

placeholderEl.style.display = "none";
readerEl.style.display = "block";

startBtn.classList.add("hidden");
stopBtn.classList.add("visible");

scanLine.classList.add("active");

setStatus("active", "Starting camera...");

html5QrCode = new Html5Qrcode("reader");

const cameras = await Html5Qrcode.getCameras();

if (!cameras || cameras.length === 0) {
  throw new Error("No cameras found");
}

const cameraId = cameras[0].id;

await html5QrCode.start(
  cameraId,
  {
    fps: 10,
    qrbox: 250
  },
  onScanSuccess
);

setStatus("active", "Scanning for QR code...");
```

} catch (err) {
handleCameraError(err);
}

}

// ─────────────────────────────────────────────
// STOP CAMERA
// ─────────────────────────────────────────────
function stopScanner() {

if (!html5QrCode) return;

html5QrCode.stop()
.then(() => {
html5QrCode.clear();
html5QrCode = null;
})
.catch(() => {});

readerEl.style.display = "none";
placeholderEl.style.display = "flex";

scanLine.classList.remove("active");

startBtn.classList.remove("hidden");
stopBtn.classList.remove("visible");

setStatus("", "Camera stopped");

}

// ─────────────────────────────────────────────
// CAMERA ERROR
// ─────────────────────────────────────────────
function handleCameraError(err) {

console.error(err);

setStatus("error", "Camera unavailable");

showError(
"Camera access failed.<br><br>" +
"Possible reasons:<br>" +
"• You opened the page using file://<br>" +
"• Browser camera permission blocked<br><br>" +
"✔ Use Live Server extension in VS Code"
);

readerEl.style.display = "none";
placeholderEl.style.display = "flex";

}

// ─────────────────────────────────────────────
// QR SUCCESS
// ─────────────────────────────────────────────
function onScanSuccess(decodedText) {

if (scanComplete) return;

scanComplete = true;

stopScanner();

scanLine.classList.remove("active");
vfCorners.classList.add("success");

setStatus("success", "QR Code Detected");

try {

```
const payload = JSON.parse(decodedText);

processPayload(payload);
```

} catch {

```
showError("Invalid QR code detected.");
scanComplete = false;
```

}

}

// ─────────────────────────────────────────────
// SCAN FROM IMAGE FILE
// ─────────────────────────────────────────────
function scanFromFile(event) {

const file = event.target.files[0];

if (!file) return;

const fileScanner = new Html5Qrcode("reader");

setStatus("active", "Scanning image...");

fileScanner.scanFile(file, true)

```
.then(decodedText => {

  onScanSuccess(decodedText);

})

.catch(() => {

  showError("No QR code found in the image.");

});
```

event.target.value = "";

}

// ─────────────────────────────────────────────
// PROCESS QR DATA
// ─────────────────────────────────────────────
function processPayload(payload) {

const pub = payload.p || payload.public || {};

const bloodType  = pub.b ?? pub.bloodType ?? "Unknown";
const allergy    = pub.a ? "YES — PIN needed" : "None";
const donor      = pub.d ? "YES" : "No";
const phone      = pub.e ?? null;

chipBlood.textContent   = bloodType;
chipAllergy.textContent = allergy;
chipDonor.textContent   = donor;
chipPhone.textContent   = phone || "—";

if (phone) {
callBtn.href = "tel:" + phone;
callBtn.textContent = "📞 Call " + phone;
}

howCard.style.display = "none";

pubCard.classList.add("visible");
accessCard.classList.add("visible");

sessionStorage.setItem(
"scannedPayload",
JSON.stringify(payload)
);

}

// ─────────────────────────────────────────────
// ACCESS NAVIGATION
// ─────────────────────────────────────────────
function goToAccess(type) {

sessionStorage.setItem("accessType", type);

window.location.href = "access.html";

}

// ─────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────
function setStatus(type, text) {

statusDot.className = "status-dot " + type;
statusText.className = "status-text " + type;
statusText.textContent = text;

}

function showError(html) {

errorCard.innerHTML = "⚠️ " + html;
errorCard.classList.add("visible");

}
