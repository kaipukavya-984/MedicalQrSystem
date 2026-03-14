'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  SecureHealth QR — ai.js
//  Handles: Claude API calls for emergency summary, drug-allergy safety check,
//           and organ donation protocol guidance
//
//  Depends on:
//    - Anthropic Claude API  (fetch — no SDK needed)
//    - dashboard.html        (DOM structure)
//
//  API endpoint: https://api.anthropic.com/v1/messages
//  Model:        claude-sonnet-4-20250514
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL   = 'claude-sonnet-4-20250514';
const MAX_TOKENS     = 1000;


// ─────────────────────────────────────────────────────────────────────────────
//  1. LOW-LEVEL API CALLER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a single-turn message to the Claude API and return the text response.
 * Throws on network failure or non-200 status.
 *
 * @param {string} systemPrompt   - System instruction for Claude
 * @param {string} userMessage    - User message content
 * @returns {Promise<string>}     - Claude's text response
 */
async function callClaude(systemPrompt, userMessage) {
  const response = await fetch(CLAUDE_API_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }]
    })
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Extract text from content blocks
  const text = (data.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();

  if (!text) throw new Error('Claude returned an empty response.');

  return text;
}


// ─────────────────────────────────────────────────────────────────────────────
//  2. EMERGENCY SUMMARY GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a concise 4-line emergency medical summary from patient data.
 * Designed to be read by a doctor in under 10 seconds.
 *
 * @param {Object} patientData   - Decrypted private patient record
 * @returns {Promise<string>}    - Formatted summary text
 */
async function generateEmergencySummary(patientData) {
  const systemPrompt = `You are an emergency medical assistant generating a patient summary for a doctor.
Respond in EXACTLY this 4-line format with no extra text, headers, or bullets:

Line 1: [Full name], [age]yo [gender], Blood Type [X]
Line 2: ⚠️ Allergies: [comma list] — OR — ✅ No known allergies
Line 3: Conditions: [list] | Medications: [list] — OR — None for either
Line 4: Organ donor: [consented organs or "No"] | Emergency: [contact name] [phone]

Rules:
- Keep each line under 80 characters
- ⚠️ prefix on Line 2 only if allergies exist
- If no conditions or medications write "None" not blank
- Be factual, clinical, and scannable — this is a medical emergency`;

  // Calculate age from DOB
  const age = patientData.dob
    ? Math.floor((Date.now() - new Date(patientData.dob)) / 31557600000)
    : '?';

  const userMessage = JSON.stringify({
    name:        patientData.name       || 'Unknown',
    age,
    gender:      patientData.gender     || 'Unknown',
    bloodType:   patientData.bloodType  || 'Unknown',
    allergies:   patientData.allergies  || [],
    medications: patientData.medications|| [],
    conditions:  patientData.conditions || [],
    organDonation: patientData.organDonation || { isDonor: false, organs: [] },
    emergencyContact: patientData.emergencyContact || {}
  });

  return callClaude(systemPrompt, userMessage);
}


// ─────────────────────────────────────────────────────────────────────────────
//  3. DRUG-ALLERGY SAFETY CHECKER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether a proposed medication is safe given the patient's
 * known allergies and current medications.
 *
 * @param {Object} patientData    - Decrypted private patient record
 * @param {string} proposedDrug   - Medication name entered by doctor
 * @returns {Promise<string>}     - Response in STATUS / REASON format
 */
async function checkDrugSafety(patientData, proposedDrug) {
  const systemPrompt = `You are a clinical drug safety checker.
Given a patient's allergy list and current medications, assess whether a proposed medication is safe.

Respond in EXACTLY this format — no extra text:
STATUS: SAFE
REASON: [one sentence, under 20 words]

Or:
STATUS: WARNING
REASON: [one sentence, under 20 words]

Or:
STATUS: DANGER
REASON: [one sentence, under 20 words]

Rules:
- DANGER: direct allergy match or severe known interaction
- WARNING: same drug class as allergen, or moderate interaction risk
- SAFE: no known allergy or interaction concern
- Be medically accurate and concise`;

  const userMessage = [
    `Patient allergies: ${(patientData.allergies || []).join(', ') || 'None'}`,
    `Current medications: ${(patientData.medications || []).join(', ') || 'None'}`,
    `Proposed medication: ${proposedDrug}`
  ].join('\n');

  return callClaude(systemPrompt, userMessage);
}


// ─────────────────────────────────────────────────────────────────────────────
//  4. ORGAN DONATION PROTOCOL GUIDE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provide immediate procedural guidance based on patient's organ donation consent.
 *
 * @param {Object} organDonation  - { isDonor: boolean, organs: string[] }
 * @returns {Promise<string>}     - Step-by-step guidance text
 */
async function getOrganDonationGuidance(organDonation) {
  const systemPrompt = `You are an organ donation protocol assistant in a hospital emergency.
Given a patient's organ donation consent, provide clear immediate steps for the medical team.
Keep response under 80 words. Be specific, procedural, and compassionate.
If patient is not a donor, state this clearly and briefly.`;

  const userMessage = JSON.stringify({
    isDonor:        organDonation?.isDonor  || false,
    consentedOrgans: organDonation?.organs || []
  });

  return callClaude(systemPrompt, userMessage);
}


// ─────────────────────────────────────────────────────────────────────────────
//  5. FALLBACK SUMMARIES (offline / API unavailable)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a plain-text emergency summary without the API.
 * Used when Claude API is unavailable (no internet, etc.)
 *
 * @param {Object} patientData
 * @returns {string}
 */
