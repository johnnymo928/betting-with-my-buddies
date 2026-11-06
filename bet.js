const $ = id => document.getElementById(id);
const { esc } = Store;

let type = "single";
const form = $("bet-form");
const fmt = n => (n > 0 ? "+" : "") + n;

const KINDS = [
    ["spread", "Spread"],
    ["ml", "Moneyline"],
    ["total", "Total (Over/Under)"],
    ["prop", "Player prop"]
];
// sensible default stat per position when a player is picked
const DEFAULT_STAT = { QB: "pass_yds", RB: "rush_yds", FB: "rush_yds", WR: "rec_yds", TE: "rec_yds", PK: "fg", K: "fg" };
const POS_ORDER = ["QB", "RB", "FB", "WR", "TE", "PK", "K"];

/* ---------- Profiles ---------- */
function renderProfiles() {
    const ps = Store.profiles();
    const prev = $("profile").value, prevFilter = $("filter").value;
    $("no-profiles").hidden = ps.length > 0;
    form.hidden = ps.length === 0;
    $("profile").innerHTML = `<option value="">Select your profile&hellip;</option>` +
        ps.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    $("filter").innerHTML = `<option value="">Everyone</option>` +
        ps.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    $("profile").value = prev || localStorage.getItem("bwmb.lastProfile") || "";
    if (!ps.some(p => p.id === $("profile").value)) $("profile").value = "";
    $("filter").value = prevFilter;
}

/* ============================================================
   Leg builder: every field is a dropdown (League > Game > Bet type > picks)
   ============================================================ */
