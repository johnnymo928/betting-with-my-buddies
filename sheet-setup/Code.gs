/**
 * Betting with Buddies: Google Sheet backend (temporary database)
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
  if (e.parameter.action === "feedback") return json_({ items: listFeedback_() });
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

  // Feedback ideas are open to everyone (rate limited)
  if (body.action === "feedback") return json_(addFeedback_(body));

  // Admin PIN, checked here (not in the website) so it can't be skipped from the browser.
  if (body.action === "adminCheck") {
    const r = pinCheck_(body.pin);
    return json_(r.ok ? { ok: true } : { error: r.locked ? "locked" : "bad_pin" });
  }
  // Only admins can delete things, restore backups, or change profiles.
  const adminOnly = body.action === "remove" || body.action === "replaceAll" || body.action === "oddsRefresh" ||
    (body.action === "upsert" && body.kind === "profile");
  if (adminOnly) {
    const r = pinCheck_(body.pin);
    if (!r.ok) return json_({ error: r.locked ? "locked" : "forbidden" });
  }

  if (body.action === "oddsRefresh") return json_(oddsPullAll_());   // admin: pull odds now (about 6 credits)

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let all = readAll_();
    const list = function (kind) { return kind === "profile" ? all.profiles : all.bets; };

    if (body.action === "upsert") {
      const l = list(body.kind), i = l.findIndex(function (r) { return r.id === body.record.id; });
      // a device that can't see a private stake sends null: keep the stake we already have
      if (body.kind === "bet" && body.record.private && body.record.stake == null && i >= 0) body.record.stake = l[i].stake;
      // removing or restoring a bet (soft delete) is admin-only; so is overwriting a removed bet
      if (body.kind === "bet" && !!(i >= 0 && l[i].deleted) !== !!body.record.deleted) {
        const r = pinCheck_(body.pin);
        if (!r.ok) return json_({ error: r.locked ? "locked" : "forbidden" });
      }
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
    const s = b.deleted ? "deleted" : statusOf_(b), win = b.stake * mult_(b.odds);
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
   never in the website.

   ONE PULL PER GAME DAY. A timer (see installOddsTrigger) runs oddsTick every
   15 minutes. On a day with games it waits until 3 hours before the FIRST
   kickoff, then pulls every league that plays that day, once, and saves the
   result with its pull time. Everything on the website reads that saved copy,
   so opening pages never spends credits.
     game lines ......... 3 credits per league per game day
     one prop market .... 1 credit per game and market (on demand, capped per day)
     status check ....... free
   ============================================================ */
const ODDS_BASE = "https://api.the-odds-api.com/v4/";
const ODDS_SPORTS = { nfl: "americanfootball_nfl", ncaaf: "americanfootball_ncaaf" };
const ESPN_BOARD = {
  nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  ncaaf: "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=100"
};
// Books to keep (Odds API keys). Keep in sync with BOOKS in the site's config.js.
const BOOK_KEYS = ["draftkings", "fanduel", "betmgm", "williamhill_us", "espnbet", "fanatics", "hardrockbet", "betrivers"];
const ODDS_TZ = "America/New_York";             // decides which calendar day a game belongs to
const ODDS_LEAD_MS = 3 * 3600 * 1000;           // pull this long before the first kickoff of the day
const ODDS_MIN_CREDITS = 40;                    // stop calling the odds service below this many credits
const ODDS_PROP_DAILY_MAX = 10;                 // player-prop credits allowed per day
const PROP_CACHE_SECONDS = 21600;               // prop lines are cached for 6 hours (the most CacheService allows)
// Only these player-prop markets can be requested (stops arbitrary credit spending)
const PROP_MARKET_ALLOW = [
  "player_pass_yds", "player_pass_tds", "player_pass_completions", "player_pass_attempts",
  "player_pass_interceptions", "player_rush_yds", "player_rush_attempts", "player_reception_yds",
  "player_receptions", "player_rush_reception_yds", "player_anytime_td", "player_field_goals"
];

function dayKey_(ms) { return Utilities.formatDate(new Date(ms), ODDS_TZ, "yyyy-MM-dd"); }

