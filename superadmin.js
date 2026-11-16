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

/* ---------- Create a group (the PIN or secret question is set here) ---------- */
$("g-color").value = Store.COLORS[Store.groups().length % Store.COLORS.length];
function syncType() {
    const t = $("g-type").value;
    $("g-question").hidden = t !== "question";
    $("g-answer").hidden = !t;
    $("g-answer").placeholder = t === "question" ? "Secret answer" : "PIN";
}
$("g-type").onchange = syncType; syncType();

$("group-form").onsubmit = async e => {
    e.preventDefault(); $("group-error").textContent = "";
    const type = $("g-type").value;
    let g = null;
    try {
        // check the secret before creating, so a bad one doesn't leave a half-made group behind
        if (type && $("g-answer").value.trim().length < 3) throw new Error(type === "pin" ? "Use a PIN of at least 3 characters." : "The answer needs at least 3 characters.");
        if (type === "question" && !$("g-question").value.trim()) throw new Error("Write the question.");
        g = Store.addGroup($("g-name").value, $("g-color").value);
        await Store.setGroupSecret(g.id, { type, question: $("g-question").value, answer: $("g-answer").value });
        $("g-name").value = $("g-question").value = $("g-answer").value = "";
        render();
    } catch (err) { $("group-error").textContent = err.message; render(); }
};

/* ---------- Existing groups ---------- */
$("group-list").addEventListener("change", e => {
    const card = e.target.closest(".group-card"); if (!card || !e.target.dataset.field) return;
    $("group-error").textContent = "";
    try { Store.updateGroup(card.dataset.id, { [e.target.dataset.field]: e.target.value }); }
    catch (err) { $("group-error").textContent = err.message; }
    render();
});
$("group-list").addEventListener("click", async e => {
    const act = e.target.dataset.act; if (!act) return;
    const card = e.target.closest(".group-card"), id = card.dataset.id, g = Store.group(id);
    $("group-error").textContent = "";
    if (act === "delete") {
        const s = Store.groupStats(id);
        if (!confirm(`Delete "${g.name}"? Its ${s.bets} bet${s.bets === 1 ? "" : "s"} are deleted too (people are kept). This can't be undone.`)) return;
        try { Store.deleteGroup(id); } catch (err) { $("group-error").textContent = err.message; }
    } else if (act === "secret") {
        const type = card.querySelector("[data-s=type]").value;
        try {
            await Store.setGroupSecret(id, { type, question: card.querySelector("[data-s=question]").value, answer: card.querySelector("[data-s=answer]").value });
        } catch (err) { $("group-error").textContent = err.message; return; }
    }
    render();
});
$("group-list").addEventListener("input", e => {
    const card = e.target.closest(".group-card"); if (!card || e.target.dataset.s !== "type") return;
    card.querySelector("[data-s=question]").hidden = e.target.value !== "question";
    card.querySelector("[data-s=answer]").hidden = !e.target.value;
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

const secretLabel = g => { const s = Store.groupGate(g); return s ? (s.type === "pin" ? "PIN set" : "Question set") : "Public"; };

function render() {
    const gs = Store.groups(), ps = Store.allProfiles();
    $("group-list").innerHTML = gs.map(g => {
        const s = Store.groupStats(g.id), gate = Store.groupGate(g), type = gate?.type || "";
        return `<div class="group-card" data-id="${g.id}">
            <div class="group-row">
                <input type="color" value="${esc(g.color)}" data-field="color" aria-label="Color for ${esc(g.name)}">
                <input type="text" value="${esc(g.name)}" maxlength="30" data-field="name" aria-label="Group name">
                <span class="muted">${s.members} member${s.members === 1 ? "" : "s"} · ${s.bets} bet${s.bets === 1 ? "" : "s"}</span>
                <button class="btn danger" data-act="delete" ${gs.length < 2 ? "disabled" : ""}>Delete</button>
            </div>
            <div class="secret-row">
                <span class="pill ${gate ? "ok" : ""}">${secretLabel(g)}</span>
                <select data-s="type" aria-label="How people join ${esc(g.name)}">
                    <option value="pin" ${type === "pin" ? "selected" : ""}>PIN</option>
                    <option value="question" ${type === "question" ? "selected" : ""}>Secret question</option>
                    <option value="" ${type === "" ? "selected" : ""}>Public (anyone can join)</option>
                </select>
                <input type="text" data-s="question" maxlength="120" placeholder="Question" value="${esc(gate?.question || "")}" ${type === "question" ? "" : "hidden"}>
                <input type="text" data-s="answer" maxlength="60" placeholder="New ${type === "question" ? "answer" : "PIN"} (shown only now)" autocomplete="off" ${type ? "" : "hidden"}>
                <button class="btn ghost sm" data-act="secret">Update</button>
            </div>
        </div>`;
    }).join("");
    $("member-grid").innerHTML = ps.length
        ? `<thead><tr><th>Person</th>${gs.map(g => `<th><span style="color:${esc(g.color)}">●</span> ${esc(g.name)}</th>`).join("")}</tr></thead><tbody>` +
          ps.map(p => `<tr><td><b style="color:${esc(p.color)}">${esc(p.name)}</b></td>` +
            gs.map(g => `<td><input type="checkbox" data-person="${p.id}" data-group="${g.id}" ${Store.memberOf(p).includes(g.id) ? "checked" : ""} aria-label="${esc(p.name)} in ${esc(g.name)}"></td>`).join("") +
            `</tr>`).join("") + `</tbody>`
        : `<tbody><tr><td class="empty">No people yet. Add one above.</td></tr></tbody>`;
}
showGate();
