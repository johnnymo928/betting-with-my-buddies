/* ============================================================
   NFL pool: Survivor and Pick'em.
   Survivor: pick one team to win each week. If it loses (or ties) you are out. You can't use a team twice.
   Pick'em:  pick the winner of every game. Most correct picks wins.
   Results come from ESPN. Picks are saved with the shared data (Store), and locked at kickoff.
   ============================================================ */
const $ = id => document.getElementById(id);
const { esc } = Store;

const FINALS_KEY = "bwmb.poolFinals";            // finished games, so old weeks never need fetching again
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
let mode = readJSON("bwmb.poolMode", "survivor");
const board = { season: null, week: null, type: 2, events: [], error: false, loaded: false };
let finals = readJSON(FINALS_KEY, {});           // eventId -> winning team id, or "tie"

/* ---------- ESPN ---------- */
function parseEvent(e) {
    const comp = e.competitions?.[0]; if (!comp) return null;
    const team = c => ({ id: String(c.team?.id), abbr: c.team?.abbreviation, name: c.team?.shortDisplayName || c.team?.displayName,
        logo: c.team?.logo || "", score: Number(c.score) });
    const away = comp.competitors.find(c => c.homeAway === "away"), home = comp.competitors.find(c => c.homeAway === "home");
    if (!away || !home) return null;
    const state = e.status?.type?.state || "pre";
    return { id: String(e.id), start: e.date, state, detail: e.status?.type?.shortDetail || "",
        away: team(away), home: team(home), winnerId: state === "post" ? winnerOf(comp) : null };
}
function winnerOf(comp) {
    const w = comp.competitors.find(c => c.winner === true);
    if (w) return String(w.team?.id ?? w.id);
    const [a, b] = comp.competitors;
    return Number(a.score) === Number(b.score) ? "tie" : null;
}

async function loadBoard() {
    try {
        const d = await Live.getJSON(Live.url("nfl", "nfl/scoreboard"), 30000);
        board.season = d.season?.year ?? new Date().getFullYear();
        board.week = d.week?.number ?? null;
        board.type = d.season?.type ?? 2;
        board.events = (d.events || []).map(parseEvent).filter(Boolean).sort((a, b) => a.start.localeCompare(b.start));
        board.error = false;
        board.events.forEach(ev => { if (ev.winnerId) finals[ev.id] = ev.winnerId; });
        localStorage.setItem(FINALS_KEY, JSON.stringify(finals));
    } catch (e) { console.error("pool", e); board.error = true; }
    board.loaded = true;
    render();
    fetchOldFinals();
}

// results for games from earlier weeks that aren't cached yet
async function fetchOldFinals() {
    const need = [...new Set(Store.picks().filter(p => p.season === board.season && !finals[p.eventId] &&
        Date.parse(p.start) < Date.now() - 3 * 3600000 && !board.events.some(e => e.id === p.eventId)).map(p => p.eventId))];
    if (!need.length) return;
    await Promise.all(need.map(async id => {
        try {
            const d = await Live.getJSON(Live.url("nfl", `nfl/summary?event=${id}`), 30000);
            const comp = d.header?.competitions?.[0];
            if (comp?.status?.type?.state === "post") {
                const w = comp.competitors.find(c => c.winner === true);
                finals[id] = w ? String(w.id ?? w.team?.id) : "tie";
            }
        } catch (e) { console.error("pool results", id, e); }
    }));
    localStorage.setItem(FINALS_KEY, JSON.stringify(finals));
    render();
}

/* ---------- rules ---------- */
const started = ev => Date.parse(ev.start) <= Date.now() || ev.state !== "pre";
const pickResult = p => {                       // "won" | "lost" | "pending"
    const w = finals[p.eventId];
    return !w ? "pending" : w === p.teamId ? "won" : "lost";
};
const picksOf = (pid, m) => Store.picks().filter(p => p.mode === m && p.season === board.season && p.profileId === pid);

