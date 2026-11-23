/* Injects the shared nav bar into every page's .topbar */
(function () {
    const links = [
        ["index.html", "Home"],
        ["bet.html", "Place Bet"],
        ["insights.html", "Insights"],
        ["pool.html", "Pool"],
        ["squares.html", "Squares"],
        ["feedback.html", "Feedback"],
        ["admin.html", "Admin"]
    ];
    const cur = location.pathname.split("/").pop() || "index.html";
    const nav = document.createElement("nav");
    nav.className = "nav";
    const draw = () => {
        nav.innerHTML = links.filter(([href]) => href !== "pool.html" || !Store.poolHidden()).map(([href, label]) =>
            `<a href="${href}" ${href === cur ? 'class="active" aria-current="page"' : ""}>${label}</a>`).join("");
    };
    draw();
    window.addEventListener("storage", draw);          // fires after a sync pull or an admin change
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
