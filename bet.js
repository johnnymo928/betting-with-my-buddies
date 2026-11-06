const $ = id => document.getElementById(id);
const { esc } = Store;

let type = "single";
const form = $("bet-form");
const fmt = n => (n > 0 ? "+" : "") + n;

const KINDS = [
    ["spread", "Spread"],
    ["ml", "Moneyline"],
    ["total", "Total (Over/Under)"],
    ["prop", "Player prop"],
    ["custom", "Custom (type your own)"]
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
        </div>
        <button type="button" class="btn icon rm" aria-label="Remove leg">&times;</button>`;

    const q = s => row.querySelector(s);
    const st = { games: [], game: null, players: [], loadErr: false };

    /* ----- games ----- */
    async function loadGames() {
        q(".f-game").innerHTML = `<option>Loading games&hellip;</option>`;
        st.games = []; st.game = null; st.loadErr = false;
        try { st.games = await Live.games(q(".f-league").value); }
        catch (e) { console.error(e); st.loadErr = true; }
        q(".f-game").innerHTML = st.games.length
            ? st.games.map((g, i) => `<option value="${i}">${esc(g.label)} · ${esc(g.detail)}</option>`).join("")
            : `<option value="">${st.loadErr ? "Couldn't load games. Use Custom." : "No upcoming games"}</option>`;
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
        q(".f-league").closest("label").hidden = q(".f-game-wrap").hidden = kind === "custom";

        if (kind === "custom") {
            box.innerHTML = `<label>Your bet <input type="text" class="f-text" maxlength="120" placeholder="Describe the bet"></label>`;
        } else if (kind === "spread") {
            box.innerHTML = `
                <label>Team <select class="f-team">${teamOpts(false)}</select></label>
                <label>Spread <input type="number" step="0.5" class="f-line" placeholder="-6.5"></label>`;
            q(".f-line").oninput = e => e.target.dataset.touched = "1";
            q(".f-team").onchange = prefillSpread;
            prefillSpread();
        } else if (kind === "ml") {
            box.innerHTML = `<label>Team to win <select class="f-team">${teamOpts(false)}</select></label>`;
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
            q(".f-player").onchange = suggestStat;
            loadPlayers();
        }
    }

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
        if (kind === "custom") {
            const t = q(".f-text").value.trim();
            if (!t) throw new Error("Describe your custom bet.");
            return t;
        }
        const g = st.game;
        if (!g) throw new Error("Pick a game for every leg.");
        const league = q(".f-league").value;
        const base = { kind, league, eventId: g.id, gameLabel: g.label };
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
        const pid = q(".f-player").value;
        if (!pid) throw new Error("Select a player for every prop.");
        needLine();
        const p = st.players.find(x => x.id === pid), def = Live.statDef(q(".f-stat").value), side = q(".f-side").value;
        return {
            pick: { ...base, athleteId: pid, athleteName: p.name, team: p.team, stat: def.key, statLabel: def.label, side, line },
            text: `${p.name} ${side === "over" ? "Over" : "Under"} ${line} ${def.label} (${g.label})`
        };
    };

    q(".f-league").onchange = loadGames;
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

renderProfiles(); syncLegs(); renderBets(); liveTick();
