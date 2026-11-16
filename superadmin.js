const $ = id => document.getElementById(id);
const { esc } = Store;

function showGate(msg) {
    $("tools").hidden = true; $("gate").hidden = false;
    $("pin").value = ""; $("gate-error").textContent = msg || ""; $("pin").focus();
}
function showTools() { $("gate").hidden = true; $("tools").hidden = false; render(); }

$("gate-form").onsubmit = async e => {
    e.preventDefault();
    const pin = $("pin").value;
    if (!pin) return void ($("gate-error").textContent = "Enter the PIN.");
    const r = await Store.adminLogin(pin);
    if (r.ok) showTools(); else showGate(r.error === "locked" ? "Too many wrong tries. Locked for 5 minutes." : "Wrong PIN.");
};
$("lock").onclick = () => { Store.adminLogout(); showGate(); };

/* ---------- Groups ---------- */
$("g-color").value = Store.COLORS[Store.groups().length % Store.COLORS.length];
$("group-form").onsubmit = e => {
    e.preventDefault(); $("group-error").textContent = "";
    try { Store.addGroup($("g-name").value, $("g-color").value); $("g-name").value = ""; render(); }
    catch (err) { $("group-error").textContent = err.message; }
};
$("group-list").addEventListener("change", e => {
    const row = e.target.closest(".group-row"); if (!row) return;
    $("group-error").textContent = "";
    try { Store.updateGroup(row.dataset.id, { [e.target.dataset.field]: e.target.value }); }
    catch (err) { $("group-error").textContent = err.message; }
    render();
});
$("group-list").addEventListener("click", e => {
    if (e.target.dataset.act !== "delete") return;
    const id = e.target.closest(".group-row").dataset.id, g = Store.group(id), s = Store.groupStats(id);
    if (!confirm(`Delete "${g.name}"? Its ${s.bets} bet${s.bets === 1 ? "" : "s"} are deleted too (people are kept). This can't be undone.`)) return;
    try { Store.deleteGroup(id); } catch (err) { $("group-error").textContent = err.message; }
    render();
});

/* ---------- People ---------- */
$("person-form").onsubmit = e => {
    e.preventDefault(); $("person-error").textContent = "";
    try { Store.addProfile($("p-name").value, null, [Store.groups()[0].id]); $("p-name").value = ""; render(); }
    catch (err) { $("person-error").textContent = err.message; }
};
$("member-grid").addEventListener("change", e => {
    if (e.target.dataset.group) { Store.setMembership(e.target.dataset.person, e.target.dataset.group, e.target.checked); render(); }
});
$("member-grid").addEventListener("click", e => {
    const id = e.target.dataset.reset; if (!id) return;
    if (confirm(`Clear ${Store.profile(id).name}'s passcode? They'll set a new one next time they sign in.`)) { Store.resetPasscode(id); render(); }
});

function render() {
    const gs = Store.groups(), ps = Store.allProfiles();
    $("group-list").innerHTML = gs.map(g => {
        const s = Store.groupStats(g.id);
        return `<div class="group-row" data-id="${g.id}">
            <input type="color" value="${esc(g.color)}" data-field="color" aria-label="Color for ${esc(g.name)}">
            <input type="text" value="${esc(g.name)}" maxlength="30" data-field="name" aria-label="Group name">
            <span class="muted">${s.members} member${s.members === 1 ? "" : "s"} · ${s.bets} bet${s.bets === 1 ? "" : "s"}</span>
            <button class="btn danger" data-act="delete" ${gs.length < 2 ? "disabled" : ""}>Delete</button>
        </div>`;
    }).join("");
    $("member-grid").innerHTML = ps.length
        ? `<thead><tr><th>Person</th>${gs.map(g => `<th><span style="color:${esc(g.color)}">●</span> ${esc(g.name)}</th>`).join("")}<th>Passcode</th></tr></thead><tbody>` +
          ps.map(p => `<tr><td><b style="color:${esc(p.color)}">${esc(p.name)}</b></td>` +
            gs.map(g => `<td><input type="checkbox" data-person="${p.id}" data-group="${g.id}" ${Store.memberOf(p).includes(g.id) ? "checked" : ""} aria-label="${esc(p.name)} in ${esc(g.name)}"></td>`).join("") +
            `<td>${p.pass ? `<span class="pill ok">set</span> <button class="btn ghost sm" data-reset="${p.id}">Reset</button>` : `<span class="pill">not set</span>`}</td></tr>`).join("") + `</tbody>`
        : `<tbody><tr><td class="empty">No people yet. Add one above.</td></tr></tbody>`;
}
showGate();
