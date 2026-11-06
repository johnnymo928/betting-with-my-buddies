/* ============================================================
   Admin Knowledge Base: how data is captured.
   The endpoint and stat tables are generated from live.js so they
   never go stale. Relies on `$` and `esc` from admin.js.
   ============================================================ */
window.renderKB = function () {
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
                <tr><td>Google Sheet (shared database)</td><td>Profiles and bets, shared by every device, on the <b>WebSite</b> tab</td><td>All pages, through <code>store.js</code></td></tr>
                <tr><td>Browser storage</td><td>A local copy of the same data, so pages load instantly and keep working if the sheet can't be reached</td><td>All pages</td></tr>
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
                <tr><td>Profiles and bets from the Google Sheet</td><td>Every 30 seconds, and when the tab is shown again</td><td><code>store.js</code></td></tr>
            </tbody></table>
            <p class="hint">If a feed fails, the page keeps showing the last good data and retries on the next cycle.</p>`],

        ["Sportsbook odds (The Odds API)", `
            <p>Lines from DraftKings, FanDuel, BetMGM, Caesars and other books come from <b>The Odds API</b> (the-odds-api.com). The site never talks to it directly. The Google Apps Script holds the API key privately in <i>Script Properties</i> as <code>ODDS_API_KEY</code>, fetches the odds, and saves them.</p>
            <p>The free plan allows about <b>500 requests a month</b>, so odds are pulled <b>once per game day</b>, not on demand:</p>
            <ol class="kb-list">
                <li><b>3 hours before the first kickoff.</b> A timer in the script wakes every 15 minutes and checks ESPN's (free) schedule. On a day with games it waits until 3 hours before the <b>first</b> kickoff of that day, in the Eastern time zone, then pulls the lines for every league playing that day, once.</li>
                <li><b>Saved with the time.</b> The pull is saved in the script with its date and time. Every device reads that saved copy, so opening pages never spends credits.</li>
                <li><b>The time is always shown.</b> The Place Bet form says "odds pulled Sun 9:02 AM" over the lines, and each bet remembers the sportsbook, the price and when those odds were pulled (shown under the leg).</li>
            </ol>
            <table class="table"><thead><tr><th>Request</th><th>Credits</th><th>When</th></tr></thead><tbody>
                <tr><td>Game lines (spreads, moneyline, totals) for one league</td><td>3</td><td>Once per game day, per league playing</td></tr>
                <tr><td>One player-prop market for one game</td><td>1</td><td>On demand, at most 10 a day, cached 6 hours</td></tr>
                <tr><td>Status check (Admin page)</td><td>0</td><td>Whenever you press it</td></tr>
                <tr><td>Manual "Pull odds now" (Admin page)</td><td>about 6</td><td>Only if the automatic pull missed</td></tr>
            </tbody></table>
            <p>That is at most about 6 credits on a day with both leagues playing, and usually 3. The script also stops asking the odds service when fewer than 40 credits remain.</p>
            <ul class="kb-list">
                <li><b>Where it shows:</b> a "Lines by sportsbook" panel appears inside each leg of the Place Bet form. <b>Use</b> fills in the line and the odds and sets the sportsbook. For a parlay, once every leg has a price the total odds are worked out for you.</li>
                <li><b>Games with no lines:</b> a game that isn't on today's saved pull (a different day, or the pull hasn't run yet) shows no lines. Enter the line and odds by hand.</li>
                <li><b>The timer:</b> it is installed once by running <code>installOddsTrigger</code> in the Apps Script editor. The Admin page shows whether it is running, the credits left, and when each league was last pulled.</li>
                <li><b>Which books:</b> the list is <code>BOOKS</code> in <code>config.js</code> and <code>BOOK_KEYS</code> in the Apps Script. Change both together, then publish a new script version.</li>
                <li><b>Matching games:</b> ESPN games are matched to The Odds API by team name. A game with no match shows no lines.</li>
                <li><b>Prop coverage:</b> not every stat has sportsbook lines. Pass+Rush yards, rush TDs, sacks and tackles have none, and the panel says so.</li>
                <li><b>Changing the key:</b> Apps Script &rsaquo; Project Settings &rsaquo; Script Properties &rsaquo; <code>ODDS_API_KEY</code>. The key is never stored on the website.</li>
                <li><b>Odds move:</b> prices are a snapshot from the pull time, so confirm in the app before placing the bet.</li>
            </ul>
            <p>ESPN still provides one book's spread and total (<b>DraftKings</b>). It prefills the spread and total fields as soon as a game is picked, before the sportsbook panel loads.</p>`],

        ["How bets are built", `
            <p>Every field in the Place Bet form is a dropdown: <b>League &rsaquo; Game &rsaquo; Bet type &rsaquo; selection</b>. This stops typo and keyword problems, and it records exact game and player IDs so results can be graded automatically.</p>
            <table class="table"><thead><tr><th>Bet type</th><th>What is stored on the leg</th></tr></thead><tbody>
                <tr><td>Spread</td><td>League, game ID, team ID, opponent ID, line</td></tr>
                <tr><td>Moneyline</td><td>League, game ID, team ID, opponent ID</td></tr>
                <tr><td>Total</td><td>League, game ID, home and away IDs, over/under, line</td></tr>
                <tr><td>Player prop (NFL only)</td><td>League, game ID, ESPN player ID, stat, over/under, line. Not offered for college football because it isn't legal in this state</td></tr>
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

        ["Shared database: the Google Sheet", `
            <p>Profiles and bets are stored in a Google Sheet, on a single tab named <b>WebSite</b>. This is a <b>temporary</b> database until a real one replaces it. All reads and writes go through <code>store.js</code>, so swapping it later means changing that one file.</p>
            <table class="table"><thead><tr><th>Step</th><th>What happens</th></tr></thead><tbody>
                <tr><td>Saving</td><td>Every new bet, profile, grade or delete is sent to the sheet through a Google Apps Script web app (URL and password in <code>config.js</code>). It retries up to 3 times if the sheet doesn't answer.</td></tr>
                <tr><td>Loading</td><td>When a page opens, then every 30 seconds and whenever the tab comes back into view, the page downloads everything from the sheet and refreshes what you see.</td></tr>
                <tr><td>First connection</td><td>If the sheet is empty, whatever is already saved in this browser is uploaded to it once.</td></tr>
                <tr><td>Removing bets</td><td>Removing a bet on the Admin page is a <b>soft delete</b>: the bet is flagged <code>deleted</code>, disappears from every page and from the stats, and stays in the sheet (Status shows "deleted"). Admins can restore it, or delete it forever, from "Removed bets". Deleting a profile still permanently deletes its bets.</td></tr>
                <tr><td>Going offline</td><td>Every change is saved in a queue on the device first, then sent. If the connection drops (or the sheet can't be reached), changes made offline stay in the queue, even if the page is closed and reopened, and are sent as soon as the connection returns (the browser's "online" signal, a tab coming back into view, or the next 30-second check). A refresh never overwrites changes that are still waiting to be sent. The badge in the nav bar shows how many are waiting. Admin actions that need the PIN must be done while online.</td></tr>
                <tr><td>Conflicts</td><td>If two people change the same bet at the same moment, the last save wins.</td></tr>
            </tbody></table>
            <p>The badge in the nav bar shows the connection: <b>Shared &middot; synced</b>, <b>Connecting</b>, or <b>Offline &middot; retrying</b>. If the sheet can't be reached, the site keeps working from the local copy.</p>
            <ul class="kb-list">
                <li><b>The WebSite tab:</b> the script writes its own headers and rebuilds the tab after every change. The hidden JSON column is the real data. Don't type on that tab or edit the other columns, because edits are overwritten.</li>
                <li><b>Changing the script:</b> after editing it in Apps Script, use Deploy &rsaquo; Manage deployments &rsaquo; edit &rsaquo; New version. Saving alone does not update the live web app. A copy is kept in <code>sheet-setup/Code.gs</code>.</li>
                <li><b>Local copy:</b> each browser also keeps a copy in localStorage under ${code("bwmb.v1")}. Clearing browser data is safe, since it reloads from the sheet.</li>
                <li><b>Admin PIN:</b> preset to <b>0827</b> in the Apps Script (<code>DEFAULT_ADMIN_PIN</code>). The script checks it, not the website, and the page keeps it in memory only, so reloading or leaving the Admin page locks it again. 5 wrong tries lock it for 5 minutes. To keep the PIN out of the public repo, add a Script Property named <code>ADMIN_PIN</code>, which overrides the preset.</li>
                <li><b>Admin-only changes:</b> removing or restoring bets, deleting bets or profiles, creating or editing profiles, and restoring a backup are refused by the script unless the correct PIN is sent with them. Placing bets and marking legs hit or missed stay open to everyone.</li>
            </ul>`],

        ["Private stakes and the admin PIN", `
            <p>A bet marked <b>private</b> hides its stake, payout and profit on every page. It still counts toward records and hit rates, but is left out of profit, ROI, at-risk and best-win totals so the amount can't be worked out.</p>
            <p>Private stakes are stored in the sheet, so <b>anyone who can open the sheet can see them</b>. Keep its sharing restricted. The script leaves the stake out of what it sends to other devices, and a device that placed a private bet keeps its own copy.</p>
            <p>The sheet password in <code>config.js</code> and the private setting are <b>light protection</b>. The site and <code>config.js</code> are public, so someone determined could find the password and read or add bets. The admin actions are protected by the PIN, which the script checks. Real privacy for everything needs a proper backend with sign-in.</p>`],

        ["Known limits", `
            <ul class="kb-list">
                <li>ESPN's endpoints are unofficial and may change or lag during games.</li>
                <li>Only NFL and FBS college football are covered. College football has spread, moneyline and total bets only, with no player props.</li>
                <li>Pushes and voided legs are not supported, so they are left pending for a manual decision.</li>
                <li>Sportsbook lines depend on the free plan's monthly credits and on which books The Odds API covers for your state. Odds are one snapshot per game day, so there is no live odds movement.</li>
                <li>No sign-in, so profiles are chosen from a dropdown and are not tied to a person.</li>
                <li>The sheet refreshes every 30 seconds, so another person's change can take up to that long to appear. Google also limits how fast a script can be called, which is fine for a small group.</li>
            </ul>`],

        ["Files in this site", `
            <table class="table"><thead><tr><th>File</th><th>Purpose</th></tr></thead><tbody>
                <tr><td><code>index.html</code>, <code>script.js</code></td><td>Home: scoreboards, ticker, active bets</td></tr>
                <tr><td><code>bet.html</code>, <code>bet.js</code></td><td>Dropdown bet builder and bet list</td></tr>
                <tr><td><code>insights.html</code>, <code>insights.js</code></td><td>Stats, leaderboard, parlay and bet-type analysis</td></tr>
                <tr><td><code>admin.html</code>, <code>admin.js</code>, <code>kb.js</code></td><td>PIN gate, profiles, backups, this Knowledge Base</td></tr>
                <tr><td><code>store.js</code></td><td>All saving and loading of profiles and bets, sheet sync, plus payout math</td></tr>
                <tr><td><code>config.js</code></td><td>The Google Sheet web app URL and password</td></tr>
                <tr><td><code>sheet-setup/Code.gs</code></td><td>The Apps Script that runs inside the sheet (a copy, not used by the site)</td></tr>
                <tr><td><code>live.js</code></td><td>ESPN games, rosters, box scores and automatic grading</td></tr>
                <tr><td><code>odds.js</code></td><td>Sportsbook lines through the script (The Odds API), game matching, parlay odds math</td></tr>
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
        try {
            const s = await Odds.status();
            rows.push(`Sportsbook odds OK (${s.remaining ?? "?"} credits left this month${s.used != null ? ", " + s.used + " used" : ""})`);
        } catch (e) {
            rows.push(e.message === "no_key" ? "Sportsbook odds: no API key saved in Script Properties"
                : `Sportsbook odds FAILED (${e.message})`);
        }
        out.innerHTML = rows.map(esc).join("<br>");
    };
};

window.renderKB();   // the Knowledge Base is shown without the PIN
