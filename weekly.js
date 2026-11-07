/* ============================================================
   Weekly + season board, badges, Wall of Shame and the weekly recap.
   Everything here is worked out from the bets already in Store, nothing extra is saved.
   A "week" runs Tuesday to Monday, which matches the NFL week (Thursday through Monday night games).
   A bet counts in the week it was settled (decided), not the week it was placed.
   ============================================================ */
(() => {
    const $ = id => document.getElementById(id);
    const { esc, money, betStatus, betProfit } = Store;
    const DAY = 864e5;
    const sgn = n => (n > 0 ? "pos" : n < 0 ? "neg" : "");
    const day = ts => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const who = id => Store.profile(id)?.name || "Someone";
    const desc = b => (b.type === "parlay" ? `${b.legs.length}-leg parlay` : b.legs[0].text);
    const BUYIN = typeof WEEKLY_BUYIN !== "undefined" ? Number(WEEKLY_BUYIN) || 0 : 0;

    // Tuesday 00:00 (local time) on or before ts
    function weekStart(ts) {
        const d = new Date(ts); d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - ((d.getDay() + 5) % 7));
        return d.getTime();
    }

    // when a bet was decided: a loss counts when its first missed leg settled, a win when its last leg did
    function decidedAt(b) {
        if (betStatus(b) === "lost") {
            const t = b.legs.filter(l => l.status === "lost" && l.settledAt).map(l => l.settledAt);
            return t.length ? Math.min(...t) : b.createdAt;
        }
        const t = b.legs.map(l => l.settledAt).filter(Boolean);
        return t.length === b.legs.length ? Math.max(...t) : b.createdAt;
    }
    const settled = () => Store.bets().filter(b => betStatus(b) !== "pending").map(b => ({ b, at: decidedAt(b) }));

    /* ---------- the week picker ---------- */
    function windowOf(value, items) {
        if (value === "all") return { all: true, label: "Season", from: 0, to: Infinity };
        const from = Number(value) || weekStart(Date.now());
        const to = from + 7 * DAY, cur = weekStart(Date.now());
        return { all: false, from, to, current: from === cur, label: `Week of ${day(from)} – ${day(to - 1)}` };
    }
    const inWindow = (items, w) => w.all ? items : items.filter(x => x.at >= w.from && x.at < w.to);

    /* ---------- the board ---------- */
    function board(items) {
        return Store.profiles().map(p => {
            const mine = items.filter(x => x.b.profileId === p.id);
            const won = mine.filter(x => betStatus(x.b) === "won").length;
            const pub = mine.filter(x => !x.b.private);
            return { p, n: mine.length, won, lost: mine.length - won,
                profit: pub.reduce((s, x) => s + betProfit(x.b), 0), priv: mine.length - pub.length };
        }).filter(r => r.n).sort((a, b) => b.profit - a.profit || b.won - a.won);
    }
    const winners = rows => rows.length && rows[0].profit > 0 ? rows.filter(r => r.profit === rows[0].profit) : [];

    // completed weeks: who won each, and what the pot paid
    function seasonRecord(items) {
        const cur = weekStart(Date.now()), weeks = {}, rec = {};
        items.forEach(x => { const w = weekStart(x.at); if (w < cur) (weeks[w] ||= []).push(x); });
        Object.values(weeks).forEach(list => {
            const rows = board(list), win = winners(rows);
            const pot = BUYIN * rows.length;
            win.forEach(r => {
                const o = rec[r.p.id] ||= { weeks: 0, pot: 0 };
                o.weeks++; o.pot += pot / win.length;
            });
        });
        return rec;
    }

    /* ---------- streaks ---------- */
    function streaks(items, profileId) {
        const seq = items.filter(x => x.b.profileId === profileId).sort((a, b) => a.at - b.at).map(x => betStatus(x.b));
        let cur = 0, curType = "", best = 0, run = 0, prev = "";
        seq.forEach(t => { run = t === prev ? run + 1 : 1; prev = t; if (t === "won") best = Math.max(best, run); });
        for (let i = seq.length - 1; i >= 0; i--) { if (!curType) curType = seq[i]; if (seq[i] !== curType) break; cur++; }
        return { cur, curType, best };
    }

    /* ---------- badges ---------- */
    function badges(items, rec) {
        const out = {}, add = (id, icon, name, why) => (out[id] ||= []).push({ icon, name, why });
        const ps = Store.profiles();
        const stat = ps.map(p => {
            const mine = items.filter(x => x.b.profileId === p.id).map(x => x.b);
            const parlays = mine.filter(b => b.type === "parlay");
            const oneAway = parlays.filter(b => betStatus(b) === "lost" && b.legs.filter(l => l.status === "lost").length === 1 &&
                b.legs.some(l => l.status === "won")).length;
            const placed = Store.bets().filter(b => b.profileId === p.id).length;
            const big = mine.filter(b => !b.private && betStatus(b) === "won").reduce((m, b) => Math.max(m, betProfit(b)), 0);
            return { p, settled: mine.length, won: mine.filter(b => betStatus(b) === "won").length,
                parlaysWon: parlays.filter(b => betStatus(b) === "won").length, oneAway, placed, big, st: streaks(items, p.id) };
        });
        const top = (key, min) => {            // everyone tied for the best score, if it clears the minimum
            const m = Math.max(0, ...stat.map(s => s[key]));
            return m >= min ? stat.filter(s => s[key] === m) : [];
        };
        stat.forEach(s => {
            if (s.st.curType === "won" && s.st.cur >= 3) add(s.p.id, "🔥", s.st.cur >= 5 ? "On fire" : "Hot hand", `${s.st.cur} wins in a row`);
            if (s.st.curType === "lost" && s.st.cur >= 3) add(s.p.id, "🧊", "Ice cold", `${s.st.cur} losses in a row`);
            if (s.st.best >= 3) add(s.p.id, "📈", "Best run", `${s.st.best} wins in a row at its best`);
            if (rec[s.p.id]?.weeks) add(s.p.id, "🏆", "Weekly champ", `won ${rec[s.p.id].weeks} week${rec[s.p.id].weeks > 1 ? "s" : ""}`);
        });
        top("parlaysWon", 1).forEach(s => add(s.p.id, "👑", "Parlay king", `${s.parlaysWon} parlay${s.parlaysWon > 1 ? "s" : ""} cashed`));
        top("oneAway", 1).forEach(s => add(s.p.id, "😬", "So close", `${s.oneAway} parlay${s.oneAway > 1 ? "s" : ""} lost by one leg`));
        top("placed", 5).forEach(s => add(s.p.id, "🎰", "Degen", `${s.placed} bets placed`));
        top("big", 1).forEach(s => add(s.p.id, "💎", "Big win", `${money(s.big)} on one bet`));
        const eligible = stat.filter(s => s.settled >= 5);
        if (eligible.length) {
            const m = Math.max(...eligible.map(s => s.won / s.settled));
            eligible.filter(s => s.won / s.settled === m && m > 0).forEach(s =>
                add(s.p.id, "🎯", "Sharpshooter", `${Math.round(m * 100)}% win rate`));
        }
        return out;
    }

    /* ---------- Wall of Shame ---------- */
    function shame(items) {
        const lost = items.filter(x => betStatus(x.b) === "lost").map(x => x.b);
        const out = [];
        const big = lost.filter(b => !b.private).sort((a, b) => b.stake - a.stake)[0];
        if (big) out.push({ icon: "💸", title: "Biggest loss", who: who(big.profileId),
            text: `lost ${money(big.stake)} on ${desc(big)}`, bet: big });
        const beats = lost.filter(b => b.type === "parlay" && b.legs.filter(l => l.status === "lost").length === 1 && b.legs.some(l => l.status === "won"))
            .sort((a, b) => b.legs.filter(l => l.status === "won").length - a.legs.filter(l => l.status === "won").length)[0];
        if (beats) out.push({ icon: "😭", title: "Worst beat", who: who(beats.profileId),
            text: `had ${beats.legs.length - 1} of ${beats.legs.length} legs, then lost on "${beats.legs.find(l => l.status === "lost").text}"`, bet: beats });
        const counts = {};
        lost.forEach(b => counts[b.profileId] = (counts[b.profileId] || 0) + 1);
        const worst = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (worst && worst[1] >= 2) out.push({ icon: "🪦", title: "Most losses", who: who(worst[0]),
            text: `took ${worst[1]} losses`, bet: lost.find(b => b.profileId === worst[0]) });
        return out;
    }

    /* ---------- the recap text ---------- */
    function recap(items, w, rows, rec) {
        const L = [];
        L.push(`🏈 BETTING WITH BUDDIES · ${w.label}`);
        L.push("");
        const win = winners(rows);
        if (win.length) {
            const pot = BUYIN > 0 ? ` and the ${money(BUYIN * rows.length)} pot${win.length > 1 ? " (split)" : ""}` : "";
            L.push(`${w.current ? "👑 Leading" : "🏆 Champion"}: ${win.map(r => r.p.name).join(" & ")} at ${money(win[0].profit)}${w.current ? "" : pot}`);
        } else L.push(rows.length ? "Nobody is in the green yet." : "No settled bets yet.");
        const won = items.filter(x => betStatus(x.b) === "won"), lostN = items.length - won.length;
        L.push(`Bets settled: ${items.length} (${won.length} hit, ${lostN} missed)`);

        const hits = won.map(x => x.b).filter(b => !b.private);
        const best = hits.slice().sort((a, b) => betProfit(b) - betProfit(a))[0];
        if (best) L.push(`💰 Best hit: ${who(best.profileId)} cashed ${desc(best)} for +${money(betProfit(best))}`);
        const par = hits.filter(b => b.type === "parlay").sort((a, b) => b.legs.length - a.legs.length)[0];
        if (par && par !== best) L.push(`🎰 Biggest parlay: ${who(par.profileId)} hit ${par.legs.length} legs`);
        const sh = shame(items);
        sh.forEach(s => L.push(`${s.icon} ${s.title}: ${s.who} ${s.text}`));

        if (rows.length) {
            L.push("", "Standings:");
            rows.forEach((r, i) => L.push(`${i + 1}. ${r.p.name}  ${r.profit >= 0 ? "+" : ""}${money(r.profit)}  (${r.won}-${r.lost}${r.priv ? `, ${r.priv} private` : ""})`));
        }
        const hot = Store.profiles().map(p => ({ p, s: streaks(settled(), p.id) })).filter(x => x.s.cur >= 3);
        if (hot.length) {
            L.push("");
            hot.forEach(x => L.push(`${x.s.curType === "won" ? "🔥" : "🧊"} ${x.p.name}: ${x.s.cur} ${x.s.curType === "won" ? "wins" : "losses"} in a row`));
        }
        const open = Store.bets().filter(b => betStatus(b) === "pending").length;
        if (open) L.push("", `Still open: ${open} bet${open > 1 ? "s" : ""}`);
        if (sh[0] && typeof Roasts !== "undefined") L.push("", `🔥 Roast of the week: ${Roasts.pick(sh[0].bet.id, sh[0].who)}`);
        return L.join("\n");
    }

    /* ---------- drawing ---------- */
    let chosen = "this";
    function render() {
        if (!$("week")) return;
        const items = settled(), cur = weekStart(Date.now());
        const starts = [...new Set([cur, ...items.map(x => weekStart(x.at))])].sort((a, b) => b - a);
        $("week").innerHTML = starts.map(s => `<option value="${s}">${s === cur ? "This week" : "Week of " + day(s)}</option>`).join("") +
            `<option value="all">Whole season</option>`;
        $("week").value = chosen === "this" ? String(cur) : chosen;
        if ($("week").value !== (chosen === "this" ? String(cur) : chosen)) { chosen = "this"; $("week").value = String(cur); }

        const w = windowOf($("week").value, items), inW = inWindow(items, w), rows = board(inW);
        const rec = seasonRecord(items), win = winners(rows);

        $("wk-title").textContent = w.label;
        $("wk-board").innerHTML = rows.length ? `
            <thead><tr><th>#</th><th>Player</th><th>Record</th><th>Profit</th>${BUYIN > 0 ? "<th>Pot won</th>" : ""}<th>Weeks won</th></tr></thead>
            <tbody>${rows.map((r, i) => `<tr>
                <td>${i + 1}</td>
                <td><span class="who"><i style="background:${esc(r.p.color)}"></i>${esc(r.p.name)}</span>${win.includes(r) ? ` <span title="${w.current ? "Leading" : "Winner"}">${w.current ? "👑" : "🏆"}</span>` : ""}</td>
                <td>${r.won}-${r.lost}${r.priv ? ` <span class="muted">(${r.priv} private)</span>` : ""}</td>
                <td class="${sgn(r.profit)}">${money(r.profit)}</td>
                ${BUYIN > 0 ? `<td>${money(rec[r.p.id]?.pot || 0)}</td>` : ""}
                <td>${rec[r.p.id]?.weeks || 0}</td></tr>`).join("")}</tbody>`
            : `<tbody><tr><td class="muted">Nothing settled ${w.all ? "yet" : "in this week yet"}.</td></tr></tbody>`;
        $("pot").innerHTML = BUYIN > 0 && !w.all
            ? `Buy-in ${money(BUYIN)} · pot <b>${money(BUYIN * rows.length)}</b> (${rows.length} player${rows.length === 1 ? "" : "s"}) · ${win.length ? (w.current ? "leader takes it" : "won by " + esc(win.map(r => r.p.name).join(" & "))) : "no winner yet"}`
            : "";

        const bd = badges(items, rec), ps = Store.profiles();
        $("badges").innerHTML = ps.length ? ps.map(p => `
            <div class="badge-card"><span class="who"><i style="background:${esc(p.color)}"></i>${esc(p.name)}</span>
            <div class="chips">${(bd[p.id] || []).map(b => `<span class="bdg" title="${esc(b.why)}">${b.icon} ${esc(b.name)} <small>${esc(b.why)}</small></span>`).join("") || `<span class="muted">No badges yet</span>`}</div></div>`).join("")
            : `<div class="empty">No profiles yet.</div>`;

        const sh = shame(inW);
        $("shame").innerHTML = sh.length ? sh.map((s, i) => `
            <div class="shame-row"><span class="shame-icon">${s.icon}</span>
            <div><b>${esc(s.title)}</b>: ${esc(s.who)} ${esc(s.text)}
            ${i === 0 && typeof Roasts !== "undefined" ? `<div class="hit-roast">“${esc(Roasts.pick(s.bet.id, s.who))}”</div>` : ""}</div></div>`).join("")
            : `<div class="empty">Nobody has embarrassed themselves ${w.all ? "yet" : "this week"}.</div>`;

        $("recap").value = recap(inW, w, rows, rec);
    }

    $("week").onchange = () => { chosen = $("week").value; render(); };
    $("copy-recap").onclick = async () => {
        const t = $("recap").value, msg = $("copy-msg");
        try { await navigator.clipboard.writeText(t); msg.textContent = "Copied. Paste it in the group chat."; }
        catch { $("recap").select(); msg.textContent = document.execCommand && document.execCommand("copy") ? "Copied." : "Select the text and copy it."; }
        setTimeout(() => { msg.textContent = ""; }, 4000);
    };
    window.renderWeekly = render;
    render();
})();
