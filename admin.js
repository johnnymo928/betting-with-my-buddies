const $ = id => document.getElementById(id);
const { esc } = Store;

/* The admin page is locked until the PIN is entered. The PIN is checked by the
   Apps Script (see sheet-setup/Code.gs) and kept in memory only, so reloading or
   leaving the page locks it again. The data panels below are not drawn until the check passes. The Knowledge Base is the only part that is always visible. */
function showGate(msg) {
    $("tools").hidden = true; $("gate").hidden = false;
    $("gate-title").textContent = "Admin PIN";
    $("gate-hint").textContent = "Enter the admin PIN to continue.";
    $("pin").value = ""; $("gate-error").textContent = msg || "";
    $("pin").focus();
}
function showTools() {
    $("gate").hidden = true; $("tools").hidden = false;
    renderProfiles(); renderBets(); renderComments(); renderPool(); renderSquares(); loadSqGames();
    $("odds-panel").hidden = !Odds.enabled;                     // hidden while odds are off
    if (Odds.enabled) checkOdds();
}

const ERRORS = {
    bad_pin: "Wrong PIN.",
    locked: "Too many wrong tries. Locked for 5 minutes.",
    network: "Couldn't reach the server. Check your connection and try again.",
    unauthorized: "The site isn't set up correctly (bad sheet password)."
};

$("gate-form").onsubmit = async e => {
    e.preventDefault();
    const btn = $("gate-form").querySelector("button"), pin = $("pin").value;
    if (!pin) return void ($("gate-error").textContent = "Enter the PIN.");
    btn.disabled = true; $("gate-error").textContent = "Checking…";
    const r = await Store.adminLogin(pin);
    btn.disabled = false;
    if (r.ok) showTools();
    else { $("pin").value = ""; $("gate-error").textContent = ERRORS[r.error] || "Couldn't check the PIN."; }
};
$("lock").onclick = () => { Store.adminLogout(); showGate(); };

/* ---------- Profiles ---------- */
$("new-color").value = Store.COLORS[Store.profiles().length % Store.COLORS.length];

$("profile-form").onsubmit = e => {
    e.preventDefault();
    $("profile-error").textContent = "";
    try {
        Store.addProfile($("new-name").value, $("new-color").value);
        $("new-name").value = "";
        $("new-color").value = Store.COLORS[Store.profiles().length % Store.COLORS.length];
        renderProfiles();
    } catch (err) { $("profile-error").textContent = err.message; }
};

function renderProfiles() {
    const counts = {};
    Store.bets().forEach(b => counts[b.profileId] = (counts[b.profileId] || 0) + 1);
    const ps = Store.profiles();
    $("profile-list").innerHTML = ps.length ? ps.map(p => `
        <li class="profile-row" data-id="${p.id}">
            <input type="color" value="${esc(p.color)}" data-field="color" aria-label="Color for ${esc(p.name)}">
            <input type="text" value="${esc(p.name)}" maxlength="24" data-field="name" aria-label="Name">
            <span class="muted">${counts[p.id] || 0} bets</span>
            <button class="btn danger" data-act="delete">Delete</button>
        </li>`).join("")
        : `<li class="empty">No profiles yet. Add one above.</li>`;
}
$("profile-list").addEventListener("change", e => {
    const row = e.target.closest(".profile-row"); if (!row) return;
    $("profile-error").textContent = "";
    try { Store.updateProfile(row.dataset.id, { [e.target.dataset.field]: e.target.value }); }
    catch (err) { $("profile-error").textContent = err.message; }
    renderProfiles(); renderBets();
});
$("profile-list").addEventListener("click", e => {
    if (e.target.dataset.act !== "delete") return;
    const id = e.target.closest(".profile-row").dataset.id;
    const p = Store.profile(id), n = Store.bets().filter(b => b.profileId === id).length;
    if (!confirm(`Delete "${p.name}"${n ? ` and their ${n} bet${n > 1 ? "s" : ""}` : ""}? This can't be undone.`)) return;
    Store.deleteProfile(id); renderProfiles(); renderBets();
});

