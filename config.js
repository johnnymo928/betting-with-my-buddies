/* Google Sheet backend (temporary shared database).
   SHEET_URL is the Apps Script web app URL. SHEET_SECRET must match the
   SECRET line in the Apps Script (sheet-setup/Code.gs).
   This file is public, so the secret only stops casual writes. It is not real security.
   Set SHEET_URL to "" to go back to browser-only storage. */
const SHEET_URL = "https://script.google.com/macros/s/AKfycbxr3e86ryE7HzVSr4cqcUdvuErhWYpNEwOM5_txLx_fhkGPIUKPjttn4sZpsmI2fjyd/exec";
const SHEET_SECRET = "bwmb-m4Rk7qX2vL9p";

/* Sportsbooks shown in the bet form and the odds panel: [Odds API key, label].
   Keep the keys in sync with BOOK_KEYS in sheet-setup/Code.gs. */
/* Master switch for sportsbook odds. false = the odds sections are hidden and nothing is requested.
   The same switch exists in the Apps Script (ODDS_ENABLED); set both to true to turn odds back on. */
const ODDS_ENABLED = false;

const BOOKS = [
    ["draftkings", "DraftKings"],
    ["fanduel", "FanDuel"],
    ["betmgm", "BetMGM"],
    ["williamhill_us", "Caesars"],
    ["espnbet", "ESPN BET"],
    ["fanatics", "Fanatics"],
    ["hardrockbet", "Hard Rock Bet"],
    ["betrivers", "BetRivers"]
];

/* Weekly pot on the Insights page. Set the amount each player puts in per week (for example 10).
   The pot is buy-in x the players who had a bet settle that week, and the week's top profit wins it.
   0 = no pot, just the weekly and season board. The site only tracks it; money moves between you. */
const WEEKLY_BUYIN = 0;
