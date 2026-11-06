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
    renderProfiles(); renderBets(); checkOdds();
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

showGate();
