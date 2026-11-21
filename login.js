const $ = id => document.getElementById(id);
const next = (() => {
    const n = new URLSearchParams(location.search).get("next") || "index.html";
    return /^[\w.\-]+(\?.*)?$/.test(n) ? n : "index.html";      // same-site page names only
})();
const go = () => { location.href = next; };

if (Store.session()) go();
$("l-names").innerHTML = Store.allProfiles().map(p => `<option value="${Store.esc(p.name)}">`).join("");
let pending = null;

$("login-form").onsubmit = async e => {
    e.preventDefault();
    $("l-error").textContent = "";
    const name = $("l-name").value.trim();
    if (!name) return void ($("l-error").textContent = "Enter your name.");
    const r = await Store.login(name, $("l-pass").value);
    if (r.ok) return go();
    if (r.needsSetup) {
        pending = r.profile;
        $("s-title").textContent = `Hi ${pending.name}, set your passcode`;
        $("step-login").hidden = true; $("step-setup").hidden = false; $("s-pass").focus();
        return;
    }
    $("l-error").textContent = r.error === "no_user" ? "We don't have that name. Ask your admin to add you." : "Wrong passcode.";
};

$("setup-form").onsubmit = async e => {
    e.preventDefault();
    $("s-error").textContent = "";
    if ($("s-pass").value !== $("s-pass2").value) return void ($("s-error").textContent = "Those don't match.");
    try { await Store.setPasscode(pending.id, $("s-pass").value, { signIn: true }); go(); }
    catch (err) { $("s-error").textContent = err.message; }
};
$("s-back").onclick = () => { $("step-setup").hidden = true; $("step-login").hidden = false; };