function survivorState(pid) {
    const mine = picksOf(pid, "survivor").sort((a, b) => a.week - b.week);
    if (!mine.length) return { joined: false, alive: true, survived: 0 };
    const byWeek = {}; mine.forEach(p => byWeek[p.week] = p);
    let alive = true, survived = 0, outWeek = null, why = "";
    for (let w = mine[0].week; w <= board.week && alive; w++) {
        const pk = byWeek[w];
        if (!pk) { if (w < board.week) { alive = false; outWeek = w; why = "missed the week"; } continue; }
        const r = pickResult(pk);
        if (r === "won") survived++;
        else if (r === "lost") { alive = false; outWeek = w; why = `${pk.teamName} lost`; }
    }
    return { joined: true, alive, survived, outWeek, why, current: byWeek[board.week] };
}

/* ---------- drawing ---------- */
function drawProfiles() {
    const ps = Store.profiles(), prev = $("pool-profile").value || localStorage.getItem("bwmb.lastProfile") || "";
    $("pool-profile").innerHTML = `<option value="">Select your profile&hellip;</option>` +
        ps.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    $("pool-profile").value = ps.some(p => p.id === prev) ? prev : "";
}

function drawGames() {
    const pid = $("pool-profile").value, box = $("games");
    if (!board.loaded) { box.innerHTML = `<div class="empty">Loading games&hellip;</div>`; return; }
    if (board.error && !board.events.length) { box.innerHTML = `<div class="empty error">Couldn't load the NFL schedule. Try again in a moment.</div>`; return; }
    if (board.type !== 2 || !board.events.length) {
        box.innerHTML = `<div class="empty">The pool runs during the NFL regular season. There are no regular season games on the board right now.</div>`; return;
    }
    const sv = mode === "survivor" && pid ? survivorState(pid) : null;
    const usedElsewhere = new Set(mode === "survivor" && pid
        ? picksOf(pid, "survivor").filter(p => p.week !== board.week).map(p => p.teamId) : []);
    const mine = pid ? picksOf(pid, mode).filter(p => mode === "survivor" ? p.week === board.week : true) : [];
    const chosen = new Set(mine.map(p => p.teamId));

    if (sv && !sv.alive) $("rules").textContent = `You're out: ${sv.why} in week ${sv.outWeek}. You can still watch the standings.`;

    box.innerHTML = `<div class="pool-games">${board.events.map(ev => {
        const locked = started(ev);
        const btn = t => {
            const on = chosen.has(t.id), used = usedElsewhere.has(t.id), out = sv && !sv.alive;
            const res = on && finals[ev.id] ? (finals[ev.id] === t.id ? " ✓" : " ✗") : "";
            const disabled = !pid || locked || used || out;
            return `<button type="button" class="team-pick ${on ? "on" : ""} ${on && finals[ev.id] ? (finals[ev.id] === t.id ? "won" : "lost") : ""}"
                data-event="${ev.id}" data-team="${t.id}" ${disabled ? "disabled" : ""}
                title="${used ? "You already used this team in an earlier week" : locked ? "Kicked off" : ""}">
                ${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : ""}<span>${esc(t.name)}${res}</span>
                ${used ? `<small>used</small>` : ""}</button>`;
        };
        const when = ev.state === "pre" ? new Date(ev.start).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : ev.detail;
        return `<div class="pool-game ${locked ? "locked" : ""}">
            ${btn(ev.away)}<span class="at">@</span>${btn(ev.home)}
            <span class="when">${locked ? "🔒 " : ""}${esc(when)}${ev.state !== "pre" ? ` · ${ev.away.abbr} ${ev.away.score}–${ev.home.abbr} ${ev.home.score}` : ""}</span>
        </div>`;
    }).join("")}</div>`;
}

