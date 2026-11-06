/* ============================================================
   Live data + prop grading (ESPN's free, unofficial API).
   - games(league)           upcoming/live games for the prop builder
   - roster(league, teamId)  players for the prop builder
   - refresh()               fetches box scores for pending prop legs,
                             records live progress, and auto-grades legs
   ============================================================ */
const Live = (() => {
    const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/";
    const LEAGUES = {
        nfl:   { path: "nfl", label: "NFL", board: "nfl/scoreboard" },
        ncaaf: { path: "college-football", label: "NCAAF", board: "college-football/scoreboard?groups=80&limit=100" }
    };

    /* Each stat is a sum of box-score columns. [category, column label, sub-index]
       sub-index splits "16/26" style values (0 = made, 1 = attempted). */
    const STATS = [
        { key: "pass_yds",  group: "Passing",   label: "Pass Yds",         parts: [["passing", "YDS"]] },
        { key: "pass_tds",  group: "Passing",   label: "Pass TDs",         parts: [["passing", "TD"]] },
        { key: "pass_cmp",  group: "Passing",   label: "Completions",      parts: [["passing", "C/ATT", 0]] },
        { key: "pass_att",  group: "Passing",   label: "Pass Attempts",    parts: [["passing", "C/ATT", 1]] },
        { key: "ints",      group: "Passing",   label: "INTs Thrown",      parts: [["passing", "INT"]] },
        { key: "rush_yds",  group: "Rushing",   label: "Rush Yds",         parts: [["rushing", "YDS"]] },
        { key: "rush_att",  group: "Rushing",   label: "Rush Attempts",    parts: [["rushing", "CAR"]] },
        { key: "rush_tds",  group: "Rushing",   label: "Rush TDs",         parts: [["rushing", "TD"]] },
        { key: "rec_yds",   group: "Receiving", label: "Rec Yds",          parts: [["receiving", "YDS"]] },
        { key: "rec",       group: "Receiving", label: "Receptions",       parts: [["receiving", "REC"]] },
        { key: "rec_tds",   group: "Receiving", label: "Rec TDs",          parts: [["receiving", "TD"]] },
        { key: "rr_yds",    group: "Combos",    label: "Rush+Rec Yds",     parts: [["rushing", "YDS"], ["receiving", "YDS"]] },
        { key: "pr_yds",    group: "Combos",    label: "Pass+Rush Yds",    parts: [["passing", "YDS"], ["rushing", "YDS"]] },
        { key: "td_any",    group: "Combos",    label: "Rush+Rec TDs",     parts: [["rushing", "TD"], ["receiving", "TD"]] },
        { key: "fg",        group: "Other",     label: "Field Goals Made", parts: [["kicking", "FG", 0]] },
        { key: "sacks",     group: "Other",     label: "Sacks",            parts: [["defensive", "SACKS"]] },
        { key: "tackles",   group: "Other",     label: "Tackles",          parts: [["defensive", "TOT"]] }
    ];
    const statDef = key => STATS.find(s => s.key === key);

    const cache = new Map();           // url -> { t, data }
    async function getJSON(url, ttl) {
        const hit = cache.get(url);
        if (hit && Date.now() - hit.t < ttl) return hit.data;
        const res = await fetch(url);
        if (!res.ok) throw new Error("ESPN " + res.status);
        const data = await res.json();
        cache.set(url, { t: Date.now(), data });
        return data;
    }

    /* ---------- Prop builder helpers ---------- */
    async function games(league) {
        const d = await getJSON(BASE + LEAGUES[league].board, 60000);
        return (d.events || [])
            .filter(e => e.status?.type?.state !== "post")
            .map(e => {
                const comp = e.competitions[0];
                const side = ha => comp.competitors.find(c => c.homeAway === ha)?.team || {};
                const away = side("away"), home = side("home");
                const odds = comp.odds?.[0];
                const m = /^(\S+)\s+(-?\d+(?:\.\d+)?)$/.exec(odds?.details || "");   // e.g. "KC -6.5"
                const tm = t => ({
                    id: String(t.id), abbr: t.abbreviation || t.shortDisplayName,
                    name: t.shortDisplayName || t.displayName, full: t.displayName
                });
                return {
                    id: e.id, state: e.status.type.state, detail: e.status.type.shortDetail, start: e.date || null,
                    label: `${tm(away).abbr} @ ${tm(home).abbr}`,
                    teams: [tm(away), tm(home)],
                    // ESPN's current line, used to prefill the form
                    line: { fav: m ? m[1] : null, spread: m ? Number(m[2]) : null, total: odds?.overUnder ?? null }
                };
            });
    }

    async function roster(league, team) {
        const d = await getJSON(`${BASE}${LEAGUES[league].path}/teams/${team.id}/roster`, 6 * 3600000);
        const out = [];
        (d.athletes || []).forEach(g => {
            if (!["offense", "defense", "specialTeam"].includes(g.position)) return;
            (g.items || []).forEach(a => out.push({
                id: String(a.id), name: a.displayName || a.fullName,
                pos: a.position?.abbreviation || "", team: team.abbr
            }));
        });
        return out;
    }

    /* ---------- Box score + grading ---------- */
    function statValue(box, athleteId, def) {
        let played = false, total = 0;
        for (const team of box?.players || []) {
            for (const cat of team.statistics || []) {
                const row = (cat.athletes || []).find(a => String(a.athlete?.id) === String(athleteId));
                if (row) played = true;
                for (const [catName, label, sub] of def.parts) {
                    if (cat.name !== catName || !row) continue;
                    const raw = row.stats?.[cat.labels.indexOf(label)];
                    const n = parseFloat(sub === undefined ? raw : String(raw).split("/")[sub]);
                    if (Number.isFinite(n)) total += n;
                }
            }
        }
        return { played, value: total };
    }

    const fmt = n => (n > 0 ? "+" : "") + n;
    const PUSH = "Landed exactly on the line (push). Grade it by hand.";

    /* Grades one structured pick (spread / moneyline / total / player prop)
       against a game summary. grade: "won" | "lost" | "pending". */
    function gradePick(pick, summary) {
        const comp = summary.header?.competitions?.[0];
        const state = comp?.status?.type?.state || "pre";
        const detail = comp?.status?.type?.shortDetail || "";
        const score = id => Number(comp?.competitors?.find(c => String(c.id) === String(id))?.score);
        const base = { kind: pick.kind, line: pick.line, state, detail };
        if (state === "pre") return { ...base, value: null, grade: "pending" };
        const final = state === "post";

        if (pick.kind === "prop") {
            const def = statDef(pick.stat);
            if (!def) return { ...base, value: null, grade: "pending" };
            const { played, value } = statValue(summary.boxscore, pick.athleteId, def);
            const over = pick.side === "over", exceeded = value > pick.line;
            const r = { ...base, value, text: `${value} / ${pick.line}`, ratio: Math.min(1, value / (pick.line || 1)) };
            // Live: an over that clears the line is a lock; an under that passes it is dead.
            if (!final) return { ...r, grade: exceeded ? (over ? "won" : "lost") : "pending" };
            if (!played) return { ...r, grade: "pending", note: "No stats recorded for this player. Grade it by hand." };
            if (value === pick.line) return { ...r, grade: "pending", note: PUSH };
            return { ...r, grade: (over ? exceeded : !exceeded) ? "won" : "lost" };
        }

        if (pick.kind === "total") {
            const a = score(pick.awayId), h = score(pick.homeId), sum = a + h;
            if (![a, h].every(Number.isFinite)) return { ...base, value: null, grade: "pending" };
            const over = pick.side === "over", exceeded = sum > pick.line;
            const r = { ...base, value: sum, text: `${sum} / ${pick.line}`, ratio: Math.min(1, sum / pick.line) };
            if (!final) return { ...r, grade: exceeded ? (over ? "won" : "lost") : "pending" };
            if (sum === pick.line) return { ...r, grade: "pending", note: PUSH };
            return { ...r, grade: (over ? exceeded : !exceeded) ? "won" : "lost" };
        }

        // spread / moneyline: compare the picked team to its opponent
        const mine = score(pick.teamId), theirs = score(pick.oppId);
        if (![mine, theirs].every(Number.isFinite)) return { ...base, value: null, grade: "pending" };
        const margin = mine - theirs;
        if (pick.kind === "ml") {
            const r = { ...base, value: margin, text: `${pick.teamAbbr} ${mine}–${theirs}`, cover: margin > 0 };
            if (!final) return { ...r, grade: "pending" };
            return margin === 0 ? { ...r, grade: "pending", note: "Tie. Grade it by hand." } : { ...r, grade: margin > 0 ? "won" : "lost" };
        }
        const adj = margin + pick.line;               // > 0 means the pick covers
        const r = { ...base, value: margin, text: `${pick.teamAbbr} ${fmt(margin)} · needs to cover ${fmt(pick.line)}`, cover: adj > 0 };
        if (!final) return { ...r, grade: "pending" };
        return adj === 0 ? { ...r, grade: "pending", note: PUSH } : { ...r, grade: adj > 0 ? "won" : "lost" };
    }

    const progress = {};   // legId -> result of gradeProp

    /* Fetch box scores for every pending prop leg, record progress, auto-grade.
       Returns how many legs were checked (0 means nothing to render). */
    async function refresh() {
        const targets = [];
        Store.bets().forEach(b => b.legs.forEach(l => {
            if (l.pick && l.status === "pending") targets.push({ bet: b, leg: l });
        }));
        if (!targets.length) return 0;

        const keys = [...new Set(targets.map(t => `${t.leg.pick.league}:${t.leg.pick.eventId}`))];
        const summaries = {};
        await Promise.all(keys.map(async k => {
            const [lg, id] = k.split(":");
            try { summaries[k] = await getJSON(`${BASE}${LEAGUES[lg].path}/summary?event=${id}`, 30000); }
            catch (e) { console.error("live", k, e); }
        }));

        for (const { bet, leg } of targets) {
            const sum = summaries[`${leg.pick.league}:${leg.pick.eventId}`];
            if (!sum) continue;
            const r = gradePick(leg.pick, sum);
            progress[leg.id] = r;
            if (r.grade !== "pending" && !leg.manual) {
                Store.setLegStatus(bet.id, leg.id, r.grade, { auto: true, actual: r.value });
            }
        }
        return targets.length;
    }

    return { LEAGUES, STATS, statDef, games, roster, refresh, progress, gradePick };
})();
