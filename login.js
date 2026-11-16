const $ = id => document.getElementById(id);
const { esc } = Store;
const next = (() => {
    const n = new URLSearchParams(location.search).get("next") || "index.html";
    return /^[\w.\-]+(\?.*)?$/.test(n) ? n : "index.html";      // same-site page names only
})();
const go = () => { location.href = next; };

if (Store.session()) go();

/* ---------- Step 1: unlock a group with its PIN or secret answer ---------- */
const groups = Store.groups();
$("g-pick").innerHTML = groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
let group = null;

function showPrompt() {
    const g = Store.group($("g-pick").value), gate = Store.groupGate(g);
    $("g-secret-wrap").hidden = !gate;
    $("g-prompt").textContent = gate ? (gate.type === "question" ? gate.question : "Group PIN") : "";
    $("g-secret").type = gate?.type === "question" ? "text" : "password";
    $("g-secret").value = ""; $("g-error").textContent = "";
}
$("g-pick").onchange = showPrompt;
showPrompt();

$("group-form").onsubmit = async e => {
    e.preventDefault();
    $("g-error").textContent = "";
    const g = Store.group($("g-pick").value);
    if (!(await Store.checkGroupSecret(g.id, $("g-secret").value))) {
        $("g-error").textContent = Store.groupGate(g)?.type === "question" ? "That's not the answer." : "Wrong PIN.";
        return;
    }
    group = g;
    showWho();
};

/* ---------- Step 2: pick your name, or add yourself ---------- */
function showWho() {
    const members = Store.allProfiles().filter(p => Store.memberOf(p).includes(group.id)).sort((a, b) => a.name.localeCompare(b.name));
    $("w-title").textContent = `Welcome to ${group.name}`;
    $("w-pick").innerHTML = `<option value="">Select your name&hellip;</option>` +
        members.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("") +
        `<option value="__new">I'm new here</option>`;
    $("w-new-wrap").hidden = true; $("w-error").textContent = "";
    $("step-group").hidden = true; $("step-who").hidden = false;
}
$("w-pick").onchange = () => {
    const isNew = $("w-pick").value === "__new";
    $("w-new-wrap").hidden = !isNew;
    if (isNew) $("w-new").focus();
};
$("w-back").onclick = () => { $("step-who").hidden = true; $("step-group").hidden = false; };

$("who-form").onsubmit = e => {
    e.preventDefault();
    $("w-error").textContent = "";
    try {
        let id = $("w-pick").value;
        if (!id) throw new Error("Pick your name.");
        if (id === "__new") {
            const name = $("w-new").value.trim();
            // a name that already exists elsewhere is the same person: add them to this group instead of making a copy
            const existing = Store.allProfiles().find(p => p.name.toLowerCase() === name.toLowerCase());
            id = existing ? existing.id : Store.addProfile(name, null, [group.id]).id;
        }
        Store.signIn(id, group.id);
        go();
    } catch (err) { $("w-error").textContent = err.message; }
};
