/* Injects the shared nav bar into every page's .topbar */
(function () {
    const links = [
        ["index.html", "Home"],
        ["bet.html", "Place Bet"],
        ["insights.html", "Insights"],
        ["admin.html", "Admin"]
    ];
    const cur = location.pathname.split("/").pop() || "index.html";
    const nav = document.createElement("nav");
    nav.className = "nav";
    nav.innerHTML = links.map(([href, label]) =>
        `<a href="${href}" ${href === cur ? 'class="active" aria-current="page"' : ""}>${label}</a>`).join("");
    const bar = document.querySelector(".topbar");
    bar.insertBefore(nav, document.getElementById("clock"));
})();
