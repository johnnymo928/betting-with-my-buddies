/* ============================================================
   Flags: a Thanksgiving game. Everyone chips in per flag thrown during an NFL game
   (e.g. 15 flags x $0.25 = $3.75 each). At the end one player is picked at random and wins the pot.
   One tab per game plus a Summary tab.

   Flags are counted by tapping +1, and also read from ESPN's play-by-play. ESPN mentions every
   "PENALTY on ..." in a play's text, including declined and offsetting flags, so its count is flags
   THROWN, not just the accepted penalties in the box score. If ESPN is ahead of the taps, the count
   jumps up to ESPN's number. Everything is shared through the Store (saved as extra records).
   ============================================================ */
const $ = id => document.getElementById(id);
const { esc } = Store;
const money = n => "$" + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const readLS = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

/* ---------- The three Thanksgiving games ---------- */
const PLAN = [
    { name: "Bears vs Lions",    away: ["CHI", "Bears"],  home: ["DET", "Lions"],   at: [18, 0],  time: "12:00 PM CT" },
    { name: "Eagles vs Cowboys", away: ["PHI", "Eagles"], home: ["DAL", "Cowboys"], at: [21, 30], time: "3:30 PM CT" },
    { name: "Chiefs vs Bills",   away: ["KC", "Chiefs"],  home: ["BUF", "Bills"],   at: [25, 20], time: "7:20 PM CT" }     // 25:20 UTC = 1:20 AM UTC the next day
];
const thanksgiving = y => { const d = new Date(y, 10, 1); return new Date(y, 10, 1 + (4 - d.getDay() + 7) % 7 + 21); };
const pad = n => String(n).padStart(2, "0");

/* ---------- ESPN: flags thrown ---------- */
const espn = {};                                   // gameId -> { thrown, accepted, state, detail }
const countThrown = d => {
    const drives = [...(d.drives?.previous || []), ...(d.drives?.current ? [d.drives.current] : [])];
    let n = 0;
    drives.forEach(dr => (dr.plays || []).forEach(p => { n += (String(p.text || "").match(/penalty on/gi) || []).length; }));
    return n;
};
const countAccepted = d => (d.boxscore?.teams || []).reduce((s, t) =>
    s + (Number(String((t.statistics || []).find(x => x.label === "Penalties")?.displayValue || "").split("-")[0]) || 0), 0);

async function loadEspn(g) {
    if (!g.gameId) return;
    try {
        const d = await Live.getJSON(Live.url("nfl", `nfl/summary?event=${encodeURIComponent(g.gameId)}`), 20000);
        const st = d.header?.competitions?.[0]?.status?.type;
        const e = espn[g.gameId] = { thrown: countThrown(d), accepted: countAccepted(d), state: st?.state || "pre", detail: st?.shortDetail || "" };
        const cur = Store.recs("flaggame").find(x => x.id === g.id);
        // ESPN is ahead of the taps: catch up (never goes down, and stops once a winner is picked)
        if (cur && cur.autoSync !== false && !cur.winner && e.thrown > (cur.flags || 0)) Store.putRec({ ...cur, flags: e.thrown });
    } catch (err) { console.error("flags", err); }
}

/* ---------- Data ---------- */
const games = () => Store.recs("flaggame").filter(g => !g.deleted).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const playersOf = gid => Store.recs("flagplayer").filter(p => p.gameId === gid && !p.removed).sort((a, b) => a.createdAt - b.createdAt);
const fresh = id => Store.recs("flaggame").find(g => g.id === id);
function calc(g) {
    const ps = playersOf(g.id), paid = ps.filter(p => p.paid).length, each = (g.flags || 0) * (g.price || 0), pot = each * ps.length;
    return { ps, n: ps.length, paid, unpaid: ps.length - paid, each, pot, collected: each * paid, owed: each * (ps.length - paid) };
}

let tab = readLS("bwmb.flagTab", "");
let spinning = false;

