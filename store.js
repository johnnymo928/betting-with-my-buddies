/* ============================================================
   Shared data layer (localStorage).
   Every page talks to data only through `Store`, so swapping in
   Firebase/Supabase later means rewriting this one file.
   ============================================================ */
const Store = (() => {
    const KEY = "bwmb.v1";

    const load = () => {
        try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
        catch { return {}; }
    };
    let db = Object.assign({ profiles: [], bets: [], pinHash: null }, load());
    const save = () => {
        try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.error(e); }
    };

    /* ---------- Google Sheet sync (see config.js) ----------
       Every write is posted to the sheet; every page pulls the latest every 30s.
       The sheet is the source of truth. Records that exist only on this device
       (never uploaded) are uploaded instead of dropped. */
    const cfg = typeof SHEET_URL !== "undefined" && SHEET_URL ? { url: SHEET_URL, secret: SHEET_SECRET } : null;
    let syncStatus = cfg ? "connecting" : "local", inFlight = 0, queue = Promise.resolve();
    const statusListeners = [];
    const setStatus = s => { syncStatus = s; statusListeners.forEach(f => f(s)); };
    const wait = ms => new Promise(r => setTimeout(r, ms));

    function post(body) {
        inFlight++;
        queue = queue.then(async () => {
            try {
                for (let attempt = 1; ; attempt++) {
                    try {
                        const res = await fetch(cfg.url, {
                            method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
                            body: JSON.stringify({ secret: cfg.secret, pin: adminPin, ...body })
                        });
                        const j = await res.json();
                        if (j.error) throw new Error(j.error);
                        break;
                    } catch (e) {
                        // a refusal won't change on retry; only network hiccups are retried
                        if (attempt >= 3 || ["forbidden", "locked", "unauthorized", "bad_pin"].includes(e.message)) throw e;
                        await wait(3000 * attempt);
                    }
                }
                // remember which records the sheet now has, so a remote delete isn't undone
                const s = new Set(db.syncedIds || []);
                if (body.action === "upsert") s.add(body.record.id);
                if (body.action === "remove") s.delete(body.id);
                if (body.action === "replaceAll") { s.clear(); [...body.profiles, ...body.bets].forEach(r => s.add(r.id)); }
                db.syncedIds = [...s]; save();
                setStatus("synced");
            } catch (e) { console.error("sync", e); setStatus("error"); }
            finally { inFlight--; }
        });
    }
    const push = body => { if (cfg) post(body); };
    const pushBet = id => { const b = db.bets.find(x => x.id === id); if (b) push({ action: "upsert", kind: "bet", record: b }); };

    async function pull() {
        if (!cfg || inFlight) return;
        let remote;
        try {
            const res = await fetch(`${cfg.url}?secret=${encodeURIComponent(cfg.secret)}`);
            remote = await res.json();
            if (remote.error || !Array.isArray(remote.profiles)) throw new Error(remote.error || "bad response");
        } catch (e) { console.error("sync", e); setStatus("error"); return; }
        if (inFlight) return;                        // a local write started while we were fetching

        const before = JSON.stringify([db.profiles, db.bets]);
        const synced = new Set(db.syncedIds || []);
        const remoteEmpty = !remote.profiles.length && !remote.bets.length;

        if (remoteEmpty && (db.profiles.length || db.bets.length)) {
            // sheet is empty: upload what this device has. Profiles can only be
            // created by an admin, so they are skipped unless the admin PIN is unlocked.
            if (adminPin !== null) db.profiles.forEach(p => push({ action: "upsert", kind: "profile", record: p }));
            db.bets.forEach(b => push({ action: "upsert", kind: "bet", record: b }));
        } else {
            const merge = (local, rem, kind) => {
                const ids = new Set(rem.map(r => r.id));
                const out = rem.map(r => {
                    if (kind === "bet" && r.private && r.stake == null)      // sheet hides private stakes; keep ours
                        return { ...r, stake: local.find(x => x.id === r.id)?.stake ?? null };
                    return r;
                });
                local.forEach(l => {
                    if (ids.has(l.id)) return;
                    if (!synced.has(l.id)) {                       // new here: upload (profiles need the admin PIN)
                        out.push(l);
                        if (kind !== "profile" || adminPin !== null) push({ action: "upsert", kind, record: l });
                    }
                    // else: it was deleted elsewhere, so drop it
                });
                return out;
            };
            db.profiles = merge(db.profiles, remote.profiles, "profile");
            db.bets = merge(db.bets, remote.bets, "bet");
            db.syncedIds = [...remote.profiles, ...remote.bets].map(r => r.id);
        }
        save();
        if (!inFlight) setStatus("synced");
        if (JSON.stringify([db.profiles, db.bets]) !== before) window.dispatchEvent(new Event("storage"));
    }

    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    /* ---------- Profiles ---------- */
    const COLORS = ["#3ea6ff", "#34d399", "#f5b942", "#f87171", "#a78bfa", "#f472b6", "#22d3ee", "#fb923c"];

    const profiles = () => db.profiles.slice();
    const profile = id => db.profiles.find(p => p.id === id);

    function addProfile(name, color) {
        name = name.trim();
        if (!name) throw new Error("Name is required.");
        if (db.profiles.some(p => p.name.toLowerCase() === name.toLowerCase()))
            throw new Error("That name is already taken.");
        const p = { id: uid(), name, color: color || COLORS[db.profiles.length % COLORS.length] };
        db.profiles.push(p); save(); push({ action: "upsert", kind: "profile", record: p }); return p;
    }
    function updateProfile(id, fields) {
        const p = profile(id); if (!p) return;
        if (fields.name !== undefined) {
            const n = fields.name.trim();
            if (!n) throw new Error("Name is required.");
            if (db.profiles.some(x => x.id !== id && x.name.toLowerCase() === n.toLowerCase()))
                throw new Error("That name is already taken.");
            p.name = n;
        }
        if (fields.color) p.color = fields.color;
        save(); push({ action: "upsert", kind: "profile", record: p });
    }
    function deleteProfile(id) {
        db.profiles = db.profiles.filter(p => p.id !== id);
        db.bets = db.bets.filter(b => b.profileId !== id);
        save(); push({ action: "remove", kind: "profile", id });   // the sheet also removes their bets
    }

    /* ---------- Bets ----------
       bet = { id, profileId, createdAt, type: "single"|"parlay",
               stake, odds (American), legs: [{ id, text, status }] }
       leg.status: "pending" | "won" | "lost"
       A parlay loses as soon as one leg loses, wins when every leg wins. */
    const bets = () => db.bets.slice().sort((a, b) => b.createdAt - a.createdAt);

    function addBet({ profileId, type, stake, odds, legs, privateAmount, book }) {
        if (!profile(profileId)) throw new Error("Pick a profile.");
        // a leg is a plain string (custom) or { text, pick } built from the dropdowns
        const clean = legs.map(l => typeof l === "string" ? { text: l.trim() } : { text: String(l.text).trim(), pick: l.pick })
            .filter(l => l.text);
        if (type === "parlay" && clean.length < 2) throw new Error("A parlay needs at least 2 legs.");
        if (type === "single" && clean.length < 1) throw new Error("Describe your bet.");
        if (!(stake > 0)) throw new Error("Enter a stake above 0.");
        if (!Number.isFinite(odds) || Math.abs(odds) < 100) throw new Error("Odds must be American, like -110 or +250.");
        const bet = {
            id: uid(), profileId, createdAt: Date.now(), type, stake, odds, private: !!privateAmount, book: book || "",
            legs: (type === "single" ? clean.slice(0, 1) : clean).map(l => ({ id: uid(), text: l.text, status: "pending", ...(l.pick ? { pick: l.pick } : {}) }))
        };
        db.bets.push(bet); save(); pushBet(bet.id); return bet;
    }
    // Manual changes lock a leg so live grading never overrides them;
    // resetting to pending hands it back to auto-grading.
    function setLegStatus(betId, legId, status, opts = {}) {
        const leg = db.bets.find(b => b.id === betId)?.legs.find(l => l.id === legId);
        if (!leg) return;
        leg.status = status;
        if (opts.auto) { leg.manual = false; leg.actual = opts.actual; }
        else { leg.manual = status !== "pending"; delete leg.actual; }
        // when it was settled, so every device can announce recent hits
        if (status === "pending") delete leg.settledAt; else leg.settledAt = Date.now();
        save(); pushBet(betId);
    }

    // Hits settled within the last `windowMs`: individual legs, and whole bets that have fully hit.
    function recentHits(windowMs) {
        const cutoff = Date.now() - windowMs, legs = [], full = [];
        db.bets.forEach(b => {
            b.legs.forEach(l => {
                if (l.status === "won" && l.settledAt && l.settledAt >= cutoff) legs.push({ bet: b, leg: l, at: l.settledAt });
            });
            if (betStatus(b) === "won" && b.legs.every(l => l.settledAt)) {
                const at = Math.max(...b.legs.map(l => l.settledAt));
                if (at >= cutoff) full.push({ bet: b, at });
            }
        });
        const newest = (a, b) => b.at - a.at;
        return { legs: legs.sort(newest), full: full.sort(newest) };
    }
    function deleteBet(id) {
        db.bets = db.bets.filter(b => b.id !== id);
        save(); push({ action: "remove", kind: "bet", id });
    }

    const betStatus = bet => {
        if (bet.legs.some(l => l.status === "lost")) return "lost";
        if (bet.legs.every(l => l.status === "won")) return "won";
        return "pending";
    };
    const multiplier = odds => odds > 0 ? odds / 100 : 100 / -odds;
    const betProfit = bet => {
        const s = betStatus(bet);
        return s === "won" ? bet.stake * multiplier(bet.odds) : s === "lost" ? -bet.stake : 0;
    };
    // Money still on the line: stake at risk and what it would pay if everything hits.
    // Private bets count toward `count` but never add to the dollar totals.
    const exposure = list => list.filter(b => betStatus(b) === "pending").reduce(
        (a, b) => b.private
            ? { ...a, count: a.count + 1, hidden: a.hidden + 1 }
            : { ...a, atRisk: a.atRisk + b.stake, toWin: a.toWin + b.stake * multiplier(b.odds), count: a.count + 1 },
        { atRisk: 0, toWin: 0, count: 0, hidden: 0 });
    const fmtOdds = o => (o > 0 ? "+" : "") + o;
    const money = n => (n < 0 ? "-$" : "$") + Math.abs(n).toFixed(2);

    /* ---------- Admin PIN (light protection only: the site is public) ---------- */
    // With the sheet connected, the PIN is checked by the Apps Script, so it isn't in this
    // site's code. It is kept in memory only (a page reload locks the admin again) and is
    // sent along with admin changes, which the script refuses without it.
    const LOCAL_PIN = "0827";          // only used when no sheet is configured (browser-only mode)
    let adminPin = null;
    const isAdmin = () => adminPin !== null;
    const adminLogout = () => { adminPin = null; };
    async function adminLogin(pin) {
        pin = String(pin || "");
        if (!cfg) {
            if (pin !== LOCAL_PIN) return { ok: false, error: "bad_pin" };
            adminPin = pin; return { ok: true };
        }
        try {
            const res = await fetch(cfg.url, {
                method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({ secret: cfg.secret, action: "adminCheck", pin })
            });
            const j = await res.json();
            if (j.ok) { adminPin = pin; return { ok: true }; }
            return { ok: false, error: j.error || "bad_pin" };
        } catch (e) { return { ok: false, error: "network" }; }
    }

    /* ---------- Backup ---------- */
    const exportData = () => JSON.stringify(db, null, 2);
    function importData(text) {
        const d = JSON.parse(text);
        if (!Array.isArray(d.profiles) || !Array.isArray(d.bets)) throw new Error("Not a valid backup file.");
        db = { profiles: d.profiles, bets: d.bets, pinHash: db.pinHash || d.pinHash || null, syncedIds: db.syncedIds };
        save(); push({ action: "replaceAll", profiles: db.profiles, bets: db.bets });
    }

    if (cfg) {
        pull();
        setInterval(pull, 30000);
        document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
    }

    return {
        sync: { enabled: !!cfg, status: () => syncStatus, onStatus: f => statusListeners.push(f), pull },
        COLORS, esc, profiles, profile, addProfile, updateProfile, deleteProfile,
        bets, addBet, setLegStatus, recentHits, deleteBet, betStatus, betProfit, multiplier, exposure, fmtOdds, money,
        adminLogin, adminLogout, isAdmin, exportData, importData,
        reload() { db = Object.assign({ profiles: [], bets: [], pinHash: null }, load()); }
    };
})();
