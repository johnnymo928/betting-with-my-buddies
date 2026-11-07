const $ = id => document.getElementById(id);
const { esc, money, betStatus, betProfit } = Store;
const pct = (a, b) => b ? Math.round(a / b * 100) + "%" : "–";
const sgn = n => (n > 0 ? "pos" : n < 0 ? "neg" : "");

/* ---------- Stats for a list of bets ---------- */
function stats(bets) {
    const settled = bets.filter(b => betStatus(b) !== "pending");
    const won = settled.filter(b => betStatus(b) === "won");
    const lost = settled.filter(b => betStatus(b) === "lost");
    // Private bets count in records and hit rates but never in dollar figures.
    const open = settled.filter(b => !b.private);
    const hiddenSettled = settled.length - open.length;
    const staked = open.reduce((s, b) => s + b.stake, 0);
    const profit = open.reduce((s, b) => s + betProfit(b), 0);

    const parlays = bets.filter(b => b.type === "parlay");
    const parlaysSettled = parlays.filter(b => betStatus(b) !== "pending");
    const legs = parlays.flatMap(b => b.legs).filter(l => l.status !== "pending");
    const legsHit = legs.filter(l => l.status === "won").length;

    // oldest -> newest for streaks
    const chrono = settled.slice().sort((a, b) => a.createdAt - b.createdAt);
    let streak = 0, streakType = "";
    for (let i = chrono.length - 1; i >= 0; i--) {
        const t = betStatus(chrono[i]);
        if (!streakType) streakType = t;
        if (t !== streakType) break;
        streak++;
    }

    const bestWin = won.filter(b => !b.private).reduce((m, b) => Math.max(m, betProfit(b)), 0);
    return {
        hiddenSettled,
        total: bets.length, pending: bets.length - settled.length,
        won: won.length, lost: lost.length, staked, profit,
        roi: staked ? profit / staked * 100 : null,
        parlays: parlays.length,
        parlayWon: parlaysSettled.filter(b => betStatus(b) === "won").length,
        parlayLost: parlaysSettled.filter(b => betStatus(b) === "lost").length,
        legsHit, legsSettled: legs.length,
        streak, streakType, bestWin, chrono
    };
}