function generateFallbackSummary(patientData) {
  const age = patientData.dob
    ? Math.floor((Date.now() - new Date(patientData.dob)) / 31557600000)
    : '?';

  const allergies   = (patientData.allergies   || []).join(', ') || 'None';
  const medications = (patientData.medications || []).join(', ') || 'None';
  const conditions  = (patientData.conditions  || []).join(', ') || 'None';
  const ec          = patientData.emergencyContact || {};
  const donation    = patientData.organDonation   || {};
  const organs      = (donation.organs || []).join(', ') || 'None';

  return [
    `${patientData.name || 'Unknown'}, ${age}yo ${patientData.gender || ''}. Blood Type: ${patientData.bloodType || 'Unknown'}.`,
    allergies !== 'None' ? `⚠️ Allergies: ${allergies}.` : '✅ No known allergies.',
    `Conditions: ${conditions}. Medications: ${medications}.`,
    `Organ donor: ${donation.isDonor ? organs : 'No'}. Emergency: ${ec.name || '—'} ${ec.phone || ''}.`
  ].join('\n');
}

/**
 * Generate a drug safety result without the API.
 * Returns a generic warning to manually verify.
 *
 * @param {Object} patientData
 * @param {string} proposedDrug
 * @returns {string}
 */
function generateFallbackDrugCheck(patientData, proposedDrug) {
  const allergies = (patientData.allergies || []).map(a => a.toLowerCase());
  const drug      = (proposedDrug || '').toLowerCase();

  // Very basic check — exact match only
  const directMatch = allergies.some(a => drug.includes(a) || a.includes(drug));

  if (directMatch) {
    return `STATUS: DANGER\nREASON: Exact match found between "${proposedDrug}" and patient's known allergies.`;
  }

  return `STATUS: WARNING\nREASON: AI unavailable — verify manually against allergies: ${(patientData.allergies || []).join(', ') || 'None'}.`;
}


// ─────────────────────────────────────────────────────────────────────────────
//  6. DASHBOARD UI INTEGRATION
//     High-level functions called directly by dashboard.html
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load and display the AI emergency summary in the dashboard.
 * Shows a loading state, then populates the summary box.
 * Falls back to local summary if API fails.
 *
 * @param {Object} patientData   - Decrypted patient data
 */
async function loadEmergencySummary(patientData) {
  const loadingEl = document.getElementById('aiLoading');
  const textEl    = document.getElementById('aiText');
  const errorEl   = document.getElementById('aiError');

  if (!loadingEl || !textEl) return;

  // Show loading state
  loadingEl.style.display = 'flex';
  textEl.classList.remove('visible');
  if (errorEl) errorEl.classList.remove('visible');

  try {
    const summary = await generateEmergencySummary(patientData);

    loadingEl.style.display = 'none';
    textEl.textContent = summary;
    textEl.classList.add('visible');

    // Store for copy-to-clipboard
    window._aiSummary = summary;

  } catch (err) {
    console.warn('[ai.js] Claude API unavailable, using fallback:', err.message);

    loadingEl.style.display = 'none';
    if (errorEl) errorEl.classList.add('visible');

    // Show local fallback
    const fallback = generateFallbackSummary(patientData);
    textEl.textContent = fallback;
    textEl.classList.add('visible');
    window._aiSummary = fallback;
  }
}

/**
 * Run a drug safety check and display the result in the dashboard.
 * Called when doctor enters a medication name and clicks Check.
 *
 * @param {Object} patientData    - Decrypted patient data
 * @param {string} medication     - Drug name to check
 */
async function runDrugSafetyCheck(patientData, medication) {
  const resultEl  = document.getElementById('drugResult');
  const spinner   = document.getElementById('drugSpinner');
  const btnText   = document.getElementById('drugBtnText');

  if (!resultEl) return;

  // Show loading
  if (spinner)  spinner.style.display = 'block';
  if (btnText)  btnText.textContent   = '...';
  resultEl.className = 'drug-result';

  let result;

  try {
    result = await checkDrugSafety(patientData, medication);
  } catch (err) {
    console.warn('[ai.js] Drug check API failed, using fallback:', err.message);
    result = generateFallbackDrugCheck(patientData, medication);
  }

  // Hide loading
  if (spinner)  spinner.style.display = 'none';
  if (btnText)  btnText.textContent   = 'Check';

  // Determine colour class
  let cls = 'safe';
  if (result.includes('DANGER'))  cls = 'danger';
  else if (result.includes('WARNING')) cls = 'warning';

  resultEl.className   = 'drug-result visible ' + cls;
  resultEl.textContent = result;
}

/**
 * Load and display organ donation guidance in the dashboard.
 *
 * @param {Object} organDonation  - { isDonor, organs }
 */
async function loadOrganGuidance(organDonation) {
  const el = document.getElementById('organGuidance');
  if (!el) return;

  el.textContent = 'Loading guidance...';

  try {
    const guidance = await getOrganDonationGuidance(organDonation);
    el.textContent = guidance;
  } catch (err) {
    el.textContent = organDonation?.isDonor
      ? `Patient has consented to donate: ${(organDonation.organs || []).join(', ')}. Notify transplant coordinator immediately.`
      : 'Patient has not consented to organ donation.';
  }
}


// ─────────────────────────────────────────────────────────────────────────────
//  7. EXPORTS — expose to dashboard.html global scope
// ─────────────────────────────────────────────────────────────────────────────
window.AIModule = {
  // Core API
  callClaude,

  // Feature functions
  generateEmergencySummary,
  checkDrugSafety,
  getOrganDonationGuidance,

  // Fallbacks
  generateFallbackSummary,
  generateFallbackDrugCheck,

  // Dashboard integration
  loadEmergencySummary,
  runDrugSafetyCheck,
  loadOrganGuidance
};