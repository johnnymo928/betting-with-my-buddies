/* ============================================================
   Sportsbook odds (The Odds API, fetched through the Apps Script so the
   API key stays private). Results are cached by the script for 15 minutes
   and here for 5, because free credits are limited.
   ============================================================ */
const Odds = (() => {
    const enabled = typeof SHEET_URL !== "undefined" && !!SHEET_URL;
    const mem = new Map();

    // our prop stat -> Odds API market (stats missing here have no sportsbook lines)
    const PROP_MARKET = {
        pass_yds: "player_pass_yds", pass_tds: "player_pass_tds", pass_cmp: "player_pass_completions",
        pass_att: "player_pass_attempts", ints: "player_pass_interceptions", rush_yds: "player_rush_yds",
        rush_att: "player_rush_attempts", rec_yds: "player_reception_yds", rec: "player_receptions",
        rr_yds: "player_rush_reception_yds", td_any: "player_anytime_td", fg: "player_field_goals"
    };

    const bookLabel = key => (typeof BOOKS !== "undefined" && BOOKS.find(b => b[0] === key)?.[1]) || key;
    const bookKeys = () => (typeof BOOKS !== "undefined" ? BOOKS.map(b => b[0]) : []);

    async function call(params, ttl = 300000, force = false) {
        const id = JSON.stringify(params), hit = mem.get(id);
        if (!force && hit && Date.now() - hit.t < ttl) return hit.data;
        const qs = new URLSearchParams({ secret: SHEET_SECRET, action: "odds", ...params });
        const res = await fetch(`${SHEET_URL}?${qs}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        mem.set(id, { t: Date.now(), data });
        return data;
    }

    const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    const same = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };

    /* Find the Odds API event that matches an ESPN game from Live.games() */
    async function forGame(league, game, force) {
        const j = await call({ league }, 300000, force);     // today's saved snapshot (the script pulls it once a day)
        const [away, home] = game.teams;
        const event = (j.events || []).find(e =>
            (same(e.away, away.full) || same(e.away, away.name)) && (same(e.home, home.full) || same(e.home, home.name))) || null;
        return { event, fetchedAt: j.fetchedAt, none: !!j.none, remaining: j.remaining };
    }

    // "Sun 9:02 AM": when the saved odds were pulled
    const pulledAt = ms => ms ? new Date(ms).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";

    /* Lines from every book for one player prop. Returns rows by book:
       { key, label, line, over, under } */
    async function propLines(league, eventId, stat, playerName, force) {
        const market = PROP_MARKET[stat];
        if (!market) return { unsupported: true, books: [] };
        const j = await call({ league, eventId, market }, 300000, force);
        const mine = j.rows.filter(r => same(r.player, playerName));
        const by = {};
        mine.forEach(r => {
            const b = by[r.book] ||= { key: r.book, label: bookLabel(r.book), line: null, over: null, under: null };
            if (market === "player_anytime_td") {            // yes/no market, no line
                if (r.side === "Yes") { b.line = 0.5; b.over = r.price; }
            } else {
                b.line = r.point;
                if (r.side === "Over") b.over = r.price; else if (r.side === "Under") b.under = r.price;
            }
        });
        return { books: Object.values(by).filter(b => b.line != null), fetchedAt: j.fetchedAt, remaining: j.remaining };
    }

    /* American odds <-> decimal, for combining parlay legs */
    const toDecimal = a => a > 0 ? 1 + a / 100 : 1 + 100 / -a;
    const toAmerican = d => d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
    const combine = prices => toAmerican(prices.reduce((m, p) => m * toDecimal(p), 1));

    const fmt = n => n == null ? "–" : (n > 0 ? "+" : "") + n;

    async function status() { return call({ status: 1 }, 0, true); }

    return { enabled, PROP_MARKET, bookLabel, bookKeys, forGame, propLines, combine, fmt, status, pulledAt };
})();