/* ---------- Render ---------- */
function render() {
    const ps = Store.profiles();
    const sel = $("scope");
    const cur = sel.value;
    sel.innerHTML = `<option value="">Everyone</option>` + ps.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    sel.value = ps.some(p => p.id === cur) ? cur : "";

    const all = Store.bets();
    const mine = sel.value ? all.filter(b => b.profileId === sel.value) : all;
    $("scope-title").textContent = sel.value ? Store.profile(sel.value).name : "Everyone";
    const s = stats(mine);

    $("tiles").innerHTML = all.length ? [
        ["Bets", s.total, s.pending ? `${s.pending} pending` : "all settled"],
        ["Record", `${s.won}-${s.lost}`, `${pct(s.won, s.won + s.lost)} win rate`],
        ["Profit", money(s.profit), s.hiddenSettled ? `excludes ${s.hiddenSettled} private` : "", sgn(s.profit)],
        ["ROI", s.roi === null ? "–" : s.roi.toFixed(1) + "%", `on ${money(s.staked)} staked`, s.roi === null ? "" : sgn(s.roi)],
        ["Streak", s.streak ? `${s.streak}${s.streakType === "won" ? "W" : "L"}` : "–", "current", s.streakType === "won" ? "pos" : s.streakType === "lost" ? "neg" : ""],
        ["Best Win", s.bestWin ? money(s.bestWin) : "–", "single bet", s.bestWin ? "pos" : ""]
    ].map(([k, v, sub, cls]) => `
        <div class="tile"><span class="tile-k">${k}</span><span class="tile-v ${cls || ""}">${v}</span><span class="tile-s">${sub}</span></div>`).join("")
        : `<div class="empty">No bets yet. <a href="bet.html">Place the first one</a> and insights will appear here.</div>`;

    /* Leaderboard (always shows everyone) */
    const rows = ps.map(p => ({ p, s: stats(all.filter(b => b.profileId === p.id)) }))
        .sort((a, b) => b.s.profit - a.s.profit);
    $("board").innerHTML = rows.length ? `
        <thead><tr><th>#</th><th>Player</th><th>Record</th><th>Win %</th><th>Parlays</th><th>Profit</th><th>ROI</th></tr></thead>
        <tbody>${rows.map(({ p, s }, i) => `
            <tr>
                <td>${i + 1}</td>
                <td><span class="who"><i style="background:${esc(p.color)}"></i>${esc(p.name)}</span></td>
                <td>${s.won}-${s.lost}${s.pending ? ` <span class="muted">(${s.pending})</span>` : ""}</td>
                <td>${pct(s.won, s.won + s.lost)}</td>
                <td>${s.parlayWon}-${s.parlayLost}</td>
                <td class="${sgn(s.profit)}">${money(s.profit)}</td>
                <td class="${s.roi === null ? "" : sgn(s.roi)}">${s.roi === null ? "–" : s.roi.toFixed(1) + "%"}</td>
            </tr>`).join("")}</tbody>` : `<tbody><tr><td class="muted">No profiles yet.</td></tr></tbody>`;

    /* Parlay hit/fail */
    $("parlay-stats").innerHTML = s.parlays ? `
        <div class="bars">
            ${bar("Parlays won", s.parlayWon, s.parlayWon + s.parlayLost, "pos")}
            ${bar("Legs that hit", s.legsHit, s.legsSettled, "pos")}
        </div>
        <p class="hint">${s.parlays} parlay${s.parlays > 1 ? "s" : ""} placed. ${s.parlayWon}-${s.parlayLost} settled.
        ${s.legsSettled ? `Individual legs hit ${pct(s.legsHit, s.legsSettled)} of the time.` : ""}</p>`
        : `<div class="empty">No parlays yet.</div>`;

    /* Form strip + notes */
    const last = s.chrono.slice(-10);
    $("form-strip").innerHTML = last.length
        ? `<div class="strip">${last.map(b => `<span class="dot ${betStatus(b)}" title="${esc(b.legs.map(l => l.text).join(" + "))}">${betStatus(b) === "won" ? "W" : "L"}</span>`).join("")}</div>`
        : `<div class="empty">Nothing settled yet.</div>`;
    $("notes").innerHTML = notes(mine, s).map(n => `<p>${n}</p>`).join("");

    /* Hit rate by bet type: every settled leg, grouped by spread / ML / total / each prop stat */
    const KIND = { spread: "Spread", ml: "Moneyline", total: "Game total" };
    const groups = {};
    mine.flatMap(b => b.legs).filter(l => l.status !== "pending").forEach(l => {
        const k = !l.pick ? "Custom" : l.pick.kind === "prop" ? "Prop: " + l.pick.statLabel : KIND[l.pick.kind];
        const g = groups[k] ||= { hit: 0, n: 0 };
        g.n++; if (l.status === "won") g.hit++;
    });
    const trows = Object.entries(groups).sort((a, b) => b[1].n - a[1].n);
    $("types").innerHTML = trows.length ? `
        <thead><tr><th>Type</th><th>Legs</th><th>Hit</th><th>Hit %</th></tr></thead>
        <tbody>${trows.map(([k, g]) => `<tr><td>${esc(k)}</td><td>${g.n}</td><td>${g.hit}</td><td>${pct(g.hit, g.n)}</td></tr>`).join("")}</tbody>`
        : `<tbody><tr><td class="muted">Nothing settled yet.</td></tr></tbody>`;

    /* Results by sportsbook (private bets count in the record but not in dollars) */
    $("books").closest("section").hidden = !Odds.enabled;       // hidden while odds are off
    const byBook = {};
    mine.filter(b => betStatus(b) !== "pending").forEach(b => {
        const k = b.book ? Odds.bookLabel(b.book) : "Not specified";
        const g = byBook[k] ||= { won: 0, lost: 0, profit: 0, staked: 0 };
        betStatus(b) === "won" ? g.won++ : g.lost++;
        if (!b.private) { g.profit += betProfit(b); g.staked += b.stake; }
    });
    const brows = Object.entries(byBook).sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost));
    $("books").innerHTML = brows.length ? `
        <thead><tr><th>Sportsbook</th><th>Record</th><th>Win %</th><th>Profit</th><th>ROI</th></tr></thead>
        <tbody>${brows.map(([k, g]) => `<tr>
            <td>${esc(k)}</td><td>${g.won}-${g.lost}</td><td>${pct(g.won, g.won + g.lost)}</td>
            <td class="${sgn(g.profit)}">${money(g.profit)}</td>
            <td class="${g.staked ? sgn(g.profit) : ""}">${g.staked ? (g.profit / g.staked * 100).toFixed(1) + "%" : "–"}</td></tr>`).join("")}</tbody>`
        : `<tbody><tr><td class="muted">Nothing settled yet.</td></tr></tbody>`;

    /* Killers: lost parlays and which leg(s) failed */
    const dead = mine.filter(b => b.type === "parlay" && betStatus(b) === "lost")
        .sort((a, b) => b.createdAt - a.createdAt);
    $("killers").innerHTML = dead.length ? dead.map(b => {
        const failed = b.legs.filter(l => l.status === "lost");
        const hit = b.legs.filter(l => l.status === "won").length;
        const near = failed.length === 1 && hit === b.legs.length - 1;
        const who = Store.profile(b.profileId);
        return `<div class="killer">
            <span class="who"><i style="background:${esc(who?.color || "#888")}"></i>${esc(who?.name || "Unknown")}</span>
            <span>${b.legs.length}-leg parlay, ${hit} hit</span>
            <span class="neg">${failed.map(l => "✗ " + esc(l.text)).join(", ")}</span>
            ${near ? `<span class="badge pre">1 leg away</span>` : ""}
        </div>`;
    }).join("") : `<div class="empty">No busted parlays.</div>`;
    if (window.renderWeekly) window.renderWeekly();     // weekly board, badges, shame, recap (weekly.js)
}