function oddsFetch_(path, query, free) {
  const key = PropertiesService.getScriptProperties().getProperty("ODDS_API_KEY");
  if (!key) return { error: "no_key" };
  // credit guard: the free plan is about 500 requests a month, so stop before it runs out
  const known = CacheService.getScriptCache().get("odds:remaining");
  if (!free && known !== null && Number(known) < ODDS_MIN_CREDITS) return { error: "credits_low", remaining: Number(known) };
  const res = UrlFetchApp.fetch(ODDS_BASE + path + "?apiKey=" + encodeURIComponent(key) + query, { muteHttpExceptions: true });
  const h = res.getHeaders(), code = res.getResponseCode();
  const rem = h["x-requests-remaining"] || h["X-Requests-Remaining"];
  const used = h["x-requests-used"] || h["X-Requests-Used"];
  if (rem !== undefined) { try { CacheService.getScriptCache().put("odds:remaining", String(rem), 21600); } catch (e) {} }
  if (code !== 200) return { error: "odds_http_" + code, remaining: rem === undefined ? null : Number(rem) };
  return { data: JSON.parse(res.getContentText()), remaining: rem === undefined ? null : Number(rem), used: used === undefined ? null : Number(used) };
}

function cached_(key, produce) {
  const cache = CacheService.getScriptCache(), hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const out = produce();
  if (!out.error) { try { cache.put(key, JSON.stringify(out), PROP_CACHE_SECONDS); } catch (e) {} }
  return out;
}

/* ---------- Saved daily snapshot (kept in Script Properties, in chunks) ---------- */
function saveSnap_(league, snap) {
  const props = PropertiesService.getScriptProperties();
  const s = JSON.stringify(snap), CH = 8000, n = Math.ceil(s.length / CH);
  const old = Number(props.getProperty("snap:" + league + ":n") || 0), set = {};
  for (let i = 0; i < n; i++) set["snap:" + league + ":" + i] = s.substr(i * CH, CH);
  set["snap:" + league + ":n"] = String(n);
  props.setProperties(set);
  for (let i = n; i < old; i++) props.deleteProperty("snap:" + league + ":" + i);
}

function readSnap_(league) {
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty("snap:" + league + ":n") || 0);
  if (!n) return null;
  let s = "";
  for (let i = 0; i < n; i++) s += props.getProperty("snap:" + league + ":" + i) || "";
  try { return JSON.parse(s); } catch (e) { return null; }
}

// Spreads + moneyline + totals for every game in a league (3 credits)
function oddsGamesFetch_(league) {
  const r = oddsFetch_("sports/" + ODDS_SPORTS[league] + "/odds/", "&regions=us&oddsFormat=american&markets=h2h,spreads,totals");
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
}

function oddsPullLeagues_(leagues) {
  const pulled = [];
  for (let i = 0; i < leagues.length; i++) {
    const snap = oddsGamesFetch_(leagues[i]);
    if (snap.error) return { error: snap.error, pulled: pulled };
    saveSnap_(leagues[i], snap);
    pulled.push({ league: leagues[i], games: snap.events.length, remaining: snap.remaining });
  }
  return { ok: true, pulled: pulled, at: new Date().getTime() };
}

// Admin "pull now" button: both leagues, regardless of the schedule (about 6 credits)
function oddsPullAll_() { return oddsPullLeagues_(Object.keys(ODDS_SPORTS)); }

/* ---------- The daily schedule ---------- */
// Runs every 15 minutes (timer). Does nothing until 3 hours before the first kickoff of a game day,
// then pulls once for that day.
function oddsTick() {
  const props = PropertiesService.getScriptProperties();
  const now = new Date().getTime(), day = dayKey_(now);
  if (props.getProperty("odds:day:" + day)) return;                  // already pulled today
  const tries = Number(props.getProperty("odds:tries:" + day) || 0);
  if (tries >= 3) return;                                            // don't burn credits on repeated failures

  let first = null, anyOpen = false;
  const leaguesToday = [];
  Object.keys(ESPN_BOARD).forEach(function (lg) {                    // ESPN's scoreboard is free
    let events = [];
    try { events = JSON.parse(UrlFetchApp.fetch(ESPN_BOARD[lg], { muteHttpExceptions: true }).getContentText()).events || []; } catch (e) {}
    const today = events.filter(function (e) { return e.date && dayKey_(new Date(e.date).getTime()) === day; });
    if (!today.length) return;
    leaguesToday.push(lg);
    today.forEach(function (e) {
      const t = new Date(e.date).getTime();
      if (first === null || t < first) first = t;
      if (e.status && e.status.type && e.status.type.state !== "post") anyOpen = true;
    });
  });
  if (!leaguesToday.length || !anyOpen) return;                      // no games today, or all finished
  if (now < first - ODDS_LEAD_MS) return;                            // too early: wait for 3 hours before the first kickoff

  props.setProperty("odds:tries:" + day, String(tries + 1));
  const r = oddsPullLeagues_(leaguesToday);
  if (r.ok) props.setProperty("odds:day:" + day, String(now));
}