/* ---------- Bets ---------- */
function renderBets() {
    const list = Store.bets();
    $("admin-bets").innerHTML = list.length
        ? list.map(b => `<div class="admin-bet">${UI.betCard(b)}<button class="btn danger" data-remove="${b.id}">Remove bet</button></div>`).join("")
        : `<div class="empty">No bets yet.</div>`;

    const gone = Store.removedBets();
    $("removed-wrap").hidden = !gone.length;
    $("removed-count").textContent = gone.length ? `(${gone.length})` : "";
    $("removed-bets").innerHTML = gone.map(b => `
        <div class="admin-bet removed">
            ${UI.betCard(b)}
            <div class="row-btns">
                <button class="btn ghost" data-restore="${b.id}">Restore</button>
                <button class="btn danger" data-purge="${b.id}">Delete forever</button>
                <span class="muted">Removed ${b.deletedAt ? new Date(b.deletedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</span>
            </div>
        </div>`).join("");
}
$("admin-bets").onclick = e => {
    const id = e.target.dataset.remove; if (!id) return;
    // soft delete: hidden from every page and from the stats, but it can be restored below
    Store.removeBet(id); renderBets(); renderProfiles();
};
$("removed-bets").onclick = e => {
    const { restore, purge } = e.target.dataset;
    if (restore) { Store.restoreBet(restore); renderBets(); renderProfiles(); }
    else if (purge && confirm("Delete this bet forever? This can't be undone.")) { Store.deleteBet(purge); renderBets(); }
};

/* ---------- Comments ---------- */
function renderComments() {
    const list = Store.allComments().slice(0, 60);
    $("admin-comments").innerHTML = list.length ? list.map(c => {
        const p = Store.profile(c.profileId), bet = Store.bets().find(b => b.id === c.betId);
        return `<div class="admin-comment">
            <span><b style="color:${esc(p?.color || "#aaa")}">${esc(p?.name || "Someone")}</b> ${esc(c.text)}
            <span class="muted">on ${esc(bet ? (bet.type === "parlay" ? bet.legs.length + "-leg parlay" : bet.legs[0].text) : "a removed bet")} \u00b7 ${new Date(c.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></span>
            <button class="btn danger sm" data-del-comment="${c.id}">Remove</button></div>`;
    }).join("") : `<div class="empty">No comments yet.</div>`;
}
$("admin-comments").onclick = e => {
    const id = e.target.dataset.delComment; if (!id) return;
    Store.removeComment(id); renderComments();
};

/* ---------- Pool visibility ---------- */
function renderPool() {
    const h = Store.poolHidden();
    $("pool-status").innerHTML = `The Pool is <b>${h ? "hidden" : "showing"}</b>.`;
    $("pool-toggle").textContent = h ? "Show the Pool" : "Hide the Pool";
}
$("pool-toggle").onclick = () => { Store.setPoolHidden(!Store.poolHidden()); renderPool(); };
window.addEventListener("storage", renderPool);

/* ---------- Odds ---------- */
const ODDS_ERR = {
    no_key: "No odds API key is saved in Script Properties.",
    credits_low: "Credits are low, so the script stopped calling the odds service.",
    locked: "Too many wrong PIN tries. Locked for 5 minutes."
};
async function checkOdds() {
    const box = $("odds-status");
    box.textContent = "Checking\u2026";
    try {
        const s = await Odds.status();
        const line = lg => s.lastPull?.[lg] ? Odds.pulledAt(s.lastPull[lg]) : "never";
        box.innerHTML = `<b>${s.remaining ?? "?"}</b> credits left this month${s.used != null ? " (" + s.used + " used)" : ""}<br>
            Last pull: NFL <b>${esc(line("nfl"))}</b> \u00b7 College <b>${esc(line("ncaaf"))}</b><br>
            Daily timer: <b>${s.timer === true ? "running" : s.timer === false ? "NOT installed (run installOddsTrigger in Apps Script)" : "unknown"}</b>`;
    } catch (e) { box.textContent = ODDS_ERR[e.message] || "Couldn't reach the odds service (" + e.message + ")."; }
}
$("odds-check").onclick = checkOdds;
$("odds-pull").onclick = async () => {
    const msg = $("odds-msg"), btn = $("odds-pull");
    if (!confirm("Pull odds for NFL and college now? This uses about 6 of your monthly credits.")) return;
    btn.disabled = true; msg.textContent = "Pulling\u2026";
    try {
        const r = await Store.adminPost({ action: "oddsRefresh" });
        msg.textContent = "Pulled: " + (r.pulled || []).map(p => p.league.toUpperCase() + " " + p.games + " games").join(", ") + ".";
        checkOdds();
    } catch (e) { msg.textContent = ODDS_ERR[e.message] || (e.message === "forbidden" ? "The PIN was refused." : "Pull failed (" + e.message + ")."); }
    btn.disabled = false;
};

