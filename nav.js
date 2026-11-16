/* Injects the shared nav bar into every page's .topbar */
(function () {
    const links = [
        ["index.html", "Home"],
        ["bet.html", "Place Bet"],
        ["insights.html", "Insights"],
        ["pool.html", "Pool"],
        ["feedback.html", "Feedback"],
        ["admin.html", "Admin"]
    ];
    const cur = location.pathname.split("/").pop() || "index.html";
    const nav = document.createElement("nav");
    nav.className = "nav";
    nav.innerHTML = links.map(([href, label]) =>
        `<a href="${href}" ${href === cur ? 'class="active" aria-current="page"' : ""}>${label}</a>`).join("");
    const bar = document.querySelector(".topbar");
    bar.insertBefore(nav, bar.querySelector(".topright") || document.getElementById("clock"));
})();

/* Shared-database status badge */
(function () {
    if (!Store.sync.enabled) return;
    const el = document.createElement("span");
    el.className = "sync";
    const stack = document.querySelector(".topbar .topright");
    if (stack) stack.prepend(el); else document.querySelector(".nav").after(el);
    const LABEL = { connecting: "Connecting\u2026", synced: "Shared \u00b7 synced" };
    const show = s => {
        const n = Store.sync.pending();
        el.textContent = s === "error"
            ? (n ? `Offline \u00b7 ${n} change${n > 1 ? "s" : ""} saved here, will send when back` : "Offline \u00b7 retrying")
            : (LABEL[s] || s);
        el.dataset.state = s;
    };
    show(Store.sync.status());
    Store.sync.onStatus(show);
})();

/* Sign-in gate + who's signed in + which group you're looking at.
   Pages other than login/admin/superadmin send you to the login screen until you sign in.
   Loaded after nav.js on every page. */
(function () {
    const page = location.pathname.split("/").pop() || "index.html";
    if (["login.html", "admin.html", "superadmin.html"].includes(page)) return;
    const me = Store.session();
    if (!me && Store.allProfiles().length) {
        location.replace("login.html?next=" + encodeURIComponent(page + location.search));
        return;
    }
    if (!me) return;
    const mine = Store.myGroups(), cur = Store.activeGroup();
    const box = document.createElement("div");
    box.className = "whoami";
    box.innerHTML = `<span class="who-dot" style="background:${Store.esc(me.color)}"></span><b>${Store.esc(me.name)}</b>` +
        (mine.length > 1
            ? `<select id="grp-switch" aria-label="Group">${mine.map(g => `<option value="${g.id}" ${g.id === cur ? "selected" : ""}>${Store.esc(g.name)}</option>`).join("")}</select>`
            : `<span class="muted">${Store.esc(mine[0]?.name || "")}</span>`) +
        `<button class="btn ghost sm" id="logout" type="button">Log out</button>`;
    const stack = document.querySelector(".topbar .topright");
    if (stack) stack.prepend(box); else document.querySelector(".nav").after(box);
    const sw = box.querySelector("#grp-switch");
    if (sw) sw.onchange = () => { Store.setActiveGroup(sw.value); location.reload(); };
    box.querySelector("#logout").onclick = () => { Store.logout(); location.href = "login.html"; };
})();
