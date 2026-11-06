/* ============================================================
   Betting with Buddies
   ============================================================ */

/* ---------- Config ---------- */
const PAGE_SIZE = 4;
const ROTATE_MS = 7000;
const BET_PAGE_SIZE = 4;
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

// One timer flips every panel (NFL, NCAAF, Today's Bets) at the same moment.
let rotateTimer = null, betPage = 0;
function startRotation() {
    clearInterval(rotateTimer);
    rotateTimer = setInterval(() => {
        for (const key of Object.keys(FEEDS)) { state[key].page++; renderLeague(key); }
        betPage++; renderBetList();
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

/* Hit announcements come first in the ticker. Legs of a parlay announce one by one;
   a single bet is announced once, as a full bet. */
const HIT_WINDOW = 3 * 3600 * 1000;      // ticker: hits from the last 3 hours
const BANNER_WINDOW = 6 * 3600 * 1000;   // banner: full-bet hits from the last 6 hours
const who = bet => Store.profile(bet.profileId)?.name || "Someone";
const winText = bet => bet.private ? "" : ` · +${Store.money(bet.stake * Store.multiplier(bet.odds))}`;

function hitItems() {
    const { legs, full } = Store.recentHits(HIT_WINDOW);
    const items = full.map(({ bet }) => {
        const label = bet.type === "parlay" ? `${bet.legs.length}-leg parlay` : esc(bet.legs[0].text);
        return `<span class="hit-tag full">BET HIT</span> ${esc(who(bet))} cashed ${bet.type === "parlay" ? label : "<b>" + label + "</b>"}${esc(winText(bet))}`;
    });
    legs.filter(({ bet }) => bet.type === "parlay" && Store.betStatus(bet) !== "won").forEach(({ bet, leg }) => {
        const n = bet.legs.filter(l => l.status === "won").length;
        items.push(`<span class="hit-tag">LEG HIT</span> ${esc(who(bet))}: <b>${esc(leg.text)}</b> (${n} of ${bet.legs.length} in)`);
    });
    return items;
}

function lossItems() {
    return Store.recentLosses(HIT_WINDOW).map(({ bet, missed }) => {
        const what = bet.type === "parlay" ? `${bet.legs.length}-leg parlay` : esc(bet.legs[0].text);
        const killer = bet.type === "parlay" ? ` (killed by <b>${esc(missed[0].text)}</b>)` : "";
        return `<span class="hit-tag lost">BUSTED</span> ${esc(who(bet))}'s ${what} is dead${killer}. ${esc(Roasts.pick(bet.id, who(bet)))}`;
    });
}

let lastTicker = "";
function updateTicker() {
    const items = [...hitItems(), ...lossItems()];
    for (const key of Object.keys(FEEDS)) {
        state[key].games.forEach(g => {
            const score = g.phase === "pre" ? g.detail : `${g.away.score}–${g.home.score} ${g.detail}`;
            items.push(`${esc(g.away.name)} @ ${esc(g.home.name)} &middot; ${esc(score)}${g.spread ? " &middot; " + esc(g.spread) : ""}`);
        });
    }
    const html = items.length
        ? items.join('<span class="sep">&#9679;</span>')
        : "No games to show right now.";
    if (html !== lastTicker) { lastTicker = html; $("ticker-content").innerHTML = html; }   // don't restart the scroll for nothing
}

/* ---------- Big banner when a full bet hits (green) or is lost (red, with a roast) ----------
   Each banner stays for 15 seconds of actual viewing time, then clears by itself.
   Time with the tab hidden does not count, and the time already shown is remembered
   on this device, so someone who was not looking (or who reloads partway through)
   still gets their full 15 seconds, and a banner they have fully seen never returns. */
const HIT_SHOW_MS = 15000;
const DISMISS_KEY = "bwmb.dismissedHits";     // bets whose banner is finished or was closed
const SEEN_KEY = "bwmb.hitSeenMs";            // milliseconds of each banner already shown
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const dismissedHits = () => readJSON(DISMISS_KEY, []);
function markFinished(id) { writeJSON(DISMISS_KEY, [...new Set([...dismissedHits(), id])].slice(-200)); }

function bannerHtml(it, leftMs) {
    const bet = it.bet, win = it.kind === "win", name = who(bet);
    const title = win ? (bet.type === "parlay" ? "PARLAY HIT!" : "BET HIT!") : (bet.type === "parlay" ? "PARLAY BUSTED!" : "BET LOST!");
    const sub = win
        ? `${esc(name)} cashed ${bet.type === "parlay" ? bet.legs.length + " legs" : "it"}${bet.private ? "" : esc(winText(bet))}`
        : `${esc(name)} ${bet.private ? "took the L" : "lost " + esc(Store.money(bet.stake))}${bet.type === "parlay" ? " on a " + bet.legs.length + "-leg parlay" : ""}`;
    const legs = win
        ? bet.legs.map(l => `<li>\u2713 ${esc(l.text)}</li>`).join("")
        : bet.legs.map(l => l.status === "lost" ? `<li class="x">\u2717 ${esc(l.text)}</li>` : "").join("");
    return `
        <div class="hit-banner ${win ? "" : "loss"}" role="status" data-id="${esc(it.key)}">
            <div class="hit-emoji" aria-hidden="true">${win ? "\uD83C\uDF89" : "\uD83D\uDC80"}</div>
            <div class="hit-main">
                <div class="hit-title">${title}</div>
                <div class="hit-sub">${sub}</div>
                ${win ? "" : `<div class="hit-roast">\u201C${esc(Roasts.pick(bet.id, name))}\u201D</div>`}
                <ul class="hit-legs">${legs}</ul>
            </div>
            <button class="hit-close" data-dismiss="${esc(it.key)}" aria-label="Dismiss banner">&times;</button>
            <div class="hit-timer" aria-hidden="true"><i style="width:${Math.max(0, leftMs / HIT_SHOW_MS * 100)}%"></i></div>
        </div>`;
}

// Adds banners that are due and removes ones that are finished. Banners already on screen are left
// alone, so a data refresh never replays the entrance animation or restarts the countdown.
function renderBanners() {
    const box = $("hit-banners"), finished = new Set(dismissedHits()), seenMs = readJSON(SEEN_KEY, {});
    const due = [
        ...Store.recentHits(BANNER_WINDOW).full.map(h => ({ kind: "win", bet: h.bet, at: h.at, key: h.bet.id })),
        ...Store.recentLosses(BANNER_WINDOW).map(l => ({ kind: "loss", bet: l.bet, at: l.at, key: "L:" + l.bet.id }))
    ].filter(it => !finished.has(it.key) && (seenMs[it.key] || 0) < HIT_SHOW_MS).sort((a, b) => b.at - a.at);
    const dueKeys = new Set(due.map(it => it.key));

    box.querySelectorAll(".hit-banner").forEach(el => { if (!dueKeys.has(el.dataset.id)) el.remove(); });
    const onScreen = new Set([...box.querySelectorAll(".hit-banner")].map(el => el.dataset.id));
    due.forEach(it => {
        if (!onScreen.has(it.key)) box.insertAdjacentHTML("beforeend", bannerHtml(it, HIT_SHOW_MS - (seenMs[it.key] || 0)));
    });
}

// Count down every 250ms, but only while the tab is actually visible.
const TICK_MS = 250;
setInterval(() => {
    if (document.hidden) return;
    const box = $("hit-banners"), els = box.querySelectorAll(".hit-banner:not(.leaving)");
    if (!els.length) return;
    const seenMs = readJSON(SEEN_KEY, {});
    els.forEach(el => {
        const id = el.dataset.id;
        seenMs[id] = (seenMs[id] || 0) + TICK_MS;
        const left = HIT_SHOW_MS - seenMs[id];
        const bar = el.querySelector(".hit-timer i");
        if (bar) bar.style.width = Math.max(0, left / HIT_SHOW_MS * 100) + "%";
        if (left <= 0) {                                  // fully shown: clear it and don't show it again
            markFinished(id);
            el.classList.add("leaving");
            setTimeout(() => el.remove(), 450);
        }
    });
    const keep = {};                                      // keep the saved timers tidy
    Object.keys(seenMs).slice(-200).forEach(k => { keep[k] = seenMs[k]; });
    writeJSON(SEEN_KEY, keep);
}, TICK_MS);

$("hit-banners").addEventListener("click", e => {
    const id = e.target.dataset.dismiss;
    if (!id) return;
    markFinished(id);
    renderBanners();
});

/* ---------- Bets ---------- */
// Home shows everything still pending, plus anything placed today.
let lastBetsHtml = "", lastBetPage = -1;
function renderBetList() {
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const shown = Store.bets().filter(b => Store.betStatus(b) === "pending" || b.createdAt >= startOfDay);

    const pages = Math.max(1, Math.ceil(shown.length / BET_PAGE_SIZE));
    if (betPage >= pages) betPage = 0;
    const start = betPage * BET_PAGE_SIZE;

    const html = shown.length
        ? shown.slice(start, start + BET_PAGE_SIZE).map(b => UI.betCard(b)).join("")
        : `<div class="empty">No active bets. <a class="link" href="bet.html">Place one</a>.</div>`;
    // Only touch the DOM when something changed, and only fade cards in when the page flips
    // (not for a live-progress update), so a single page never flashes.
    if (html !== lastBetsHtml) {
        lastBetsHtml = html;
        $("bets").classList.toggle("flip", betPage !== lastBetPage);
        $("bets").innerHTML = html;
    }
    lastBetPage = betPage;

    $("bets-dots").innerHTML = pages > 1
        ? Array.from({ length: pages }, (_, i) =>
            `<button class="${i === betPage ? "active" : ""}" data-page="${i}" aria-label="Bets page ${i + 1}"></button>`).join("")
        : "";

    const x = Store.exposure(shown);
    const end = Math.min(start + BET_PAGE_SIZE, shown.length);
    const range = pages > 1 ? (end === start + 1 ? `Bet ${end} of ${shown.length}` : `Bets ${start + 1}–${end} of ${shown.length}`) : "";
    const money = x.count
        ? `${x.count} pending` + (x.count > x.hidden ? ` · ${Store.money(x.atRisk)} at risk · ${Store.money(x.toWin)} to win` : "") +
          (x.hidden ? ` · ${x.hidden} private` : "")
        : "";
    $("bets-count").textContent = [range, money].filter(Boolean).join(" · ");
}
function renderBets() {
    renderBetList();
    renderBanners();
    updateTicker();
}
// click a bets pager dot to jump to a page
$("bets-dots").addEventListener("click", e => {
    const p = e.target.dataset.page;
    if (p === undefined) return;
    betPage = Number(p);
    renderBetList();
    startRotation();
});
window.addEventListener("storage", () => { Store.reload(); renderBets(); });

// Grade any pending picks against live box scores, then redraw.
async function liveTick() {
    try { if (await Live.refresh()) renderBets(); } catch (e) { console.error(e); }
}
setInterval(liveTick, 45000);

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
    state[key] = { games: [], page: 0, error: false, loaded: false };
    renderLeague(key);
    loadLeague(key);
    setInterval(() => loadLeague(key), REFRESH_MS);

    // click a pager dot to jump to a page
    $(FEEDS[key].dots).addEventListener("click", e => {
        const p = e.target.dataset.page;
        if (p === undefined) return;
        state[key].page = Number(p);
        renderLeague(key);
        startRotation();   // restart the shared timer so nothing flips right away
    });
}
startRotation();

renderBets();
liveTick();
updateClock();
setInterval(updateClock, 1000);

/* ---------- QR code to the Place Bet page ---------- */
(function drawQr() {
    const box = $("qr-code");
    if (!box || typeof qrcode === "undefined") return;
    try {
        const url = new URL("bet.html", location.href).href;      // follows the site's address, even if it moves
        const qr = qrcode(0, "M");                               // size picked automatically, medium error correction
        qr.addData(url);
        qr.make();
        box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
        $("qr").title = url;
    } catch (e) { console.error("qr", e); $("qr").hidden = true; }
})();