// Run this ONCE from the Apps Script editor (select it, click Run) to start the timer.
function installOddsTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "oddsTick") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("oddsTick").timeBased().everyMinutes(15).create();
}

/* ---------- What the website asks for ---------- */
function oddsRoute_(p) {
  if (p.status) {                                        // free call: credits left, last pull times, timer state
    const r = oddsFetch_("sports/", "", true);
    if (r.error) return json_({ error: r.error });
    const snapTime = function (lg) { const s = readSnap_(lg); return s ? s.fetchedAt : null; };
    let timer = null;
    try { timer = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "oddsTick"; }); } catch (e) {}
    return json_({ ok: true, remaining: r.remaining, used: r.used, lastPull: { nfl: snapTime("nfl"), ncaaf: snapTime("ncaaf") }, timer: timer });
  }
  const sport = ODDS_SPORTS[p.league];
  if (!sport) return json_({ error: "bad_league" });

  if (p.eventId) {                                       // one player-prop market for one game (on demand, capped per day)
    if (PROP_MARKET_ALLOW.indexOf(p.market) < 0) return json_({ error: "bad_market" });
    const id = String(p.eventId).replace(/[^A-Za-z0-9_-]/g, "");
    return json_(cached_("prop:" + id + ":" + p.market, function () {
      const props = PropertiesService.getScriptProperties(), pk = "odds:props:" + dayKey_(new Date().getTime());
      const usedToday = Number(props.getProperty(pk) || 0);
      if (usedToday >= ODDS_PROP_DAILY_MAX) return { error: "prop_limit" };
      const r = oddsFetch_("sports/" + sport + "/events/" + id + "/odds", "&regions=us&oddsFormat=american&markets=" + p.market);
      if (r.error) return r;
      props.setProperty(pk, String(usedToday + 1));
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

  // game lines: just read today's saved snapshot. Never spends credits.
  return json_(readSnap_(p.league) || { events: [], fetchedAt: null, none: true });
}

/* ============================================================
   Feedback: ideas from the website's Feedback page.
   Saved on their own tab, "Feedback", one row per idea. Edit the Status
   column (New, Planned, In progress, Done, Won't do) any time; the website shows it.
   This tab is never rebuilt, so notes and extra columns you add are safe.
   ============================================================ */
const FEEDBACK_TAB = "Feedback";
const FEEDBACK_HEADERS = ["Submitted", "From", "Category", "Idea", "Status", "ID", "Page"];

function feedbackSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(FEEDBACK_TAB);
  if (!sh) {
    sh = ss.insertSheet(FEEDBACK_TAB);
    sh.getRange(1, 1, 1, FEEDBACK_HEADERS.length).setValues([FEEDBACK_HEADERS]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.setColumnWidth(4, 520);
    sh.getRange("D:D").setWrap(true);
    sh.getRange("A:A").setNumberFormat("yyyy-mm-dd hh:mm");
  }
  return sh;
}

// trim, cap the length, and stop anything that looks like a formula from running in the sheet
function clean_(s, max) {
  s = String(s === undefined || s === null ? "" : s).trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function addFeedback_(rec) {
  const text = clean_(rec.text, 1000);
  if (text.length < 3) return { error: "too_short" };
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get("fb:hour") || 0);
  if (n >= 30) return { error: "rate_limited" };           // at most 30 ideas an hour, so nobody can flood the sheet
  cache.put("fb:hour", String(n + 1), 3600);
  const id = Utilities.getUuid().slice(0, 8);
  feedbackSheet_().appendRow([new Date(), clean_(rec.name, 40) || "Anonymous", clean_(rec.category, 30) || "Idea", text, "New", id, clean_(rec.page, 40)]);
  return { ok: true, id: id };
}

function listFeedback_() {
  const sh = feedbackSheet_(), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, FEEDBACK_HEADERS.length).getValues()
    .filter(function (r) { return r[3]; })
    .map(function (r) {
      return { at: r[0] instanceof Date ? r[0].getTime() : null, name: String(r[1]), category: String(r[2]), text: String(r[3]), status: String(r[4] || "New"), id: String(r[5]) };
    })
    .reverse()
    .slice(0, 200);
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
  if (String(pin === undefined || pin === null ? "" : pin) === String(real)) {
    cache.remove("pinfails");
    return { ok: true };
  }
  // Only a PIN that was actually entered and is wrong counts as a failed try. A request that
  // carries no PIN at all (an old or stale browser tab) is refused without locking anyone out.
  if (pin !== undefined && pin !== null && String(pin) !== "") cache.put("pinfails", String(fails + 1), 300);
  return { ok: false, locked: false };
}
