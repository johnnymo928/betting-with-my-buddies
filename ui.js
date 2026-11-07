/* Shared bet-card renderer used by the home and bet pages */
const UI = (() => {
    const { esc, profile, betStatus, betProfit, fmtOdds, money, multiplier } = Store;
    const ICON = { won: "✓", lost: "✗", pending: "•" };

    function betCard(bet, { editable = false } = {}) {
        const p = profile(bet.profileId);
        const status = betStatus(bet);
        const hit = bet.legs.filter(l => l.status === "won").length;
        const payout = bet.stake * multiplier(bet.odds);

        // live progress / auto-grade note for structured legs
        const oddsNote = l => {
            const k = l.pick;
            if (!k?.book) return "";
            const when = k.oddsAt && typeof Odds !== "undefined" ? " \u00b7 odds pulled " + Odds.pulledAt(k.oddsAt) : "";
            const label = typeof Odds !== "undefined" ? Odds.bookLabel(k.book) : k.book;
            return `<span class="prog muted">${esc(label)} ${k.price != null ? (k.price > 0 ? "+" : "") + k.price : ""}${esc(when)}</span>`;
        };
        const progress = l => {
            if (!l.pick) return "";
            if (l.status !== "pending") {
                const shown = l.actual != null && ["prop", "total"].includes(l.pick.kind) ? `Final: ${l.actual}` : "";
                return l.manual === false ? `<span class="prog muted">Auto-graded${shown ? " · " + esc(shown) : ""}</span>` : "";
            }
            const pr = typeof Live !== "undefined" ? Live.progress[l.id] : null;
            // running game clock + score, shown for every structured leg whose game has data
            const clock = !pr ? "" : pr.state === "in"
                ? `<span class="prog gameclock"><b class="live-tag">LIVE</b> ${esc(pr.detail)}${pr.scoreLine ? " · " + esc(pr.scoreLine) : ""}</span>`
                : pr.state === "pre" ? (pr.detail ? `<span class="prog gameclock muted">Kickoff ${esc(pr.detail)}</span>` : "")
                : `<span class="prog gameclock muted">${esc(pr.detail || "Final")}${pr.scoreLine ? " · " + esc(pr.scoreLine) : ""}</span>`;
            if (!pr || pr.state === "pre" || !pr.text)
                return clock || `<span class="prog muted">Waiting for game</span>`;
            return clock + `<span class="prog ${pr.cover === false ? "behind" : pr.cover ? "ahead" : ""}">
                ${esc(pr.text)} 
                ${pr.ratio != null ? `<span class="prog-bar"><i style="width:${Math.round(pr.ratio * 100)}%"></i></span>` : ""}
                ${pr.note ? `<span class="prog warn">${esc(pr.note)}</span>` : ""}
            </span>`;
        };

        const legs = bet.legs.map(l => `
            <li class="leg ${l.status}">
                <span class="leg-icon">${ICON[l.status]}</span>
                <span class="leg-text">${esc(l.text)}${oddsNote(l)}${progress(l)}</span>
                ${editable ? `
                <span class="leg-actions" role="group" aria-label="Mark result">
                    <button data-act="leg" data-bet="${bet.id}" data-leg="${l.id}" data-status="won" class="${l.status === "won" ? "on-won" : ""}" title="Hit">✓</button>
                    <button data-act="leg" data-bet="${bet.id}" data-leg="${l.id}" data-status="lost" class="${l.status === "lost" ? "on-lost" : ""}" title="Missed">✗</button>
                    <button data-act="leg" data-bet="${bet.id}" data-leg="${l.id}" data-status="pending" class="${l.status === "pending" ? "on-pending" : ""}" title="Pending">↺</button>
                </span>` : ""}
            </li>`).join("");

        const result = bet.private ? `<span class="status-word ${status}">${status === "pending" ? "Stake hidden" : status === "won" ? "Won" : "Lost"}</span>`
            : status === "won" ?`<b class="pos">+${money(betProfit(bet))}</b>`
            : status === "lost" ? `<b class="neg">${money(betProfit(bet))}</b>`
            : `<span>To win ${money(payout)}</span>`;

        // trash talk: the Place Bet page shows the whole thread with a box to post; Home shows the latest line
        const cs = typeof Store.comments === "function" ? Store.comments(bet.id) : [];
        const line = c => `<div class="cmt"><b style="color:${esc(profile(c.profileId)?.color || "#aaa")}">${esc(profile(c.profileId)?.name || "Someone")}</b> ${esc(c.text)}</div>`;
        const chat = editable ? `
            <div class="thread">
                ${cs.map(line).join("")}
                <div class="cmt-form">
                    ${["\uD83D\uDD25", "\uD83D\uDE02", "\uD83D\uDC80", "\uD83D\uDC4F"].map(e => `<button type="button" class="react" data-act="react" data-bet="${bet.id}" data-emoji="${e}" aria-label="React ${e}">${e}</button>`).join("")}
                    <input class="cmt-in" data-bet="${bet.id}" maxlength="200" placeholder="Say something\u2026" aria-label="Comment">
                    <button type="button" class="btn ghost sm" data-act="comment" data-bet="${bet.id}">Post</button>
                </div>
                <div class="cmt-err" data-err="${bet.id}" role="alert"></div>
            </div>`
            : cs.length ? `<div class="thread home">${line(cs[cs.length - 1])}${cs.length > 1 ? `<span class="muted">+${cs.length - 1} more</span>` : ""}</div>` : "";

        return `
        <article class="bet-card ${status}" data-bet="${bet.id}">
            <header>
                <span class="who"><i style="background:${esc(p?.color || "#888")}"></i>${esc(p?.name || "Unknown")}</span>
                <span class="badge ${bet.type}">${bet.type === "parlay" ? bet.legs.length + "-Leg Parlay" : "Single"}</span>
                <span class="status-pill ${status}">${status}</span>
            </header>
            <ul class="legs">${legs}</ul>
            <footer>
                <span>${bet.private ? "🔒 Private" : money(bet.stake)} @ ${fmtOdds(bet.odds)}${bet.book ? " · " + esc(typeof Odds !== "undefined" ? Odds.bookLabel(bet.book) : bet.book) : ""}</span>
                ${bet.type === "parlay" && status === "pending" ? `<span>${hit}/${bet.legs.length} hit</span>` : ""}
                ${result}
            </footer>
            ${chat}
        </article>`;
    }

    return { betCard };
})();