/* ---------- Backup ---------- */
$("export").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([Store.exportData()], { type: "application/json" }));
    a.download = `buddies-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
    $("data-msg").textContent = "Backup downloaded.";
};
$("import").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
        if (!confirm("Importing replaces all current profiles and bets. Continue?")) return;
        Store.importData(await f.text());
        $("data-msg").textContent = "Backup imported.";
        renderProfiles(); renderBets();
    } catch (err) { $("data-msg").textContent = err.message; }
    e.target.value = "";
};

/* ---------- Squares boards ---------- */
const SQ_IVS = [["q1", "End of Q1", 25], ["q2", "Halftime", 25], ["q3", "End of Q3", 25], ["final", "Final", 25]];
let sqGames = [];
$("sqf-ivs").innerHTML = SQ_IVS.map(([k, l, p]) => `<div class="iv"><label><input type="checkbox" data-iv="${k}" checked> ${l}</label>
    <input type="number" min="0" max="100" step="1" value="${p}" data-pct="${k}" aria-label="${l} share %"> %</div>`).join("");

const SQ_PRESETS = { quarters: { q1: 25, q2: 25, q3: 25, final: 25 }, halves: { q2: 50, final: 50 }, full: { final: 100 } };
function applyPreset() {
    const p = SQ_PRESETS[$("sqf-preset").value]; if (!p) return;
    SQ_IVS.forEach(([k]) => {
        document.querySelector(`[data-iv="${k}"]`).checked = k in p;
        document.querySelector(`[data-pct="${k}"]`).value = p[k] ?? 0;
    });
}
$("sqf-preset").onchange = applyPreset;
$("sqf-ivs").addEventListener("input", () => { $("sqf-preset").value = "custom"; });      // hand edits switch it to Custom
async function loadSqGames() {
    const lg = $("sqf-league").value, custom = lg === "custom";
    $("sqf-game-wrap").hidden = custom; $("sqf-custom").hidden = !custom; $("sqf-start-wrap").hidden = !custom;
    if (custom) return;
    $("sqf-game").innerHTML = `<option>Loading&hellip;</option>`;
    try {
        sqGames = await Live.games(lg);
        $("sqf-game").innerHTML = sqGames.length
            ? sqGames.map((g, i) => `<option value="${i}">${esc(g.label)} · ${esc(g.detail)}</option>`).join("")
            : `<option value="">No upcoming games found</option>`;
    } catch { $("sqf-game").innerHTML = `<option value="">Couldn't load games</option>`; sqGames = []; }
}
$("sqf-league").onchange = loadSqGames;

$("sq-form").onsubmit = e => {
    e.preventDefault();
    const err = $("sqf-error"); err.textContent = "";
    const price = Number($("sqf-price").value);
    if (!(price >= 0)) return void (err.textContent = "Enter a price per square.");
    const intervals = SQ_IVS.filter(([k]) => document.querySelector(`[data-iv="${k}"]`).checked)
        .map(([k, l]) => ({ key: k, label: l, pct: Number(document.querySelector(`[data-pct="${k}"]`).value) || 0 }));
    if (!intervals.length) return void (err.textContent = "Pick at least one interval.");
    if (Math.abs(intervals.reduce((s, i) => s + i.pct, 0) - 100) > 0.001) return void (err.textContent = "The shares have to add up to 100%.");
    let b;
    if ($("sqf-league").value === "custom") {
        const a = $("sqf-away").value.trim(), h = $("sqf-home").value.trim();
        if (!a || !h) return void (err.textContent = "Enter both team names.");
        const st = $("sqf-start").value ? Date.parse($("sqf-start").value) : NaN;
        if ($("sqf-auto").checked && !Number.isFinite(st)) return void (err.textContent = "Enter the game start so the numbers know when to draw.");
        b = { start: Number.isFinite(st) ? new Date(st).toISOString() : null, name: `${a} vs ${h}`, away: { abbr: a.slice(0, 4).toUpperCase(), name: a }, home: { abbr: h.slice(0, 4).toUpperCase(), name: h } };
    } else {
        const g = sqGames[Number($("sqf-game").value)];
        if (!g) return void (err.textContent = "Pick a game.");
        const [a, h] = g.teams;
        b = { name: g.label, league: $("sqf-league").value, gameId: g.id, start: g.start,
              away: { abbr: a.abbr, name: a.name }, home: { abbr: h.abbr, name: h.name } };
    }
    const startMs = b.start ? Date.parse(b.start) : NaN;
    const drawAt = $("sqf-auto").checked && Number.isFinite(startMs) ? startMs - 24 * 3600000 : null;
    if ($("sqf-auto").checked && drawAt === null) return void (err.textContent = "That game has no start time, so it can't auto-draw. Untick the box to draw by hand.");
    Store.saveSquareBoard({ ...b, drawAt, price, intervals, per: Number($("sqf-per").value) === 2 ? 2 : 1, numbers: null, manual: {} });
    $("sqf-away").value = $("sqf-home").value = "";
    renderSquares();
};

