/* Google Sheet backend (temporary shared database).
   SHEET_URL is the Apps Script web app URL. SHEET_SECRET must match the
   SECRET line in the Apps Script (sheet-setup/Code.gs).
   This file is public, so the secret only stops casual writes. It is not real security.
   Set SHEET_URL to "" to go back to browser-only storage. */
const SHEET_URL = "https://script.google.com/macros/s/AKfycbxr3e86ryE7HzVSr4cqcUdvuErhWYpNEwOM5_txLx_fhkGPIUKPjttn4sZpsmI2fjyd/exec";
const SHEET_SECRET = "bwmb-m4Rk7qX2vL9p";
