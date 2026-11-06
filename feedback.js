/* Feedback page: ideas are saved to the "Feedback" tab of the Google Sheet (through the Apps Script). */
const $ = id => document.getElementById(id);
const { esc } = Store;

const DRAFT_KEY = "bwmb.feedbackDraft";
const ERRORS = {
    too_short: "Please write a little more (at least 3 characters).",
    rate_limited: "Lots of ideas came in just now. Please try again in a few minutes.",
    unauthorized: "The site isn't set up correctly (bad sheet password)."
};
const enabled = typeof SHEET_URL !== "undefined" && !!SHEET_URL;

const call = async (body, query) => {
    const res = enabled && body
        ? await fetch(SHEET_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ secret: SHEET_SECRET, ...body }) })
        : await fetch(`${SHEET_URL}?secret=${encodeURIComponent(SHEET_SECRET)}&${query}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    return j;
};

/* ---------- Form ---------- */
function fillNames() {
    const names = Store.profiles().map(p => p.name);
    const last = (() => { try { return localStorage.getItem("bwmb.feedbackName"); } catch { return null; } })();
    $("fb-name").innerHTML = `<option value="">Anonymous</option>` + names.map(n => `<option>${esc(n)}</option>`).join("");
    if (last && names.includes(last)) $("fb-name").value = last;
}
const count = () => { $("fb-count").textContent = `${$("fb-text").value.length} / 1000`; };

try { $("fb-text").value = localStorage.getItem(DRAFT_KEY) || ""; } catch {}
$("fb-text").oninput = () => { count(); try { localStorage.setItem(DRAFT_KEY, $("fb-text").value); } catch {} };

$("fb-form").onsubmit = async e => {
    e.preventDefault();
    const text = $("fb-text").value.trim(), msg = $("fb-msg"), btn = $("fb-send");
    msg.textContent = ""; msg.classList.add("form-error"); msg.classList.remove("ok");
    if (!enabled) return void (msg.textContent = "Feedback needs the shared sheet, which isn't connected.");
    if (text.length < 3) return void (msg.textContent = ERRORS.too_short);
    btn.disabled = true; btn.textContent = "Sending…";
    try {
        await call({ action: "feedback", name: $("fb-name").value, category: $("fb-cat").value, text, page: "feedback" });
        try { localStorage.setItem("bwmb.feedbackName", $("fb-name").value); localStorage.removeItem(DRAFT_KEY); } catch {}
        $("fb-text").value = ""; count();
        msg.classList.remove("form-error"); msg.classList.add("ok");
        msg.textContent = "Thanks! Your idea was saved.";
        load();
    } catch (err) {
        // your text stays in the box (and is kept as a draft) so nothing is lost
        msg.textContent = ERRORS[err.message] || "Couldn't send right now. Your idea is still here, so please try again.";
    }
    btn.disabled = false; btn.textContent = "Send idea";
};

/* ---------- List ---------- */
const STATUS_CLASS = { new: "new", planned: "planned", "in progress": "doing", done: "done", "won't do": "no", "wont do": "no" };

async function load() {
    if (!enabled) { $("fb-list").innerHTML = `<div class="empty">Feedback isn't connected.</div>`; return; }
    try {
        const { items } = await call(null, "action=feedback");
        $("fb-total").textContent = items.length ? `${items.length} idea${items.length > 1 ? "s" : ""}` : "";
        $("fb-list").innerHTML = items.length ? items.map(i => `
            <article class="fb-item">
                <header>
                    <span class="badge pre">${esc(i.category)}</span>
                    <span class="fb-status ${STATUS_CLASS[String(i.status).toLowerCase()] || "new"}">${esc(i.status || "New")}</span>
                </header>
                <p>${esc(i.text)}</p>
                <footer class="muted">${esc(i.name)} · ${new Date(i.at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</footer>
            </article>`).join("")
            : `<div class="empty">No ideas yet. Be the first!</div>`;
    } catch (err) {
        console.error(err);
        $("fb-list").innerHTML = `<div class="empty error">Couldn't load the ideas right now.</div>`;
    }
}

window.addEventListener("storage", () => { Store.reload(); fillNames(); });
fillNames(); count(); load();
