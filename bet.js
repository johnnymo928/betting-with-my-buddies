const $ = id => document.getElementById(id);
const { esc } = Store;

let type = "single";
const form = $("bet-form");

/* ---------- Profiles ---------- */
function renderProfiles() {
    const ps = Store.profiles();
    const prev = $("profile").value, prevFilter = $("filter").value;
    $("no-profiles").hidden = ps.length > 0;
    form.hidden = ps.length === 0;
    $("profile").innerHTML = `<option value="">Select your profile&hellip;</option>` +
        ps.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    $("filter").innerHTML = `<option value="">Everyone</option>` +
        ps.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    $("profile").value = prev || localStorage.getItem("bwmb.lastProfile") || "";
    if (!ps.some(p => p.id === $("profile").value)) $("profile").value = "";
    $("filter").value = prevFilter;
}

/* ---------- Legs ---------- */
function legRow(value = "") {
    const row = document.createElement("div");
    row.className = "leg-row";
    row.innerHTML = `
        <input type="text" maxlength="120" placeholder="e.g. Chiefs -6.5" value="${esc(value)}" aria-label="Leg">
        <button type="button" class="btn icon" aria-label="Remove leg">&times;</button>`;
    row.querySelector("button").onclick = () => { row.remove(); syncLegs(); };
    return row;
}
function syncLegs() {
    const rows = [...$("legs").children];
    const min = type === "parlay" ? 2 : 1;
    while (rows.length < min) { const r = legRow(); $("legs").appendChild(r); rows.push(r); }
    if (type === "single") rows.slice(1).forEach(r => r.remove());
    [...$("legs").children].forEach(r =>
        r.querySelector("button").hidden = type === "single" || $("legs").children.length <= 2);
    $("add-leg").hidden = type !== "parlay";
    $("legs-label").textContent = type === "parlay" ? "Parlay legs" : "Your bet";
    $("odds-label").textContent = type === "parlay" ? "Total parlay odds" : "Odds (American)";
}
$("add-leg").onclick = () => { $("legs").appendChild(legRow()); syncLegs(); $("legs").lastChild.querySelector("input").focus(); };

document.querySelectorAll(".seg button").forEach(btn => btn.onclick = () => {
    type = btn.dataset.type;
    document.querySelectorAll(".seg button").forEach(b => {
        b.classList.toggle("on", b === btn);
        b.setAttribute("aria-checked", b === btn);
    });
    if (type === "parlay" && $("odds").value === "-110") $("odds").value = "";
    if (type === "single" && !$("odds").value) $("odds").value = "-110";
    syncLegs(); preview();
});

function preview() {
    const stake = parseFloat($("stake").value), odds = parseInt($("odds").value, 10);
    $("payout-preview").textContent = stake > 0 && Math.abs(odds) >= 100
        ? `To win ${Store.money(stake * Store.multiplier(odds))} · total return ${Store.money(stake * (1 + Store.multiplier(odds)))}`
        : "";
}
$("stake").oninput = $("odds").oninput = preview;

/* ---------- Submit ---------- */
form.onsubmit = e => {
    e.preventDefault();
    $("form-error").textContent = "";
    try {
        Store.addBet({
            profileId: $("profile").value,
            type,
            stake: parseFloat($("stake").value),
            odds: parseInt($("odds").value, 10),
            legs: [...$("legs").querySelectorAll("input")].map(i => i.value)
        });
        localStorage.setItem("bwmb.lastProfile", $("profile").value);
        $("legs").innerHTML = ""; $("stake").value = "";
        syncLegs(); preview(); renderBets();
    } catch (err) {
        $("form-error").textContent = err.message;
    }
};

/* ---------- Bet list ---------- */
function renderBets() {
    const f = $("filter").value;
    const list = Store.bets().filter(b => !f || b.profileId === f);
    $("bet-list").innerHTML = list.length
        ? list.map(b => UI.betCard(b, { editable: true })).join("")
        : `<div class="empty">No bets yet.</div>`;
}
$("filter").onchange = renderBets;
$("bet-list").onclick = e => {
    const b = e.target.closest("button[data-act=leg]");
    if (!b) return;
    Store.setLegStatus(b.dataset.bet, b.dataset.leg, b.dataset.status);
    renderBets();
};
window.addEventListener("storage", () => { Store.reload(); renderProfiles(); renderBets(); });

renderProfiles(); syncLegs(); renderBets();
