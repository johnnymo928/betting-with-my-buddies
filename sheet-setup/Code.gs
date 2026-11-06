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
  if (e.parameter.action === "odds") return oddsRoute_(e.parameter);
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

  // Admin PIN, checked here (not in the website) so it can't be skipped from the browser.
  if (body.action === "adminCheck") {
    const r = pinCheck_(body.pin);
    return json_(r.ok ? { ok: true } : { error: r.locked ? "locked" : "bad_pin" });
  }
  // Only admins can delete things, restore backups, or change profiles.
  const adminOnly = body.action === "remove" || body.action === "replaceAll" ||
    (body.action === "upsert" && body.kind === "profile");
  if (adminOnly) {
    const r = pinCheck_(body.pin);
    if (!r.ok) return json_({ error: r.locked ? "locked" : "forbidden" });
  }

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

/* ============================================================
   Sportsbook odds via The Odds API (the-odds-api.com)
   The API key lives in Script Properties as ODDS_API_KEY (Project Settings),
   never in the website. Results are cached so the free credits last:
     game lines ......... 3 credits per fetch (spreads + moneyline + totals)
     one prop market .... 1 credit per game and market
     status check ....... free
   ============================================================ */
const ODDS_BASE = "https://api.the-odds-api.com/v4/";
const ODDS_SPORTS = { nfl: "americanfootball_nfl", ncaaf: "americanfootball_ncaaf" };
// Books to keep (Odds API keys). Keep in sync with BOOKS in the site's config.js.
const BOOK_KEYS = ["draftkings", "fanduel", "betmgm", "williamhill_us", "espnbet", "fanatics", "hardrockbet", "betrivers"];
const ODDS_TTL = 900;   // seconds to cache (15 minutes)
// Only these player-prop markets can be requested (stops arbitrary credit spending)
const PROP_MARKET_ALLOW = [
  "player_pass_yds", "player_pass_tds", "player_pass_completions", "player_pass_attempts",
  "player_pass_interceptions", "player_rush_yds", "player_rush_attempts", "player_reception_yds",
  "player_receptions", "player_rush_reception_yds", "player_anytime_td", "player_field_goals"
];

function oddsFetch_(path, query) {
  const key = PropertiesService.getScriptProperties().getProperty("ODDS_API_KEY");
  if (!key) return { error: "no_key" };
  const res = UrlFetchApp.fetch(ODDS_BASE + path + "?apiKey=" + encodeURIComponent(key) + query, { muteHttpExceptions: true });
  const h = res.getHeaders(), code = res.getResponseCode();
  const rem = h["x-requests-remaining"] || h["X-Requests-Remaining"];
  const used = h["x-requests-used"] || h["X-Requests-Used"];
  if (code !== 200) return { error: "odds_http_" + code, remaining: rem === undefined ? null : Number(rem) };
  return { data: JSON.parse(res.getContentText()), remaining: rem === undefined ? null : Number(rem), used: used === undefined ? null : Number(used) };
}

function cached_(key, produce) {
  const cache = CacheService.getScriptCache(), hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const out = produce();
  if (!out.error) { try { cache.put(key, JSON.stringify(out), ODDS_TTL); } catch (e) {} }
  return out;
}

function oddsRoute_(p) {
  if (p.status) {                                        // free call: just reports remaining credits
    const r = oddsFetch_("sports/", "");
    return json_(r.error ? { error: r.error } : { ok: true, remaining: r.remaining, used: r.used });
  }
  const sport = ODDS_SPORTS[p.league];
  if (!sport) return json_({ error: "bad_league" });

  if (p.eventId) {                                       // one player-prop market for one game
    if (PROP_MARKET_ALLOW.indexOf(p.market) < 0) return json_({ error: "bad_market" });
    const id = String(p.eventId).replace(/[^A-Za-z0-9_-]/g, "");
    return json_(cached_("prop:" + id + ":" + p.market, function () {
      const r = oddsFetch_("sports/" + sport + "/events/" + id + "/odds", "&regions=us&oddsFormat=american&markets=" + p.market);
      if (r.error) return r;
      const rows = [];
      (r.data.bookmakers || []).forEach(function (b) {
        if (BOOK_KEYS.indexOf(b.key) < 0) return;
        (b.markets || []).forEach(function (m) {
          (m.outcomes || []).forEach(function (o) {
            rows.push({ book: b.key, title: b.title, player: o.description || "", side: o.name, price: o.price, point: o.point === undefined ? null : o.point });
          });
        });
      });
      return { rows: rows, fetchedAt: new Date().getTime(), remaining: r.remaining };
    }));
  }

  return json_(cached_("games:" + p.league, function () {  // spreads + moneyline + totals for every game
    const r = oddsFetch_("sports/" + sport + "/odds/", "&regions=us&oddsFormat=american&markets=h2h,spreads,totals");
    if (r.error) return r;
    const events = r.data.map(function (ev) {
      const books = [];
      (ev.bookmakers || []).forEach(function (b) {
        if (BOOK_KEYS.indexOf(b.key) < 0) return;
        const out = { key: b.key, title: b.title };
        (b.markets || []).forEach(function (m) {
          if (m.key === "h2h") {
            out.ml = {};
            m.outcomes.forEach(function (o) { out.ml[o.name === ev.home_team ? "home" : "away"] = o.price; });
          } else if (m.key === "spreads") {
            out.spread = {};
            m.outcomes.forEach(function (o) { out.spread[o.name === ev.home_team ? "home" : "away"] = { point: o.point, price: o.price }; });
          } else if (m.key === "totals") {
            out.total = {};
            m.outcomes.forEach(function (o) {
              out.total.point = o.point;
              out.total[o.name === "Over" ? "over" : "under"] = o.price;
            });
          }
        });
        books.push(out);
      });
      return { id: ev.id, home: ev.home_team, away: ev.away_team, start: ev.commence_time, books: books };
    });
    return { events: events, fetchedAt: new Date().getTime(), remaining: r.remaining };
  }));
}

/* ============================================================
   Admin PIN
   Default is below. To keep the PIN out of the public repo, add a Script
   Property named ADMIN_PIN (Project Settings > Script Properties); it wins.
   5 wrong tries in a row lock the PIN for 5 minutes.
   ============================================================ */
const DEFAULT_ADMIN_PIN = "0827";

function pinCheck_(pin) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get("pinfails") || 0);
  if (fails >= 5) return { ok: false, locked: true };
  const real = PropertiesService.getScriptProperties().getProperty("ADMIN_PIN") || DEFAULT_ADMIN_PIN;
  if (String(pin === undefined || pin === null ? "" : pin) === String(real)) return { ok: true };
  cache.put("pinfails", String(fails + 1), 300);
  return { ok: false, locked: false };
}
