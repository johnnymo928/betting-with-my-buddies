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
    let db = Object.assign({ profiles: [], bets: [], pinHash: null, outbox: [] }, load());
    const save = () => {
        try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.error(e); }
    };

    /* ---------- Google Sheet sync (see config.js) ----------
       Every change goes into an outbox that is saved on this device, then sent to the sheet.
       If the connection is down the outbox simply waits and is replayed when it is back
       (on the browser's "online" event, when the tab is shown again, and every 30 seconds).
       Pulling the latest data never overwrites a change that has not reached the sheet yet.
       The sheet is the source of truth. Records that exist only on this device
       (never uploaded) are uploaded instead of dropped. */
    const cfg = typeof SHEET_URL !== "undefined" && SHEET_URL ? { url: SHEET_URL, secret: SHEET_SECRET } : null;
    let syncStatus = cfg ? "connecting" : "local", flushing = false;
    const statusListeners = [];
    const setStatus = s => { syncStatus = s; statusListeners.forEach(f => f(s)); };
    const REFUSED = ["forbidden", "locked", "unauthorized", "bad_pin"];   // these will never succeed on retry

    const box = () => (db.outbox ||= []);
    const pending = () => box().length;

    // Queue a change. Entries hold only a reference; the record itself is read when it is sent,
    // so the latest version always goes out and repeated edits collapse into one call.
    function push(body) {
        if (!cfg) return;
        const e = body.action === "replaceAll" ? { a: "replaceAll" }
            : { a: body.action, k: body.kind, id: body.action === "upsert" ? body.record.id : body.id };
        const dup = box().some((x, i) => x.a === e.a && x.k === e.k && x.id === e.id && !(i === 0 && flushing));
        if (!dup) { box().push(e); save(); }
        flush();
    }
    const pushBet = id => push({ action: "upsert", kind: "bet", record: { id } });

    function buildBody(e) {
        if (e.a === "replaceAll") return { action: "replaceAll", profiles: db.profiles, bets: db.bets };
        if (e.a === "remove") return { action: "remove", kind: e.k, id: e.id };
        const record = (e.k === "profile" ? db.profiles : db.bets).find(r => r.id === e.id);
        return record ? { action: "upsert", kind: e.k, record } : null;     // deleted locally since: nothing to send
    }

    async function send(body) {
        const res = await fetch(cfg.url, {
            method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ secret: cfg.secret, pin: adminPin, ...body }),
            signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined
        });
        const j = await res.json();
        if (j.error) throw new Error(j.error);
    }

    async function flush() {
        if (!cfg || flushing) return;
        flushing = true;
        try {
            while (box().length) {
                const body = buildBody(box()[0]);
                if (body) {
                    try {
                        await send(body);
                        // remember which records the sheet now has, so a remote delete is not undone
                        const s = new Set(db.syncedIds || []);
                        if (body.action === "upsert") s.add(body.record.id);
                        if (body.action === "remove") s.delete(body.id);
                        if (body.action === "replaceAll") { s.clear(); [...body.profiles, ...body.bets].forEach(r => s.add(r.id)); }
                        db.syncedIds = [...s];
                    } catch (err) {
                        if (!REFUSED.includes(err.message)) {       // offline or a server hiccup: keep it all and retry later
                            console.error("sync", err); setStatus("error"); return;
                        }
                        console.error("sync refused", err.message);   // refused for good: drop it, the next pull restores the truth
                    }
                }
                box().shift(); save();
            }
            setStatus("synced");
        } finally { flushing = false; }
    }

    async function pull() {
        if (!cfg || flushing) return;
        if (pending()) { await flush(); if (pending()) return; }     // send our changes first, never overwrite them
        let remote;
        try {
            const res = await fetch(`${cfg.url}?secret=${encodeURIComponent(cfg.secret)}`);
            remote = await res.json();
            if (remote.error || !Array.isArray(remote.profiles)) throw new Error(remote.error || "bad response");
        } catch (e) { console.error("sync", e); setStatus("error"); return; }
        if (flushing || pending()) return;               // a local change started while we were fetching

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
        if (!pending() && !flushing) setStatus("synced");
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
    // Removed bets are soft-deleted: flagged, hidden everywhere, and recoverable by an admin.
    const byNewest = (a, b) => b.createdAt - a.createdAt;
    const bets = () => db.bets.filter(b => !b.deleted).sort(byNewest);
    const removedBets = () => db.bets.filter(b => b.deleted).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

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
        db.bets.filter(b => !b.deleted).forEach(b => {
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
    function removeBet(id) {                       // soft delete (admin)
        const b = db.bets.find(x => x.id === id); if (!b) return;
        b.deleted = true; b.deletedAt = Date.now();
        save(); pushBet(id);
    }
    function restoreBet(id) {
        const b = db.bets.find(x => x.id === id); if (!b) return;
        delete b.deleted; delete b.deletedAt;
        save(); pushBet(id);
    }
    function deleteBet(id) {                       // permanent (admin)
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
    async function adminPost(body) {              // an admin-only call (the script checks the PIN)
        if (!cfg) throw new Error("no_sheet");
        const res = await fetch(cfg.url, {
            method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ secret: cfg.secret, pin: adminPin, ...body })
        });
        const j = await res.json();
        if (j.error) throw new Error(j.error);
        return j;
    }
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
        db = { profiles: d.profiles, bets: d.bets, pinHash: db.pinHash || d.pinHash || null, syncedIds: db.syncedIds, outbox: db.outbox || [] };
        save(); push({ action: "replaceAll", profiles: db.profiles, bets: db.bets });
    }

    if (cfg) {
        pull();
        setInterval(pull, 30000);
        document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
        // the browser tells us when the connection comes back: send queued changes and refresh right away
        window.addEventListener("online", () => pull());
        window.addEventListener("offline", () => setStatus("error"));
    }

    return {
        sync: { enabled: !!cfg, status: () => syncStatus, pending, onStatus: f => statusListeners.push(f), pull },
        COLORS, esc, profiles, profile, addProfile, updateProfile, deleteProfile,
        bets, removedBets, addBet, setLegStatus, recentHits, removeBet, restoreBet, deleteBet, betStatus, betProfit, multiplier, exposure, fmtOdds, money,
        adminLogin, adminLogout, isAdmin, adminPost, exportData, importData,
        reload() { db = Object.assign({ profiles: [], bets: [], pinHash: null, outbox: [] }, load()); }
    };
})();