function bar(label, n, d, cls) {
    const w = d ? Math.round(n / d * 100) : 0;
    return `<div class="bar"><div class="bar-label"><span>${label}</span><span>${n}/${d} &middot; ${pct(n, d)}</span></div>
        <div class="bar-track"><div class="bar-fill ${cls}" style="width:${w}%"></div></div></div>`;
}

function notes(bets, s) {
    const out = [];
    if (s.won + s.lost >= 3) {
        const singles = bets.filter(b => b.type === "single" && betStatus(b) !== "pending");
        const sw = singles.filter(b => betStatus(b) === "won").length;
        const pw = s.parlayWon, pl = s.parlayLost;
        if (singles.length && pw + pl) {
            const sr = sw / singles.length, pr = pw / (pw + pl);
            out.push(sr > pr ? `Singles are doing the work: ${pct(sw, singles.length)} vs ${pct(pw, pw + pl)} on parlays.`
                : `Parlays are hitting more than singles: ${pct(pw, pw + pl)} vs ${pct(sw, singles.length)}.`);
        }
    }
    const near = bets.filter(b => b.type === "parlay" && betStatus(b) === "lost" &&
        b.legs.filter(l => l.status === "lost").length === 1 &&
        b.legs.filter(l => l.status === "won").length === b.legs.length - 1).length;
    if (near) out.push(`${near} parlay${near > 1 ? "s were" : " was"} lost by exactly one leg.`);
    if (s.streak >= 3) out.push(`${s.streak} ${s.streakType === "won" ? "wins" : "losses"} in a row.`);
    return out.length ? out : ["More settled bets will unlock more insights."];
}

$("scope").onchange = render;
window.addEventListener("storage", () => { Store.reload(); render(); });
render();