const shuffle = () => { const a = [...Array(10).keys()]; for (let i = 9; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function renderSquares() {
    const boards = Store.squareBoards();
    $("sq-list").innerHTML = boards.map(b => {
        const sold = Object.keys(Store.squareClaims(b.id)).length, total = b.per === 2 ? 25 : 100;
        return `<div class="sq-admin" data-id="${esc(b.id)}">
            <div><b>${esc(b.name)}</b> <span class="muted">· $${b.price}/square · ${sold}/${total} sold · ${b.numbers ? "numbers drawn (locked)" : b.drawAt ? "open until " + new Date(b.drawAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " (auto-draw)" : "open (draw by hand)"}</span></div>
            <div class="row-btns">
                <button class="btn primary" data-act="draw" type="button">${b.numbers ? "Redraw numbers" : "Draw numbers &amp; lock"}</button>
                ${b.numbers ? `<button class="btn ghost" data-act="clear" type="button">Clear numbers (reopen)</button>` : ""}
                <button class="btn danger" data-act="del" type="button">Delete board</button>
            </div>
            <div class="hint">${b.league ? "Scores come from ESPN. " : ""}Type a score here to override it (or to call the interval by hand):</div>
            ${b.intervals.map(iv => { const m = b.manual?.[iv.key] || []; return `<div class="iv">${esc(iv.label)}:
                ${esc(b.away.abbr)} <input type="number" min="0" data-m="${iv.key}:0" value="${m[0] ?? ""}">
                ${esc(b.home.abbr)} <input type="number" min="0" data-m="${iv.key}:1" value="${m[1] ?? ""}"></div>`; }).join("")}
        </div>`;
    }).join("") || `<div class="empty">No boards yet.</div>`;
}
$("sq-list").onclick = e => {
    const act = e.target.dataset.act; if (!act) return;
    const id = e.target.closest(".sq-admin").dataset.id, b = Store.squareBoard(id);
    if (act === "del") { if (confirm(`Delete "${b.name}" and all its claimed squares? This can't be undone.`)) Store.deleteSquareBoard(id); }
    else if (act === "draw") {
        if (b.numbers && !confirm("Draw new numbers? The old ones are lost.")) return;
        Store.saveSquareBoard({ ...b, numbers: { away: shuffle(), home: shuffle() } });
    } else if (act === "clear") Store.saveSquareBoard({ ...b, numbers: null, drawAt: null });          // reopened by hand, so no auto-draw
    renderSquares();
};
$("sq-list").onchange = e => {
    const k = e.target.dataset.m; if (!k) return;
    const [key, side] = k.split(":"), id = e.target.closest(".sq-admin").dataset.id, b = Store.squareBoard(id);
    const manual = { ...(b.manual || {}) }, cur = [...(manual[key] || [null, null])];
    cur[Number(side)] = e.target.value === "" ? null : Number(e.target.value);
    if (cur[0] === null && cur[1] === null) delete manual[key]; else manual[key] = cur;
    Store.saveSquareBoard({ ...b, manual });
};
window.addEventListener("storage", () => { if (!$("tools").hidden && !$("sq-list").contains(document.activeElement)) renderSquares(); });

showGate();
