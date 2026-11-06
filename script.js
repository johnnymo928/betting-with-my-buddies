/* ============================================================
   Betting With My Buddies
   ============================================================ */

/* ---------- Config ---------- */
const PAGE_SIZE = 4;
const ROTATE_MS = 7000;
const REFRESH_MS = 60000;

const FEEDS = {
    nfl: {
        url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
        container: "nfl-container", status: "nfl-status", dots: "nfl-dots",
        label: "NFL"
    },
    ncaaf: {
        url: "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=100",
        container: "ncaaf-container", status: "ncaaf-status", dots: "ncaaf-dots",
        label: "NCAAF"
    }
};

const state = {};   // per-league: { games, page, timer, error }
const $ = id => document.getElementById(id);

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Parse an ESPN event into something renderable ---------- */
function parseEvent(event) {
    const comp = event.competitions?.[0];
    if (!comp) return null;

    const side = ha => comp.competitors.find(c => c.homeAway === ha) || {};
    const away = side("away"), home = side("home");
    const odds = comp.odds?.[0];
    const st = event.status?.type || {};

    const team = c => ({
        name: c.team?.shortDisplayName || c.team?.displayName || "TBD",
        logo: c.team?.logo || "",
        score: c.score ?? "",
        rank: c.curatedRank?.current && c.curatedRank.current <= 25 ? c.curatedRank.current : null,
        winner: c.winner === true
    });

    return {
        away: team(away),
        home: team(home),
        phase: st.state || "pre",                 // pre | in | post
        detail: st.shortDetail || "",
        spread: odds?.details || null,
        total: odds?.overUnder ?? null
    };
}

/* ---------- Rendering ---------- */
function teamRow(t, phase, otherScore) {
    const showScore = phase !== "pre";
    const loser = phase === "post" && Number(t.score) < Number(otherScore);
    return `
        <div class="team ${loser ? "loser" : ""}">
            ${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : ""}
            ${t.rank ? `<span class="rank">${t.rank}</span>` : ""}
            <span class="name">${esc(t.name)}</span>
        </div>
        <div class="score ${loser ? "loser" : ""}">${showScore ? esc(t.score) : ""}</div>`;
}

function gameCard(g) {
    const badge = { pre: "Upcoming", in: "Live", post: "Final" }[g.phase];
    return `
    <article class="game ${g.phase === "in" ? "is-live" : ""}">
        ${teamRow(g.away, g.phase, g.home.score)}
        ${teamRow(g.home, g.phase, g.away.score)}
        <div class="meta">
            <span class="badge ${g.phase}">${badge}</span>
            <span>${esc(g.detail)}</span>
            ${g.spread ? `<span class="chip"><b>LINE</b>${esc(g.spread)}</span>` : ""}
            ${g.total ? `<span class="chip"><b>O/U</b>${esc(g.total)}</span>` : ""}
        </div>
    </article>`;
}

function renderLeague(key) {
    const cfg = FEEDS[key], s = state[key];
    const box = $(cfg.container), status = $(cfg.status), dots = $(cfg.dots);
    const pages = Math.max(1, Math.ceil(s.games.length / PAGE_SIZE));
    if (s.page >= pages) s.page = 0;

    if (!s.games.length) {
        box.innerHTML = `<div class="empty ${s.error ? "error" : ""}">
            ${s.error ? "Couldn't load " + cfg.label + " scores. Retrying&hellip;" : s.loaded ? "No " + cfg.label + " games on the board right now." : "Loading&hellip;"}
        </div>`;
        status.textContent = "";
        dots.innerHTML = "";
        return;
    }

    const start = s.page * PAGE_SIZE;
    box.innerHTML = s.games.slice(start, start + PAGE_SIZE).map(gameCard).join("");
    status.textContent = `Games ${start + 1}–${Math.min(start + PAGE_SIZE, s.games.length)} of ${s.games.length}`;

    dots.innerHTML = pages > 1
        ? Array.from({ length: pages }, (_, i) =>
            `<button class="${i === s.page ? "active" : ""}" data-page="${i}" aria-label="Page ${i + 1}"></button>`).join("")
        : "";
}

function startRotation(key) {
    const s = state[key];
    clearInterval(s.timer);
    s.timer = setInterval(() => {
        s.page++;
        renderLeague(key);
    }, ROTATE_MS);
}

/* ---------- Data ---------- */
async function loadLeague(key) {
    const s = state[key];
    try {
        const res = await fetch(FEEDS[key].url);
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        s.games = (data.events || []).map(parseEvent).filter(Boolean);
        s.error = false;
    } catch (err) {
        console.error(key, err);
        s.error = true;           // keep showing last good data if we have it
    }
    s.loaded = true;
    renderLeague(key);
    updateTicker();
}

function updateTicker() {
    const items = [];
    for (const key of Object.keys(FEEDS)) {
        state[key].games.forEach(g => {
            const score = g.phase === "pre" ? g.detail : `${g.away.score}–${g.home.score} ${g.detail}`;
            items.push(`${esc(g.away.name)} @ ${esc(g.home.name)} &middot; ${esc(score)}${g.spread ? " &middot; " + esc(g.spread) : ""}`);
        });
    }
    $("ticker-content").innerHTML = items.length
        ? items.join('<span class="sep">&#9679;</span>')
        : "No games to show right now.";
}

/* ---------- Bets ---------- */
// Home shows everything still pending, plus anything placed today.
function renderBets() {
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const shown = Store.bets().filter(b => Store.betStatus(b) === "pending" || b.createdAt >= startOfDay);
    $("bets").innerHTML = shown.length
        ? shown.map(b => UI.betCard(b)).join("")
        : `<div class="empty">No active bets. <a class="link" href="bet.html">Place one</a>.</div>`;
    const pending = shown.filter(b => Store.betStatus(b) === "pending").length;
    $("bets-count").textContent = shown.length ? `${pending} pending` : "";
}
window.addEventListener("storage", () => { Store.reload(); renderBets(); });

/* ---------- Clock ---------- */
function updateClock() {
    const now = new Date();
    $("clock").textContent =
        now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) +
        " • " +
        now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

/* ---------- Boot ---------- */
for (const key of Object.keys(FEEDS)) {
    state[key] = { games: [], page: 0, timer: null, error: false, loaded: false };
    renderLeague(key);
    startRotation(key);
    loadLeague(key);
    setInterval(() => loadLeague(key), REFRESH_MS);

    // click a pager dot to jump to a page
    $(FEEDS[key].dots).addEventListener("click", e => {
        const p = e.target.dataset.page;
        if (p === undefined) return;
        state[key].page = Number(p);
        renderLeague(key);
        startRotation(key);   // restart the timer so it doesn't flip right away
    });
}

renderBets();
updateClock();
setInterval(updateClock, 1000);
