const $ = id => document.getElementById(id);
const { esc } = Store;

/* The PIN gate is light protection only: the site is public and data is in
   the browser. Unlock lasts for this tab (sessionStorage). */
const unlocked = () => { try { return sessionStorage.getItem("bwmb.admin") === "1"; } catch { return false; } };
const setUnlocked = v => { try { v ? sessionStorage.setItem("bwmb.admin", "1") : sessionStorage.removeItem("bwmb.admin"); } catch {} };

let changingPin = false;

function showGate() {
    const first = !Store.hasPin() || changingPin;
    $("tools").hidden = true; $("gate").hidden = false;
    $("gate-title").textContent = !Store.hasPin() ? "Create Admin PIN" : changingPin ? "Change PIN" : "Admin PIN";
    $("gate-hint").textContent = !Store.hasPin()
        ? "First time here. Choose a PIN (4+ digits) to protect the admin page."
        : changingPin ? "Enter the new PIN." : "Enter the admin PIN to continue.";
    $("pin-label").textContent = first ? "New PIN" : "PIN";
    $("pin2-wrap").hidden = !first;
    $("pin").value = $("pin2").value = ""; $("gate-error").textContent = "";
    $("pin").focus();
}
function showTools() {
    $("gate").hidden = true; $("tools").hidden = false;
    renderProfiles(); renderBets();
}

$("gate-form").onsubmit = e => {
    e.preventDefault();
    const pin = $("pin").value, err = $("gate-error");
    if (!Store.hasPin() || changingPin) {
        if (pin.length < 4) return void (err.textContent = "PIN must be at least 4 characters.");
        if (pin !== $("pin2").value) return void (err.textContent = "PINs don't match.");
        Store.setPin(pin); changingPin = false; setUnlocked(true); showTools();
    } else if (Store.checkPin(pin)) {
        setUnlocked(true); showTools();
    } else {
        err.textContent = "Wrong PIN.";
    }
};
$("lock").onclick = () => { setUnlocked(false); showGate(); };
$("change-pin").onclick = () => { changingPin = true; showGate(); };

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

unlocked() && Store.hasPin() ? showTools() : showGate();
