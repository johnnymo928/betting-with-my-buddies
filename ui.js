/* Shared bet-card renderer used by the home and bet pages */
const UI = (() => {
    const { esc, profile, betStatus, betProfit, fmtOdds, money, multiplier } = Store;
    const ICON = { won: "✓", lost: "✗", pending: "•" };

    function betCard(bet, { editable = false } = {}) {
        const p = profile(bet.profileId);
        const status = betStatus(bet);
        const hit = bet.legs.filter(l => l.status === "won").length;
        const payout = bet.stake * multiplier(bet.odds);

        const legs = bet.legs.map(l => `
            <li class="leg ${l.status}">
                <span class="leg-icon">${ICON[l.status]}</span>
                <span class="leg-text">${esc(l.text)}</span>
                ${editable ? `
                <span class="leg-actions" role="group" aria-label="Mark result">
                    <button data-act="leg" data-bet="${bet.id}" data-leg="${l.id}" data-status="won" class="${l.status === "won" ? "on-won" : ""}" title="Hit">✓</button>
                    <button data-act="leg" data-bet="${bet.id}" data-leg="${l.id}" data-status="lost" class="${l.status === "lost" ? "on-lost" : ""}" title="Missed">✗</button>
                    <button data-act="leg" data-bet="${bet.id}" data-leg="${l.id}" data-status="pending" class="${l.status === "pending" ? "on-pending" : ""}" title="Pending">↺</button>
                </span>` : ""}
            </li>`).join("");

        const result = status === "won" ? `<b class="pos">+${money(betProfit(bet))}</b>`
            : status === "lost" ? `<b class="neg">${money(betProfit(bet))}</b>`
            : `<span>To win ${money(payout)}</span>`;

        return `
        <article class="bet-card ${status}">
            <header>
                <span class="who"><i style="background:${esc(p?.color || "#888")}"></i>${esc(p?.name || "Unknown")}</span>
                <span class="badge ${bet.type}">${bet.type === "parlay" ? bet.legs.length + "-Leg Parlay" : "Single"}</span>
                <span class="status-pill ${status}">${status}</span>
            </header>
            <ul class="legs">${legs}</ul>
            <footer>
                <span>${money(bet.stake)} @ ${fmtOdds(bet.odds)}</span>
                ${bet.type === "parlay" && status === "pending" ? `<span>${hit}/${bet.legs.length} hit</span>` : ""}
                ${result}
            </footer>
        </article>`;
    }

    return { betCard };
})();
