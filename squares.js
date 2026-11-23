/* ============================================================
   Squares: a 10 x 10 board. Away team's digits run across the top, home team's down the side.
   Buddies claim squares, an admin draws the numbers (which locks the board), then the score
   at each chosen interval (Q1, half, Q3, final) picks the winning square: last digit of each score.
   ============================================================ */
const $ = id => document.getElementById(id);
const { esc } = Store;
const money = n => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const PERIOD = { q1: 1, q2: 2, q3: 3, final: 4 };
const readLS = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

let boardId = readLS("bwmb.sqBoard", ""), me = readLS("bwmb.sqProfile", "");
const scores = {};                       // boardId -> { state, period, away: [per-period], home: [...], awayTotal, homeTotal }

/* ---------- ESPN score for a linked game ---------- */
async function loadScore(b) {
    if (!b.league || !b.gameId) return;
    try {
        const path = Live.LEAGUES[b.league].path;
        const d = await Live.getJSON(Live.url(b.league, `${path}/summary?event=${encodeURIComponent(b.gameId)}`), 20000);
        const comp = d.header?.competitions?.[0]; if (!comp) return;
        const side = ha => comp.competitors.find(c => c.homeAway === ha) || {};
        const lines = c => (c.linescores || []).map(l => Number(l.value ?? l.displayValue) || 0);
        const a = side("away"), h = side("home");
        scores[b.id] = { state: comp.status?.type?.state || "pre", period: comp.status?.period || 0,
            away: lines(a), home: lines(h), awayTotal: Number(a.score) || 0, homeTotal: Number(h.score) || 0 };
    } catch (e) { console.error("squares", e); }
}

/* Score [away, home] at the end of an interval, or null if it hasn't happened yet. An admin's typed score wins. */
function scoreAt(b, iv) {
    const m = b.manual?.[iv.key];
    if (m && Number.isFinite(m[0]) && Number.isFinite(m[1])) return m;
    const s = scores[b.id]; if (!s) return null;
    const n = PERIOD[iv.key] || 4;
    if (iv.key === "final") return s.state === "post" ? [s.awayTotal, s.homeTotal] : null;
    if (s.state !== "post" && s.period <= n) return null;       // that period is not finished yet
    const sum = arr => arr.slice(0, n).reduce((x, y) => x + y, 0);
    return [sum(s.away), sum(s.home)];
}

/* per = digits covered by each row/column: 1 gives a 10 x 10 board, 2 gives 5 x 5 with two digits per row and column. */
const sizeOf = b => 10 / (b.per === 2 ? 2 : 1);
const perOf = b => (b.per === 2 ? 2 : 1);
function owner(b, claims, sc) {
    if (!b.numbers || !sc) return null;
    const S = sizeOf(b), per = perOf(b);
    const col = Math.floor(b.numbers.away.indexOf(sc[0] % 10) / per), row = Math.floor(b.numbers.home.indexOf(sc[1] % 10) / per);
    return b.numbers.away.indexOf(sc[0] % 10) < 0 || b.numbers.home.indexOf(sc[1] % 10) < 0 ? null : { n: row * S + col, pid: claims[row * S + col] || null };
}
const label = (b, side, i) => b.numbers ? b.numbers[side].slice(i * perOf(b), i * perOf(b) + perOf(b)).join(" · ") : "?";