async function setup() {
    const y = new Date().getFullYear(), t = thanksgiving(y), ymd = `${y}${pad(t.getMonth() + 1)}${pad(t.getDate())}`;
    let events = [];
    try { events = (await Live.getJSON(Live.url("nfl", `nfl/scoreboard?dates=${ymd}&limit=50`), 60000)).events || []; } catch {}
    PLAN.forEach((p, i) => {
        const id = `flg:${y}:${i}`;
        if (Store.recs("flaggame").some(g => g.id === id)) return;
        const ev = matchEvent(events, p);
        Store.putRec({ id, mode: "flaggame", order: i, year: y, name: p.name, time: p.time, away: p.away[1], home: p.home[1],
            gameId: ev?.id || null, start: ev?.date || new Date(Date.UTC(y, t.getMonth(), t.getDate(), p.at[0], p.at[1])).toISOString(),
            price: 0.25, flags: 0, autoSync: true, winner: null });
    });
    render();
}
const matchEvent = (events, p) => events.find(e => {
    const ab = (e.competitions?.[0]?.competitors || []).map(c => c.team?.abbreviation);
    return ab.includes(p.away[0]) && ab.includes(p.home[0]);
});
async function relink(g) {
    const t = new Date(g.start), ymd = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}`;
    const p = PLAN.find(x => x.name === g.name); if (!p) return;
    try {
        const events = (await Live.getJSON(Live.url("nfl", `nfl/scoreboard?dates=${ymd}&limit=50`), 0)).events || [];
        const ev = matchEvent(events, p);
        if (ev) { Store.putRec({ ...fresh(g.id), gameId: ev.id, start: ev.date }); await loadEspn(fresh(g.id)); }
        else alert("ESPN doesn't list this game yet. Keep tapping +1 by hand and try again later.");
    } catch { alert("Couldn't reach ESPN."); }
    render();
}

/* ---------- Render ---------- */
function render() {
    const gs = games();
    if (!gs.some(g => g.id === tab) && tab !== "summary") tab = gs[0]?.id || "";
    $("fl-tabs").innerHTML = gs.map(g => `<button type="button" data-tab="${esc(g.id)}" class="${g.id === tab ? "on" : ""}" role="tab">${esc(g.name)}</button>`).join("")
        + (gs.length ? `<button type="button" data-tab="summary" class="${tab === "summary" ? "on" : ""}" role="tab">Summary</button>` : "");
    $("fl-tabs").parentElement.hidden = !gs.length;
    if (!gs.length) {
        $("fl-app").innerHTML = `<section class="panel panel-wide fl-hero"><div class="fl-big-emoji">🏈</div>
            <h2>Thanksgiving Flags</h2>
            <p class="hint">Everybody chips in for every flag thrown. At the end of each game one player wins the pot. Set up the three Thanksgiving games to begin.</p>
            <button class="btn primary fl-bigbtn" id="fl-setup" type="button">Set up the 3 games</button></section>`;
        return;
    }
    if (tab === "summary") return renderSummary(gs);
    const g = gs.find(x => x.id === tab); renderGame(g);
}

function renderGame(g) {
    const c = calc(g), e = espn[g.gameId], done = !!g.winner;
    const others = games().filter(x => x.id !== g.id && playersOf(x.id).length);
    $("fl-app").innerHTML = `
    <section class="panel panel-wide fl-stage">
        <div class="panel-head"><h2><span class="tag tag-gold">FLAGS</span> ${esc(g.name)}</h2><span class="page-info">${esc(g.time || "")}</span></div>
        <div class="fl-counter" aria-live="polite"><span class="fl-num" id="fl-count">${g.flags || 0}</span><span class="fl-cap">FLAGS THROWN</span></div>
        <div class="fl-actions">
            <button class="btn fl-plus" id="fl-plus" type="button" ${done ? "disabled" : ""}>🚩 +1 FLAG</button>
            <button class="btn ghost" id="fl-minus" type="button" ${done || !g.flags ? "disabled" : ""}>−1 (oops)</button>
        </div>
        <p class="hint fl-espn">${!g.gameId ? `Not linked to ESPN, so flags are counted by hand. <button class="btn ghost sm" id="fl-link" type="button">Link to ESPN</button>`
            : e ? `ESPN play-by-play: <b>${e.thrown}</b> flags thrown (<b>${e.accepted}</b> accepted) · ${esc(e.detail)}`
                  : "Reading ESPN play-by-play…"}
            ${g.gameId ? `<label class="fl-check"><input type="checkbox" id="fl-auto" ${g.autoSync !== false ? "checked" : ""}> Catch up to ESPN's count automatically</label>` : ""}</p>
        <div class="fl-tiles">
            <div class="fl-tile"><span>PLAYERS</span><b>${c.n}</b></div>
            <div class="fl-tile"><span>EACH OWES</span><b>${money(c.each)}</b><small>${money(g.price)} per flag</small></div>
            <div class="fl-tile gold"><span>THE POT</span><b>${money(c.pot)}</b></div>
            <div class="fl-tile good"><span>COLLECTED</span><b>${money(c.collected)}</b><small>${c.paid} paid</small></div>
            <div class="fl-tile bad"><span>STILL OWED</span><b>${money(c.owed)}</b><small>${c.unpaid} not paid</small></div>
        </div>
        <label class="fl-price">Cost per flag ($) <input id="fl-price" type="number" min="0" step="0.05" value="${g.price}" ${done ? "disabled" : ""}></label>
    </section>

    <section class="panel panel-wide">
        <div class="panel-head"><h2><span class="tag">PLAYERS</span> Who's in (${c.n})</h2></div>
        <form id="fl-add" class="form inline" novalidate>
            <input id="fl-name" type="text" maxlength="60" placeholder="Add names (comma separated)" aria-label="Player names" autocomplete="off">
            <button class="btn primary" type="submit">Add</button>
        </form>
        ${others.length ? `<div class="row-btns"><select id="fl-copy" aria-label="Copy players"><option value="">Copy players from…</option>${others.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("")}</select></div>` : ""}
        <ul class="fl-players">${c.ps.length ? c.ps.map(p => `
            <li class="fl-player ${p.paid ? "paid" : ""}" data-id="${esc(p.id)}">
                <label class="fl-check"><input type="checkbox" data-paid ${p.paid ? "checked" : ""}> <b>${esc(p.name)}</b></label>
                <span class="fl-owes">${p.paid ? "PAID" : "owes " + money(c.each)}</span>
                <button class="btn ghost sm" data-remove type="button" aria-label="Remove ${esc(p.name)}" ${done ? "disabled" : ""}>✕</button>
            </li>`).join("") : `<li class="empty">No players yet. Add the family above.</li>`}</ul>
    </section>

    <section class="panel panel-wide fl-winner-panel">
        <div class="panel-head"><h2><span class="tag tag-gold">WINNER</span> The Draw</h2></div>
        <div id="fl-winner">${winnerBox(g, c)}</div>
        ${done ? `<div class="row-btns"><button class="btn ghost" id="fl-redo" type="button">Pick again</button></div>`
               : `<button class="btn primary fl-bigbtn" id="fl-pick" type="button" ${c.n ? "" : "disabled"}>🏆 PICK WINNER</button>
                  <p class="hint">Picks one of the ${c.n} players at random and awards the whole pot (${money(c.pot)}). Make sure the flag count is final first, because tapping locks once there's a winner.</p>`}
    </section>`;
}
const winnerBox = (g, c) => g.winner
    ? `<div class="fl-trophy"><div class="fl-cup">🏆</div><div class="fl-wname">${esc(g.winner.name)}</div><div class="fl-wamt">wins ${money(g.winner.amount)}</div><div class="fl-wsub">${g.winner.flags} flags · ${g.winner.players} players · ${money(g.price)} a flag</div></div>`
    : `<div class="fl-trophy idle"><div class="fl-cup">🏆</div><div class="fl-wsub">No winner yet</div></div>`;

function renderSummary(gs) {
    let flags = 0, pot = 0, coll = 0, owed = 0;
    const rows = gs.map(g => {
        const c = calc(g); flags += g.flags || 0; pot += c.pot; coll += c.collected; owed += c.owed;
        return `<tr><td><b>${esc(g.name)}</b><div class="muted">${esc(g.time || "")}</div></td><td>${g.flags || 0}</td><td>${c.n}</td><td>${money(c.pot)}</td><td>${money(c.collected)}</td>
            <td>${g.winner ? `<b class="fl-gold">🏆 ${esc(g.winner.name)}</b> <span class="muted">${money(g.winner.amount)}</span>` : "<span class='muted'>Not picked</span>"}</td></tr>`;
    }).join("");
    $("fl-app").innerHTML = `
    <section class="panel panel-wide fl-stage">
        <div class="panel-head"><h2><span class="tag tag-gold">SUMMARY</span> Thanksgiving Day</h2></div>
        <div class="fl-tiles">
            <div class="fl-tile"><span>TOTAL FLAGS</span><b>${flags}</b></div>
            <div class="fl-tile gold"><span>TOTAL POTS</span><b>${money(pot)}</b></div>
            <div class="fl-tile good"><span>COLLECTED</span><b>${money(coll)}</b></div>
            <div class="fl-tile bad"><span>STILL OWED</span><b>${money(owed)}</b></div>
        </div>
    </section>
    <section class="panel panel-wide">
        <div class="table-wrap"><table class="table"><tr><th>Game</th><th>Flags</th><th>Players</th><th>Pot</th><th>Collected</th><th>Winner</th></tr>${rows}</table></div>
    </section>`;
}

/* ---------- Actions ---------- */
document.addEventListener("click", async e => {
    const t = e.target;
    if (t.closest("#fl-tabs [data-tab]")) { tab = t.closest("[data-tab]").dataset.tab; writeLS("bwmb.flagTab", tab); return render(); }
    if (t.id === "fl-setup") { t.disabled = true; t.textContent = "Setting up…"; await setup(); await loadAllEspn(); return render(); }
    const g = fresh(tab);
    if (t.id === "fl-plus" && g && !g.winner) { Store.putRec({ ...g, flags: (g.flags || 0) + 1 }); return render(); }
    if (t.id === "fl-minus" && g && !g.winner && g.flags > 0) { Store.putRec({ ...g, flags: g.flags - 1, autoSync: false }); return render(); }   // a manual -1 turns auto catch-up off so ESPN doesn't undo it
    if (t.id === "fl-link" && g) return relink(g);
    if (t.id === "fl-pick" && g) return pickWinner(g);
    if (t.id === "fl-redo" && g && confirm("Clear the winner and pick again?")) { Store.putRec({ ...g, winner: null }); return render(); }
    const li = t.closest(".fl-player");
    if (li && t.hasAttribute("data-remove")) { const p = Store.recs("flagplayer").find(x => x.id === li.dataset.id); if (p) Store.putRec({ ...p, removed: true }); return render(); }
});
document.addEventListener("change", e => {
    const t = e.target, g = fresh(tab);
    if (t.id === "fl-auto" && g) { Store.putRec({ ...g, autoSync: t.checked }); render(); }
    else if (t.id === "fl-price" && g) { const v = Number(t.value); if (v >= 0) Store.putRec({ ...g, price: v }); render(); }
    else if (t.id === "fl-copy" && g && t.value) {
        const have = new Set(playersOf(g.id).map(p => p.name.toLowerCase()));
        playersOf(t.value).filter(p => !have.has(p.name.toLowerCase())).forEach(p => addPlayer(g.id, p.name));
        render();
    } else if (t.hasAttribute("data-paid")) {
        const p = Store.recs("flagplayer").find(x => x.id === t.closest(".fl-player").dataset.id);
        if (p) Store.putRec({ ...p, paid: t.checked }); render();
    }
});
document.addEventListener("submit", e => {
    if (e.target.id !== "fl-add") return;
    e.preventDefault();
    const g = fresh(tab); if (!g) return;
    const have = new Set(playersOf(g.id).map(p => p.name.toLowerCase()));
    $("fl-name").value.split(",").map(s => s.trim()).filter(Boolean).forEach(n => { if (!have.has(n.toLowerCase())) { have.add(n.toLowerCase()); addPlayer(g.id, n); } });
    render(); $("fl-name")?.focus();
});
const addPlayer = (gid, name) => Store.putRec({ id: `flp:${gid}:${Store.uid()}`, mode: "flagplayer", gameId: gid, name: name.slice(0, 60), paid: false, removed: false });

/* The draw: a short name shuffle, then the winner. The winner is chosen up front with a secure random number. */
async function pickWinner(g) {
    const ps = playersOf(g.id); if (!ps.length || spinning) return;
    spinning = true;
    const c = calc(g), r = new Uint32Array(1); crypto.getRandomValues(r);
    const win = ps[r[0] % ps.length], box = $("fl-winner");
    $("fl-pick").disabled = true;
    for (let i = 0; i < 22; i++) {
        box.innerHTML = `<div class="fl-trophy spin"><div class="fl-cup">🏆</div><div class="fl-wname">${esc(ps[Math.floor(Math.random() * ps.length)].name)}</div></div>`;
        await new Promise(res => setTimeout(res, 50 + i * i * 0.6));
    }
    Store.putRec({ ...fresh(g.id), winner: { playerId: win.id, name: win.name, amount: c.pot, flags: g.flags || 0, players: c.n, at: Date.now() } });
    spinning = false; render();
}

const loadAllEspn = () => Promise.all(games().map(loadEspn));
// re-render when new data syncs in, but never while someone is typing a name or mid-draw
const safeRender = () => { if (spinning || document.activeElement?.id === "fl-name" || document.activeElement?.id === "fl-price") return; render(); };
window.addEventListener("storage", safeRender);
render();
loadAllEspn().then(safeRender);
setInterval(() => { if (!document.hidden) loadAllEspn().then(safeRender); }, 30000);