function drawStandings() {
    const ps = Store.profiles();
    const revealed = (p) => { const ev = board.events.find(e => e.id === p.eventId); return !ev || started(ev); };
    if (mode === "survivor") {
        $("stand-title").textContent = "Survivor";
        const rows = ps.map(p => ({ p, s: survivorState(p.id) })).filter(r => r.s.joined)
            .sort((a, b) => (b.s.alive - a.s.alive) || (b.s.survived - a.s.survived));
        $("standings").innerHTML = rows.length ? `
            <thead><tr><th>Player</th><th>Status</th><th>Weeks survived</th><th>This week</th></tr></thead>
            <tbody>${rows.map(({ p, s }) => {
                const cur = s.current;
                const pick = !cur ? (s.alive ? "<span class='muted'>no pick yet</span>" : "–")
                    : revealed(cur) ? `${esc(cur.teamName)} ${{ won: "✓", lost: "✗", pending: "" }[pickResult(cur)]}` : "🔒 locked in";
                return `<tr><td><span class="who"><i style="background:${esc(p.color)}"></i>${esc(p.name)}</span></td>
                    <td>${s.alive ? "<b class='pos'>Alive</b>" : `<span class="neg">Out (week ${s.outWeek})</span>`}</td>
                    <td>${s.survived}</td><td>${pick}</td></tr>`;
            }).join("")}</tbody>` : `<tbody><tr><td class="muted">Nobody has made a survivor pick yet.</td></tr></tbody>`;
    } else {
        $("stand-title").textContent = "Pick'em";
        const rows = ps.map(p => {
            const all = picksOf(p.id, "pickem"), wk = all.filter(x => x.week === board.week);
            const wins = a => a.filter(x => pickResult(x) === "won").length;
            return { p, season: wins(all), seasonN: all.filter(x => pickResult(x) !== "pending").length,
                week: wins(wk), weekN: wk.length, weekDone: wk.filter(x => pickResult(x) !== "pending").length };
        }).filter(r => r.seasonN || r.weekN).sort((a, b) => b.season - a.season || b.week - a.week);
        $("standings").innerHTML = rows.length ? `
            <thead><tr><th>#</th><th>Player</th><th>This week</th><th>Season</th></tr></thead>
            <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td>
                <td><span class="who"><i style="background:${esc(r.p.color)}"></i>${esc(r.p.name)}</span></td>
                <td>${r.week} correct <span class="muted">(${r.weekN} picked, ${r.weekDone} final)</span></td>
                <td><b>${r.season}</b> <span class="muted">of ${r.seasonN}</span></td></tr>`).join("")}</tbody>`
            : `<tbody><tr><td class="muted">Nobody has made a pick'em pick yet.</td></tr></tbody>`;
    }
}

function render() {
    $("week-title").textContent = board.week ? `NFL Week ${board.week}` : "NFL";
    document.querySelectorAll("#pool-mode button").forEach(b => {
        b.classList.toggle("on", b.dataset.mode === mode); b.setAttribute("aria-checked", b.dataset.mode === mode);
    });
    $("rules").textContent = mode === "survivor"
        ? "Pick one team to win this week. If it loses or ties, you're out. You can't use a team twice. Miss a week and you're out. Change your pick any time before that game kicks off."
        : "Pick the winner of every game. Most correct picks wins. Change a pick any time before that game kicks off.";
    drawGames(); drawStandings();
}

/* ---------- events ---------- */
$("pool-mode").onclick = e => {
    const m = e.target.dataset.mode; if (!m) return;
    mode = m; localStorage.setItem("bwmb.poolMode", JSON.stringify(m)); $("pool-error").textContent = ""; render();
};
$("pool-profile").onchange = () => { localStorage.setItem("bwmb.lastProfile", $("pool-profile").value); $("pool-error").textContent = ""; render(); };
$("games").onclick = e => {
    const b = e.target.closest(".team-pick"); if (!b || b.disabled) return;
    const ev = board.events.find(x => x.id === b.dataset.event), t = [ev.away, ev.home].find(x => x.id === b.dataset.team);
    $("pool-error").textContent = "";
    try {
        Store.setPick({ mode, profileId: $("pool-profile").value, season: board.season, week: board.week, eventId: ev.id,
            teamId: t.id, teamAbbr: t.abbr, teamName: t.name, gameLabel: `${ev.away.abbr} @ ${ev.home.abbr}`, start: ev.start });
        render();
    } catch (err) { $("pool-error").textContent = err.message; }
};
window.addEventListener("storage", () => { Store.reload(); drawProfiles(); render(); });

drawProfiles();
render();
loadBoard();
setInterval(loadBoard, 60000);
