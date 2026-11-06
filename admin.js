const $ = id => document.getElementById(id);
const { esc } = Store;

/* The admin page is locked until the PIN is entered. The PIN is checked by the
   Apps Script (see sheet-setup/Code.gs) and kept in memory only, so reloading or
   leaving the page locks it again. Nothing below is drawn until the check passes. */
function showGate(msg) {
    $("tools").hidden = true; $("gate").hidden = false;
    $("gate-title").textContent = "Admin PIN";
    $("gate-hint").textContent = "Enter the admin PIN to continue.";
    $("pin").value = ""; $("gate-error").textContent = msg || "";
    $("pin").focus();
}
function showTools() {
    $("gate").hidden = true; $("tools").hidden = false;
    renderProfiles(); renderBets(); renderKB();
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
        ? list.map(b => `<div class="admin-bet">${UI.betCard(b)}<button class="btn danger" data-del="${b.id}">Remove</button></div>`).join("")
        : `<div class="empty">No bets yet.</div>`;
}
$("admin-bets").onclick = e => {
    const id = e.target.dataset.del; if (!id) return;
    if (confirm("Remove this bet?")) { Store.deleteBet(id); renderBets(); renderProfiles(); }
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
