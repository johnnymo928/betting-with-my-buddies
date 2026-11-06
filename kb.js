/* ============================================================
   Admin Knowledge Base: how data is captured.
   The endpoint and stat tables are generated from live.js so they
   never go stale. Relies on `$` and `esc` from admin.js.
   ============================================================ */
(function () {
    const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/";
    const L = Live.LEAGUES;
    const code = s => `<code>${esc(s)}</code>`;

    const endpointRows = Object.values(L).map(l => `
        <tr><td>${esc(l.label)}</td>
            <td>${code(BASE + l.board)}</td>
            <td>${code(BASE + l.path + "/summary?event={gameId}")}</td>
            <td>${code(BASE + l.path + "/teams/{teamId}/roster")}</td></tr>`).join("");

    const groups = {};
    Live.STATS.forEach(s => (groups[s.group] ||= []).push(s));
    const statRows = Object.entries(groups).map(([g, list]) => `
        <tr><td>${esc(g)}</td><td>${list.map(s => esc(s.label)).join(", ")}</td></tr>`).join("");
    const statDetail = Live.STATS.map(s => `
        <tr><td>${esc(s.label)}</td><td>${s.parts.map(p => esc(p[0]) + " › " + esc(p[1]) +
            (p[2] !== undefined ? (p[2] === 0 ? " (made)" : " (attempted)") : "")).join(" + ")}</td></tr>`).join("");

    const topics = [
        ["Where the data comes from", `
            <p>The site has no server of its own. It is static files on GitHub Pages, and the browser fetches everything directly.</p>
            <table class="table"><thead><tr><th>Source</th><th>What it provides</th><th>Used by</th></tr></thead><tbody>
                <tr><td>ESPN public API</td><td>Scores, game status, spread, over/under, rosters, player box scores</td><td>Home, bet builder, live grading</td></tr>
                <tr><td>People using the site</td><td>Profiles, bets, stake, odds, manual results</td><td>Place Bet, Admin</td></tr>
                <tr><td>Browser storage</td><td>Everything people enter, saved on that device only</td><td>All pages</td></tr>
            </tbody></table>`],

        ["ESPN endpoints", `
            <p>These are ESPN's free, <b>unofficial</b> endpoints. No account or key is needed, but ESPN can change them without notice. Use the test button above if something looks wrong.</p>
            <div class="table-wrap"><table class="table"><thead><tr><th>League</th><th>Scoreboard (games, scores, lines)</th><th>Game summary (box score)</th><th>Team roster</th></tr></thead><tbody>${endpointRows}</tbody></table></div>
            <p class="hint">NCAAF is limited to top-level FBS games with <code>groups=80&amp;limit=100</code>.</p>`],

        ["How often data refreshes", `
            <table class="table"><thead><tr><th>Data</th><th>Refresh</th><th>Where</th></tr></thead><tbody>
                <tr><td>Scoreboards (NFL, NCAAF)</td><td>Every 60 seconds</td><td>Home (<code>script.js</code>)</td></tr>
                <tr><td>Scoreboard page rotation</td><td>Every 7 seconds</td><td>Home</td></tr>
                <tr><td>Live grading of open bets</td><td>Every 45 seconds, only while a page is open</td><td>Home, Place Bet (<code>live.js</code>)</td></tr>
                <tr><td>Game box scores</td><td>Cached 30 seconds</td><td><code>live.js</code></td></tr>
                <tr><td>Game list for the bet builder</td><td>Cached 60 seconds</td><td><code>live.js</code></td></tr>
                <tr><td>Rosters</td><td>Cached 6 hours</td><td><code>live.js</code></td></tr>
            </tbody></table>
            <p class="hint">If a feed fails, the page keeps showing the last good data and retries on the next cycle.</p>`],

        ["Betting lines and odds", `
            <p>ESPN supplies one book's lines for each game, named in the feed as <b>DraftKings</b>. We read the spread (for example "KC -6.5") and the over/under, and use them to <b>prefill</b> the spread and total fields in the bet builder. You can change them.</p>
            <p><b>Not available:</b> player prop lines, and lines from FanDuel, BetMGM, Caesars or other apps. There is no free public API for them. The prop line and the odds are always entered by the bettor, so risk and gain match whichever app was used.</p>
            <p><b>Risk and gain</b> are calculated locally: <i>to win = stake x (odds/100)</i> for positive American odds, or <i>stake x (100/|odds|)</i> for negative odds. A parlay uses the combined odds the bettor enters.</p>`],

        ["How bets are built", `
            <p>Every field in the Place Bet form is a dropdown: <b>League &rsaquo; Game &rsaquo; Bet type &rsaquo; selection</b>. This stops typo and keyword problems, and it records exact game and player IDs so results can be graded automatically.</p>
            <table class="table"><thead><tr><th>Bet type</th><th>What is stored on the leg</th></tr></thead><tbody>
                <tr><td>Spread</td><td>League, game ID, team ID, opponent ID, line</td></tr>
                <tr><td>Moneyline</td><td>League, game ID, team ID, opponent ID</td></tr>
                <tr><td>Total</td><td>League, game ID, home and away IDs, over/under, line</td></tr>
                <tr><td>Player prop</td><td>League, game ID, ESPN player ID, stat, over/under, line</td></tr>
                <tr><td>Custom</td><td>Plain text only. Never graded automatically</td></tr>
            </tbody></table>
            <p>A <b>parlay</b> is one bet with several legs and one stake and odds. It loses as soon as any leg loses and wins only when every leg wins. Insights uses this to show which legs killed parlays.</p>`],

        ["Prop stats and where they come from", `
            <p>Each prop stat is read from the game's box score (<code>boxscore.players</code>) by player ID. Combo stats add several columns together.</p>
            <table class="table"><thead><tr><th>Group</th><th>Stats</th></tr></thead><tbody>${statRows}</tbody></table>
            <details class="kb-sub"><summary>Exact box-score column for each stat</summary>
                <div class="table-wrap"><table class="table"><thead><tr><th>Stat</th><th>Box score category &rsaquo; column</th></tr></thead><tbody>${statDetail}</tbody></table></div>
            </details>`],

        ["How automatic grading works", `
            <ol class="kb-list">
                <li>While a leg is <b>pending</b> and has a game attached, the page loads that game's summary from ESPN.</li>
                <li><b>Before kickoff:</b> shows "Waiting for game".</li>
                <li><b>During the game:</b> shows live progress (for example 187 / 249.5). An <b>over</b> that passes its line is marked a hit immediately, since stats cannot go down. An <b>under</b> that passes its line is marked missed. Everything else waits for the final.</li>
                <li><b>Final:</b> spreads, moneylines, totals and props are settled against the final score or stats.</li>
                <li><b>Left for you to grade by hand:</b> a result exactly on the line (push), a tie on a moneyline, and a player with no recorded stats (did not play). The leg shows a note explaining why.</li>
                <li><b>Manual override:</b> if someone marks a leg hit or missed themselves, it is locked and auto-grading never changes it. Pressing reset hands it back to auto-grading.</li>
            </ol>
            <p class="hint">Grading runs in the browser, so a bet only updates while someone has Home or Place Bet open on the device that holds it.</p>`],

        ["Where data is stored", `
            <p>All profiles and bets are saved in this browser's <b>localStorage</b> under the key ${code("bwmb.v1")}. The admin PIN defaults to <b>0827</b> (set as <code>DEFAULT_PIN</code> in <code>store.js</code>). Changing it on this page saves a simple hash of the new PIN in that same storage on this device only. Only the unlocked state for the current tab uses sessionStorage.</p>
            <ul class="kb-list">
                <li><b>Not shared:</b> each device has its own data. Other people do not see your bets unless you move a backup over.</li>
                <li><b>Can be lost:</b> clearing browser data, or using a private window, erases it. Export a backup regularly (Backup &amp; Security above).</li>
                <li><b>One file to change later:</b> all reads and writes go through <code>store.js</code>, so moving to a shared database such as Firebase means rewriting that file only.</li>
            </ul>`],

        ["Private stakes and the admin PIN", `
            <p>A bet marked <b>private</b> hides its stake, payout and profit on every page. It still counts toward records and hit rates, but is left out of profit, ROI, at-risk and best-win totals so the amount can't be worked out.</p>
            <p>The admin PIN and the private setting are <b>light protection</b>. The site is public and the data sits in the browser, so someone with access to that browser can still read the raw values. True privacy needs a server-side backend with real sign-in.</p>`],

        ["Known limits", `
            <ul class="kb-list">
                <li>ESPN's endpoints are unofficial and may change or lag during games.</li>
                <li>Only NFL and FBS college football are covered.</li>
                <li>Pushes and voided legs are not supported, so they are left pending for a manual decision.</li>
                <li>No live odds movement, and no lines from individual sportsbooks.</li>
                <li>No sign-in, so profiles are chosen from a dropdown and are not tied to a person.</li>
            </ul>`],

        ["Files in this site", `
            <table class="table"><thead><tr><th>File</th><th>Purpose</th></tr></thead><tbody>
                <tr><td><code>index.html</code>, <code>script.js</code></td><td>Home: scoreboards, ticker, active bets</td></tr>
                <tr><td><code>bet.html</code>, <code>bet.js</code></td><td>Dropdown bet builder and bet list</td></tr>
                <tr><td><code>insights.html</code>, <code>insights.js</code></td><td>Stats, leaderboard, parlay and bet-type analysis</td></tr>
                <tr><td><code>admin.html</code>, <code>admin.js</code>, <code>kb.js</code></td><td>PIN gate, profiles, backups, this Knowledge Base</td></tr>
                <tr><td><code>store.js</code></td><td>All saving and loading of profiles and bets, plus payout math</td></tr>
                <tr><td><code>live.js</code></td><td>ESPN games, rosters, box scores and automatic grading</td></tr>
                <tr><td><code>ui.js</code>, <code>nav.js</code>, <code>style.css</code></td><td>Shared bet card, nav bar, styling</td></tr>
            </tbody></table>`]
    ];

    $("kb").innerHTML = topics.map(([title, body], i) =>
        `<details class="kb-item" ${i === 0 ? "open" : ""}><summary>${esc(title)}</summary><div class="kb-body">${body}</div></details>`).join("");

    /* Connection test: hits one real endpoint of each kind */
    $("kb-test").onclick = async () => {
        const out = $("kb-test-result");
        out.textContent = "Testing…";
        const rows = [];
        for (const [key, l] of Object.entries(L)) {
            try {
                const games = await Live.games(key);
                rows.push(`${l.label} scoreboard OK (${games.length} upcoming/live games)`);
                if (games[0]) {
                    const r = await Live.roster(key, games[0].teams[0]);
                    rows.push(`${l.label} roster OK (${r.length} players for ${games[0].teams[0].abbr})`);
                }
            } catch (e) { rows.push(`${l.label} FAILED (${e.message})`); }
        }
        out.innerHTML = rows.map(esc).join("<br>");
    };
})();