/* ---------- Page ---------- */
function render() {
    const boards = Store.squareBoards();
    if (!boards.some(b => b.id === boardId)) boardId = boards[0]?.id || "";
    $("sq-board").innerHTML = boards.length ? boards.map(b => `<option value="${esc(b.id)}" ${b.id === boardId ? "selected" : ""}>${esc(b.name)}</option>`).join("")
        : `<option value="">No boards yet</option>`;
    const ps = Store.profiles();
    if (!ps.some(p => p.id === me)) me = "";
    $("sq-profile").innerHTML = `<option value="">Choose&hellip;</option>` + ps.map(p => `<option value="${p.id}" ${p.id === me ? "selected" : ""}>${esc(p.name)}</option>`).join("");

    const b = Store.squareBoard(boardId);
    $("sq-win-panel").hidden = $("sq-owe-panel").hidden = !b;
    if (!b) {
        $("sq-title").textContent = "No board yet";
        $("sq-info").textContent = "";
        $("sq-rules").textContent = "";
        $("sq-grid-wrap").innerHTML = `<div class="empty">No squares board has been set up. An admin creates one on the Admin page.</div>`;
        return;
    }
    const S = sizeOf(b), total = S * S, idx = [...Array(S).keys()];
    const claims = Store.squareClaims(b.id), sold = Object.keys(claims).length, pot = sold * b.price;
    $("sq-title").textContent = b.name;
    $("sq-info").textContent = `${sold}/${total} sold · pot ${money(pot)}`;
    $("sq-rules").textContent = b.numbers
        ? "Numbers are drawn and the squares are locked. The last digit of each team's score at each interval picks the winner."
        : Store.sqLocked(b) ? "Picking is closed. The numbers are being drawn."
        : `Squares are ${money(b.price)} each. Tap an empty square to claim it, tap yours to give it back. ${b.drawAt ? "The numbers are drawn at random on " + new Date(b.drawAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " (1 day before the game), and that locks the board." : "The admin draws the numbers when the board is ready, which locks it."}`;

    // winners per interval
    const wins = (b.intervals || []).map(iv => {
        const sc = scoreAt(b, iv), o = owner(b, claims, sc);
        return { iv, sc, o, prize: pot * iv.pct / 100 };
    });
    const winSq = new Set(wins.filter(w => w.o).map(w => w.o.n));

    const head = `<tr><th class="sq-corner"></th>${idx.map(c => `<th class="sq-top">${label(b, "away", c)}</th>`).join("")}</tr>`;
    const rows = idx.map(r => `<tr><th class="sq-side">${label(b, "home", r)}</th>${idx.map(c => {
        const n = r * S + c, pid = claims[n], p = pid && Store.profile(pid);
        const cls = ["sq-cell", pid ? "taken" : "free", pid === me ? "mine" : "", winSq.has(n) ? "win" : ""].join(" ");
        return `<td><button type="button" class="${cls}" data-n="${n}" ${p ? `style="--c:${esc(p.color)}"` : ""} title="${p ? esc(p.name) : "Open"}">${p ? esc(p.name.slice(0, 3)) : ""}</button></td>`;
    }).join("")}</tr>`).join("");
    $("sq-grid-wrap").innerHTML = `<div class="sq-axis"><span>${esc(b.away.name)} &rarr;</span></div>
        <div class="sq-flex"><div class="sq-axis-v"><span>${esc(b.home.name)} &darr;</span></div>
        <table class="sq-grid ${S === 5 ? "big" : ""}"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;

    $("sq-winners").innerHTML = `<tr><th>Interval</th><th>Share</th><th>Prize</th><th>Score</th><th>Winner</th></tr>` + wins.map(w => {
        const sc = w.sc ? `${esc(b.away.abbr)} ${w.sc[0]} – ${esc(b.home.abbr)} ${w.sc[1]}` : "—";
        const who = !b.numbers ? "Numbers not drawn" : !w.sc ? "Not reached yet" : w.o?.pid ? `<b style="color:${esc(Store.profile(w.o.pid)?.color || "#aaa")}">${esc(Store.profile(w.o.pid)?.name || "Unknown")}</b>` : "Unsold square";
        return `<tr><td>${esc(w.iv.label)}</td><td>${w.iv.pct}%</td><td>${money(w.prize)}</td><td>${sc}</td><td>${who}</td></tr>`;
    }).join("");

    const tally = {};
    Object.values(claims).forEach(pid => (tally[pid] ||= { sq: 0, won: 0 }).sq++);
    wins.forEach(w => { if (w.o?.pid) (tally[w.o.pid] ||= { sq: 0, won: 0 }).won += w.prize; });
    const net = x => x.won - x.sq * b.price;
    const list = Object.entries(tally).map(([pid, t]) => ({ p: Store.profile(pid), ...t })).filter(x => x.p).sort((x, y) => net(y) - net(x));
    $("sq-owes").innerHTML = `<tr><th>Player</th><th>Squares</th><th>Owes</th><th>Won</th><th>Net</th></tr>` + (list.length ? list.map(x =>
        `<tr><td><b style="color:${esc(x.p.color)}">${esc(x.p.name)}</b></td><td>${x.sq}</td><td>${money(x.sq * b.price)}</td><td>${money(x.won)}</td><td style="color:var(--${net(x) >= 0 ? "green" : "red"})">${money(net(x))}</td></tr>`
    ).join("") : `<tr><td colspan="5" class="muted">No squares claimed yet.</td></tr>`);
}

$("sq-board").onchange = e => { boardId = e.target.value; writeLS("bwmb.sqBoard", boardId); $("sq-error").textContent = ""; refresh(); };
$("sq-profile").onchange = e => { me = e.target.value; writeLS("bwmb.sqProfile", me); render(); };
$("sq-grid-wrap").onclick = e => {
    const btn = e.target.closest(".sq-cell"); if (!btn) return;
    $("sq-error").textContent = "";
    const n = Number(btn.dataset.n), claims = Store.squareClaims(boardId);
    try {
        if (!me) throw new Error("Pick your profile first.");
        if (claims[n] === me) Store.releaseSquare(boardId, n, me);
        else if (claims[n]) throw new Error("That square belongs to " + (Store.profile(claims[n])?.name || "someone else") + ".");
        else Store.claimSquare(boardId, n, me);
    } catch (err) { $("sq-error").textContent = err.message; }
    render();
};

async function refresh() { await Store.autoDrawSquares(); render(); const b = Store.squareBoard(boardId); if (b) { await loadScore(b); render(); } }
window.addEventListener("storage", render);          // a sync pull brought new claims
refresh();
setInterval(() => { Store.autoDrawSquares().then(render); const b = Store.squareBoard(boardId); if (b && !document.hidden) loadScore(b).then(render); }, 60000);
