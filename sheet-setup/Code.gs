/**
 * Betting With My Buddies: Google Sheet backend (temporary database)
 *
 * Paste this into the sheet's Apps Script editor (Extensions > Apps Script),
 * change SECRET, then Deploy > New deployment > Web app:
 *   Execute as: Me      Who has access: Anyone
 *
 * Everything lives on ONE tab named "WebSite". The script writes its own
 * header row and rebuilds the tab after every change, so don't type other
 * data on that tab. Other tabs in the spreadsheet are never touched.
 *
 * Column N (JSON) is the source of truth. The other columns are a readable
 * copy for you. Editing them by hand does nothing.
 */
const SECRET = "CHANGE_ME";   // must match SHEET_SECRET in the site's config.js
const TAB = "WebSite";

const HEADERS = [
  "Record",      // A  profile | bet
  "ID",          // B
  "Player",      // C  profile name (for a bet row, who placed it)
  "Placed",      // D
  "Bet type",    // E  single | parlay
  "Legs",        // F  leg results, or the profile color on profile rows
  "Stake",       // G
  "Odds",        // H
  "To win",      // I
  "Status",      // J  pending | won | lost
  "Profit",      // K
  "Private",     // L  yes if the stake is hidden on the site
  "Updated",     // M
  "JSON"         // N  do not edit
];
const JSON_COL = HEADERS.length;   // 14

/* ---------- Web app entry points ---------- */

// Load everything. Private stakes are removed from what other browsers receive.
function doGet(e) {
  if (!e.parameter || e.parameter.secret !== SECRET) return json_({ error: "unauthorized" });
  const all = readAll_();
  all.bets = all.bets.map(function (b) {
    if (!b.private) return b;
    const c = JSON.parse(JSON.stringify(b));
    c.stake = null;
    return c;
  });
  return json_(all);
}

// Body is JSON sent as text/plain (avoids a CORS preflight):
//   { secret, action: "upsert", kind: "bet"|"profile", record }
//   { secret, action: "remove", kind, id }
//   { secret, action: "replaceAll", profiles: [], bets: [] }
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: "bad json" }); }
  if (body.secret !== SECRET) return json_({ error: "unauthorized" });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let all = readAll_();
    const list = function (kind) { return kind === "profile" ? all.profiles : all.bets; };

    if (body.action === "upsert") {
      const l = list(body.kind), i = l.findIndex(function (r) { return r.id === body.record.id; });
      // a device that can't see a private stake sends null: keep the stake we already have
      if (body.kind === "bet" && body.record.private && body.record.stake == null && i >= 0) body.record.stake = l[i].stake;
      if (i >= 0) l[i] = body.record; else l.push(body.record);
    } else if (body.action === "remove") {
      if (body.kind === "profile") {            // deleting a profile deletes its bets
        all.profiles = all.profiles.filter(function (p) { return p.id !== body.id; });
        all.bets = all.bets.filter(function (b) { return b.profileId !== body.id; });
      } else {
        all.bets = all.bets.filter(function (b) { return b.id !== body.id; });
      }
    } else if (body.action === "replaceAll") {
      all = { profiles: body.profiles || [], bets: body.bets || [] };
    } else {
      return json_({ error: "unknown action" });
    }
    writeAll_(all);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- The WebSite tab ---------- */

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(TAB) || ss.insertSheet(TAB);
}

function readAll_() {
  const sh = sheet_(), out = { profiles: [], bets: [] };
  const n = sh.getLastRow();
  if (n < 2) return out;
  sh.getRange(2, 1, n - 1, JSON_COL).getValues().forEach(function (r) {
    const raw = r[JSON_COL - 1];
    if (!r[0] || !raw) return;
    try { (r[0] === "profile" ? out.profiles : out.bets).push(JSON.parse(raw)); } catch (err) {}
  });
  return out;
}

function statusOf_(b) {
  if (b.legs.some(function (l) { return l.status === "lost"; })) return "lost";
  if (b.legs.every(function (l) { return l.status === "won"; })) return "won";
  return "pending";
}
function mult_(odds) { return odds > 0 ? odds / 100 : 100 / -odds; }
function mark_(s) { return s === "won" ? "✓ " : s === "lost" ? "✗ " : "• "; }

function writeAll_(all) {
  const sh = sheet_(), now = new Date(), names = {};
  all.profiles.forEach(function (p) { names[p.id] = p.name; });

  const rows = [];
  all.profiles.forEach(function (p) {
    rows.push(["profile", p.id, p.name, "", "", p.color, "", "", "", "", "", "", now, JSON.stringify(p)]);
  });
  all.bets.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (b) {
    const s = statusOf_(b), win = b.stake * mult_(b.odds);
    rows.push(["bet", b.id, names[b.profileId] || "Unknown", new Date(b.createdAt), b.type,
      b.legs.map(function (l) { return mark_(l.status) + l.text; }).join("\n"),
      b.stake, b.odds, win, s, s === "won" ? win : s === "lost" ? -b.stake : 0,
      b.private ? "yes" : "", now, JSON.stringify(b)]);
  });

  sh.clearContents();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
  if (rows.length) sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  sh.setFrozenRows(1);
  sh.getRange(2, 6, Math.max(rows.length, 1), 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sh.getRange(2, 4, Math.max(rows.length, 1), 1).setNumberFormat("yyyy-mm-dd hh:mm");
  sh.getRange(2, 13, Math.max(rows.length, 1), 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sh.getRange(2, 7, Math.max(rows.length, 1), 1).setNumberFormat("$#,##0.00");
  sh.getRange(2, 9, Math.max(rows.length, 1), 1).setNumberFormat("$#,##0.00");
  sh.getRange(2, 11, Math.max(rows.length, 1), 1).setNumberFormat("$#,##0.00;-$#,##0.00");
  sh.setColumnWidth(6, 360);
  sh.hideColumns(JSON_COL);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