const opts = (items, sel) => items.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`).join("");

function legRow() {
    const row = document.createElement("div");
    row.className = "leg-row";
    row.innerHTML = `
        <div class="leg-grid">
            <label>League
                <select class="f-league">
                    <option value="nfl">NFL</option>
                    <option value="ncaaf">College Football</option>
                </select>
            </label>
            <label class="f-game-wrap">Game <select class="f-game"></select></label>
            <label>Bet type <select class="f-kind">${opts(KINDS, "spread")}</select></label>
            <div class="kind-fields"></div>
            <div class="lines" hidden></div>
        </div>
        <button type="button" class="btn icon rm" aria-label="Remove leg">&times;</button>`;

    const q = s => row.querySelector(s);
    const st = { games: [], game: null, players: [], loadErr: false };
    row._price = null; row._book = null; row._oddsAt = null;   // set when a sportsbook line is chosen with "Use"
    let token = 0;                                // ignores stale odds responses

    /* ----- games ----- */
    async function loadGames() {
        q(".f-game").innerHTML = `<option>Loading games&hellip;</option>`;
        st.games = []; st.game = null; st.loadErr = false;
        try { st.games = await Live.games(q(".f-league").value); }
        catch (e) { console.error(e); st.loadErr = true; }
        q(".f-game").innerHTML = st.games.length
            ? st.games.map((g, i) => `<option value="${i}">${esc(g.label)} · ${esc(g.detail)}</option>`).join("")
            : `<option value="">${st.loadErr ? "Couldn't load games. Try again in a moment." : "No upcoming games"}</option>`;
        pickGame();
    }
    function pickGame() {
        st.game = st.games[Number(q(".f-game").value)] || null;
        st.players = [];
        renderFields();
    }

    /* ----- bet-type fields ----- */
    const teamOpts = (withBoth) =>
        (withBoth ? `<option value="">Both teams</option>` : "") +
        (st.game ? st.game.teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("") : "");
    const sideOpts = `<option value="over">Over</option><option value="under">Under</option>`;

    function renderFields() {
        const kind = q(".f-kind").value, box = q(".kind-fields");
        if (kind === "spread") {
            box.innerHTML = `
                <label>Team <select class="f-team">${teamOpts(false)}</select></label>
                <label>Spread <input type="number" step="0.5" class="f-line" placeholder="-6.5"></label>`;
            q(".f-line").oninput = e => e.target.dataset.touched = "1";
            q(".f-team").onchange = () => { prefillSpread(); refreshLines(); };
            prefillSpread();
        } else if (kind === "ml") {
            box.innerHTML = `<label>Team to win <select class="f-team">${teamOpts(false)}</select></label>`;
            q(".f-team").onchange = refreshLines;
        } else if (kind === "total") {
            box.innerHTML = `
                <label>Pick <select class="f-side">${sideOpts}</select></label>
                <label>Total points <input type="number" step="0.5" min="0" class="f-line" placeholder="48.5"></label>`;
            const t = st.game?.line?.total;
            if (t != null) q(".f-line").value = t;
        } else if (kind === "prop") {
            const groups = {};
            Live.STATS.forEach(s => (groups[s.group] ||= []).push([s.key, s.label]));
            box.innerHTML = `
                <label>Team <select class="f-team">${teamOpts(true)}</select></label>
                <label>Player <select class="f-player"><option value="">Loading players&hellip;</option></select></label>
                <label>Stat <select class="f-stat">${Object.entries(groups).map(([g, items]) =>
                    `<optgroup label="${g}">${opts(items)}</optgroup>`).join("")}</select></label>
                <label>Pick <select class="f-side">${sideOpts}</select></label>
                <label>Line <input type="number" step="0.5" min="0" class="f-line" placeholder="249.5"></label>`;
            q(".f-team").onchange = renderPlayers;
            q(".f-player").onchange = () => { suggestStat(); refreshLines(); };
            q(".f-stat").onchange = refreshLines;
            loadPlayers();
        }
        refreshLines();
    }

    /* ----- sportsbook lines (see odds.js) ----- */
    const panel = q(".lines");
    // editing any field by hand drops a chosen sportsbook price, since it may no longer match
    function clearUsed() {
        row._price = null; row._book = null; row._oddsAt = null;
        panel.querySelectorAll("tr.used").forEach(t => t.classList.remove("used"));
    }
    q(".kind-fields").addEventListener("input", clearUsed);
    q(".kind-fields").addEventListener("change", clearUsed);

    const NO_SNAPSHOT = "No odds have been pulled yet. Lines are pulled once on game days, 3 hours before the first kickoff.";
    let panelAsOf = null;                         // when the lines on screen were pulled
    const showMsg = t => { panel.innerHTML = `<p class="lines-msg">${esc(t)}</p>`; };

    async function refreshLines() {
        const my = ++token, kind = q(".f-kind").value;
        if (!Odds.enabled || !st.game) { panel.hidden = true; return; }
        panel.hidden = false;
        const league = q(".f-league").value;

        try {
            if (kind === "prop") {
                const pid = q(".f-player")?.value;
                if (!pid) return showMsg("Pick a player to see sportsbook lines.");
                const p = st.players.find(x => x.id === pid);
                if (!p) return;
                showMsg("Loading lines…");
                const { event, none } = await Odds.forGame(league, st.game);
                if (my !== token) return;
                if (!event) return showMsg(none ? NO_SNAPSHOT : "No sportsbook lines saved for this game.");
                const r = await Odds.propLines(league, event.id, q(".f-stat").value, p.name);
                if (my !== token) return;
                if (r.unsupported) return showMsg("Sportsbooks don't list this stat.");
                if (!r.books.length) return showMsg("No sportsbook lines for this player and stat yet.");
                renderLines("prop", r.books, r.fetchedAt);
            } else {
                showMsg("Loading lines…");
                const { event, fetchedAt, none } = await Odds.forGame(league, st.game);
                if (my !== token) return;
                if (!event || !event.books.length) return showMsg(none ? NO_SNAPSHOT : "No sportsbook lines saved for this game.");
                renderLines(kind, event.books, fetchedAt);
            }
        } catch (e) {
            console.error("odds", e);
            if (my === token) showMsg(e.message === "credits_low" ? "Sportsbook lines are paused to protect this month's free odds credits."
                : e.message === "prop_limit" ? "Today's player-prop lookups are used up. Enter the prop line by hand."
                : "Sportsbook lines aren't available right now.");
        }
    }

    function renderLines(kind, books, fetchedAt) {
        const f = Odds.fmt, order = Odds.bookKeys();
        const homeId = st.game.teams[1].id, teamId = q(".f-team")?.value;
        const side = teamId === homeId ? "home" : "away";
        const team = st.game.teams.find(t => t.id === teamId);
        const rows = [];
        const sorted = books.slice().sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

        sorted.forEach(b => {
            const label = Odds.bookLabel(b.key);
            if (kind === "spread" && b.spread?.[side]) {
                const s = b.spread[side];
                rows.push({ label, text: `${f(s.point)} (${f(s.price)})`, score: s.point * 1000 + s.price,
                    uses: [{ text: "Use", d: { line: s.point, price: s.price, book: b.key } }] });
            } else if (kind === "ml" && b.ml?.[side] != null) {
                rows.push({ label, text: f(b.ml[side]), score: b.ml[side],
                    uses: [{ text: "Use", d: { price: b.ml[side], book: b.key } }] });
            } else if (kind === "total" && b.total?.point != null) {
                const t = b.total, uses = [];
                if (t.over != null) uses.push({ text: "Over", d: { line: t.point, side: "over", price: t.over, book: b.key } });
                if (t.under != null) uses.push({ text: "Under", d: { line: t.point, side: "under", price: t.under, book: b.key } });
                rows.push({ label, text: `${t.point} · O ${f(t.over)} / U ${f(t.under)}`, uses });
            } else if (kind === "prop") {
                const uses = [];
                if (b.over != null) uses.push({ text: "Over", d: { line: b.line, side: "over", price: b.over, book: b.key } });
                if (b.under != null) uses.push({ text: "Under", d: { line: b.line, side: "under", price: b.under, book: b.key } });
                rows.push({ label, text: `${b.line} · O ${f(b.over)} / U ${f(b.under)}`, uses });
            }
        });
        if (!rows.length) return showMsg("No sportsbook lines for this selection yet.");

        const best = ["spread", "ml"].includes(kind) ? Math.max(...rows.map(r => r.score)) : null;
        const title = kind === "spread" ? `${team?.name || ""} spread` : kind === "ml" ? `${team?.name || ""} moneyline`
            : kind === "total" ? "Game total" : "Player prop";
        const asOf = Odds.pulledAt(fetchedAt);
        panelAsOf = fetchedAt || null;

        panel.innerHTML = `
            <div class="lines-head"><b>Lines by sportsbook</b> <span class="muted">${esc(title)}${asOf ? " \u00b7 <b>odds pulled " + esc(asOf) + "</b>" : ""}</span></div>
            <table class="lines-table"><tbody>${rows.map(r => `
                <tr>
                    <td class="lb">${esc(r.label)}${r.score === best ? ' <span class="best">Best</span>' : ""}</td>
                    <td class="lt">${esc(r.text)}</td>
                    <td class="la">${r.uses.map(u => `<button type="button" class="btn ghost sm" data-use="${esc(JSON.stringify(u.d))}">${u.text}</button>`).join("")}</td>
                </tr>`).join("")}</tbody></table>
            <p class="lines-note muted">Odds are pulled once on game days, 3 hours before the first kickoff, and can have moved since. Confirm in your app before betting.</p>`;
    }

    panel.addEventListener("click", e => {
        const btn = e.target.closest("[data-use]");
        if (!btn) return;
        const d = JSON.parse(btn.dataset.use);
        const line = q(".f-line"), side = q(".f-side");
        if (d.line != null && line) { line.value = d.line; line.dataset.touched = "1"; }
        if (d.side && side) side.value = d.side;
        row._price = d.price; row._book = d.book; row._oddsAt = panelAsOf;
        panel.querySelectorAll("tr.used").forEach(t => t.classList.remove("used"));
        btn.closest("tr").classList.add("used");
        $("book").value = d.book;
        recomputeOdds();
    });

    function prefillSpread() {
        const line = q(".f-line"), g = st.game;
        if (!line || !g || line.dataset.touched) { if (line && !g) line.value = ""; return; }
        const abbr = g.teams.find(t => t.id === q(".f-team").value)?.abbr;
        const s = g.line.spread;
        line.value = s == null || !abbr ? "" : (abbr === g.line.fav ? s : -s);
    }

    async function loadPlayers() {
        const sel = q(".f-player"); if (!sel || !st.game) return;
        try {
            const lists = await Promise.all(st.game.teams.map(t => Live.roster(q(".f-league").value, t)));
            st.players = lists.flat();
        } catch (e) { console.error(e); st.players = []; }
        renderPlayers();
    }
    function renderPlayers() {
        const sel = q(".f-player"); if (!sel) return;
        const team = q(".f-team").value;
        const abbr = st.game?.teams.find(t => t.id === team)?.abbr;
        const list = st.players.filter(p => !abbr || p.team === abbr);
        if (!list.length) { sel.innerHTML = `<option value="">No players found</option>`; return; }
        const by = {};
        list.forEach(p => (by[p.pos] ||= []).push(p));
        const order = Object.keys(by).sort((a, b) => {
            const ia = POS_ORDER.indexOf(a), ib = POS_ORDER.indexOf(b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
        });
        sel.innerHTML = `<option value="">Select a player&hellip;</option>` + order.map(pos =>
            `<optgroup label="${esc(pos || "Other")}">` +
            by[pos].sort((a, b) => a.name.localeCompare(b.name))
                .map(p => `<option value="${esc(p.id)}" data-pos="${esc(pos)}">${esc(p.name)} (${esc(p.team)})</option>`).join("") +
            `</optgroup>`).join("");
    }
    function suggestStat() {
        const o = q(".f-player").selectedOptions[0];
        const s = DEFAULT_STAT[o?.dataset.pos];
        if (s) q(".f-stat").value = s;
    }

    /* ----- read the row back as a leg ----- */
    row.getLeg = () => {
        const kind = q(".f-kind").value;
        const g = st.game;
        if (!g) throw new Error("Pick a game for every leg.");
        const league = q(".f-league").value;
        const base = { kind, league, eventId: g.id, gameLabel: g.label,
            ...(row._price != null ? { book: row._book, price: row._price, oddsAt: row._oddsAt } : {}) };
        const line = parseFloat(q(".f-line")?.value);
        const needLine = () => { if (!Number.isFinite(line)) throw new Error("Enter a line for every leg."); };
        const team = id => g.teams.find(t => t.id === id);

        if (kind === "spread" || kind === "ml") {
            const t = team(q(".f-team").value), o = g.teams.find(x => x !== t);
            if (kind === "spread") needLine();
            const pick = { ...base, teamId: t.id, teamAbbr: t.abbr, oppId: o.id, ...(kind === "spread" ? { line } : {}) };
            return { pick, text: kind === "spread" ? `${t.name} ${fmt(line)} (${g.label})` : `${t.name} ML (${g.label})` };
        }
        if (kind === "total") {
            needLine();
            const side = q(".f-side").value;
            return {
                pick: { ...base, side, line, awayId: g.teams[0].id, homeId: g.teams[1].id },
                text: `${g.label} ${side === "over" ? "Over" : "Under"} ${line}`
            };
        }
        // prop
        if (league === "ncaaf") throw new Error("Player props aren't available for college football.");
        const pid = q(".f-player").value;
        if (!pid) throw new Error("Select a player for every prop.");
        needLine();
        const p = st.players.find(x => x.id === pid), def = Live.statDef(q(".f-stat").value), side = q(".f-side").value;
        return {
            pick: { ...base, athleteId: pid, athleteName: p.name, team: p.team, stat: def.key, statLabel: def.label, side, line },
            text: `${p.name} ${side === "over" ? "Over" : "Under"} ${line} ${def.label} (${g.label})`
        };
    };

    // Player props are not offered for college football (not legal in this state).
    function syncKinds() {
        const sel = q(".f-kind"), cur = sel.value;
        const allowed = KINDS.filter(([k]) => !(k === "prop" && q(".f-league").value === "ncaaf"));
        sel.innerHTML = opts(allowed, allowed.some(([k]) => k === cur) ? cur : "spread");
    }
    q(".f-league").onchange = () => { syncKinds(); loadGames(); };
    q(".f-game").onchange = pickGame;
    q(".f-kind").onchange = renderFields;
    q(".rm").onclick = () => { row.remove(); syncLegs(); };

    renderFields();
    loadGames();
    return row;
}

function syncLegs() {
    const rows = [...$("legs").children];
    const min = type === "parlay" ? 2 : 1;
    while (rows.length < min) { const r = legRow(); $("legs").appendChild(r); rows.push(r); }
    if (type === "single") rows.slice(1).forEach(r => r.remove());
    const n = $("legs").children.length;
    [...$("legs").children].forEach(r => r.querySelector(".rm").hidden = type === "single" || n <= 2);
    $("add-leg").hidden = type !== "parlay";
    $("legs-label").textContent = type === "parlay" ? "Parlay legs" : "Your bet";
    $("odds-label").textContent = type === "parlay" ? "Total parlay odds" : "Odds (American)";
}
$("add-leg").onclick = () => { $("legs").appendChild(legRow()); syncLegs(); };

document.querySelectorAll(".seg button").forEach(btn => btn.onclick = () => {
    type = btn.dataset.type;
    document.querySelectorAll(".seg button").forEach(b => {
        b.classList.toggle("on", b === btn);
        b.setAttribute("aria-checked", b === btn);
    });
    if (type === "parlay" && $("odds").value === "-110") $("odds").value = "";
    if (type === "single" && !$("odds").value) $("odds").value = "-110";
    syncLegs(); preview();
});

/* ---------- Sportsbook + odds from chosen lines ---------- */
function fillBooks() {
    $("book").closest("label").hidden = !Odds.enabled;          // sportsbook picker only exists while odds are on
    if (typeof BOOKS === "undefined") return;
    $("book").innerHTML = `<option value="">Not specified</option>` +
        BOOKS.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join("") +
        `<option value="other">Other</option>`;
}

// A single bet takes its leg's price. A parlay combines every leg's price once they all have one.
function recomputeOdds() {
    const prices = [...$("legs").children].map(r => r._price);
    if (type === "single") { if (prices[0] != null) $("odds").value = prices[0]; }
    else if (prices.length && prices.every(p => p != null)) $("odds").value = Odds.combine(prices);
    preview();
}

function preview() {
    const stake = parseFloat($("stake").value), odds = parseInt($("odds").value, 10);
    $("payout-preview").textContent = stake > 0 && Math.abs(odds) >= 100
        ? `To win ${Store.money(stake * Store.multiplier(odds))} · total return ${Store.money(stake * (1 + Store.multiplier(odds)))}`
        : "";
}
$("stake").oninput = $("odds").oninput = preview;

/* ---------- Submit ---------- */
form.onsubmit = e => {
    e.preventDefault();
    $("form-error").textContent = "";
    try {
        Store.addBet({
            profileId: $("profile").value,
            type,
            stake: parseFloat($("stake").value),
            odds: parseInt($("odds").value, 10),
            privateAmount: $("private").checked,
            book: $("book").value,
            legs: [...$("legs").children].map(r => r.getLeg())
        });
        localStorage.setItem("bwmb.lastProfile", $("profile").value);
        $("legs").innerHTML = ""; $("stake").value = ""; $("private").checked = false;
        syncLegs(); preview(); renderBets(); liveTick();
    } catch (err) {
        $("form-error").textContent = err.message;
    }
};

/* ---------- Bet list ---------- */
function renderBets() {
    const f = $("filter").value;
    const list = Store.bets().filter(b => !f || b.profileId === f);
    const x = Store.exposure(list);
    $("exposure").innerHTML = x.count
        ? `Open bets: <b>${x.count}</b> · at risk <b class="neg">${Store.money(x.atRisk)}</b> · to win <b class="pos">${Store.money(x.toWin)}</b>${x.hidden ? ` <span class="muted">(+${x.hidden} private)</span>` : ""}` : "";
    $("bet-list").innerHTML = list.length
        ? list.map(b => UI.betCard(b, { editable: true })).join("")
        : `<div class="empty">No bets yet.</div>`;
}
$("filter").onchange = renderBets;
$("bet-list").onclick = e => {
    const b = e.target.closest("button[data-act=leg]");
    if (!b) return;
    Store.setLegStatus(b.dataset.bet, b.dataset.leg, b.dataset.status);
    renderBets();
    if (b.dataset.status === "pending") liveTick();   // handed back to auto-grading
};
window.addEventListener("storage", () => { Store.reload(); renderProfiles(); renderBets(); });

/* ---------- Live grading ---------- */
async function liveTick() {
    try { if (await Live.refresh()) renderBets(); } catch (e) { console.error(e); }
}
setInterval(liveTick, 45000);

fillBooks(); renderProfiles(); syncLegs(); renderBets(); liveTick();
