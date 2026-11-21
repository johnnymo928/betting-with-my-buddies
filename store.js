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
    const EMPTY = () => ({ profiles: [], bets: [], comments: [], picks: [], groups: [], pinHash: null, outbox: [] });
    let db = Object.assign(EMPTY(), load());
    /* Groups: every bet, pick and profile belongs to one or more groups. Anything saved before groups
       existed has no group and counts as the default group, so nothing is lost or moved. */
    const DEFAULT_GROUP = "default";
    const ensureGroups = () => { if (!db.groups?.length) db.groups = [{ id: DEFAULT_GROUP, name: "Ohio", color: "#3ea6ff" }]; };
    ensureGroups();
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
    const REFUSED = ["forbidden", "locked", "unauthorized", "bad_pin", "kickoff", "bad_record"];   // these will never succeed on retry
    // record kinds and where each one lives. Comments and pool picks need the newer script (api 2);
    // until the sheet's script is updated they just wait on this device and the rest syncs as usual.
    const LIST = { profile: "profiles", bet: "bets", comment: "comments", pick: "picks" };
    const isExtra = k => k === "comment" || k === "pick";
    let serverApi = 1, inflight = null;

    const box = () => (db.outbox ||= []);
    const pending = () => box().length;
    // changes that can be sent right now (comments and picks wait while the sheet's script is the older version)
    const waiting = () => box().filter(e => !isExtra(e.k) || serverApi >= 2).length;

    // Queue a change. Entries hold only a reference; the record itself is read when it is sent,
    // so the latest version always goes out and repeated edits collapse into one call.
    function push(body) {
        if (!cfg) return;
        const e = body.action === "replaceAll" ? { a: "replaceAll" }
            : { a: body.action, k: body.kind, id: body.action === "upsert" ? body.record.id : body.id };
        const dup = box().some(x => x.a === e.a && x.k === e.k && x.id === e.id && x !== inflight);
        if (!dup) { box().push(e); save(); }
        flush();
    }
    const pushBet = id => push({ action: "upsert", kind: "bet", record: { id } });

    function buildBody(e) {
        if (e.a === "replaceAll") return { action: "replaceAll", profiles: db.profiles, bets: db.bets, comments: db.comments, picks: db.picks };
        if (e.a === "remove") return { action: "remove", kind: e.k, id: e.id };
        const record = db[LIST[e.k]].find(r => r.id === e.id);
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
            for (;;) {
                const i = box().findIndex(e => !isExtra(e.k) || serverApi >= 2);     // skip changes the sheet can't take yet
                if (i < 0) break;
                const entry = inflight = box()[i];
                const body = buildBody(entry);
                if (body) {
                    try {
                        await send(body);
                        // remember which records the sheet now has, so a remote delete is not undone
                        const s = new Set(db.syncedIds || []);
                        if (body.action === "upsert") s.add(body.record.id);
                        if (body.action === "remove") s.delete(body.id);
                        if (body.action === "replaceAll") { s.clear(); [...body.profiles, ...body.bets, ...(body.comments || []), ...(body.picks || [])].forEach(r => s.add(r.id)); }
                        db.syncedIds = [...s];
                    } catch (err) {
                        if (!REFUSED.includes(err.message)) {       // offline or a server hiccup: keep it all and retry later
                            console.error("sync", err); setStatus("error"); return;
                        }
                        console.error("sync refused", err.message);   // refused for good: drop it, the next pull restores the truth
                    }
                }
                box().splice(box().indexOf(entry), 1); save();
            }
            setStatus("synced");
        } finally { flushing = false; inflight = null; }
    }

    async function pull() {
        if (!cfg || flushing) return;
        if (waiting()) { await flush(); if (waiting()) return; }     // send our changes first, never overwrite them
        let remote;
        try {
            const res = await fetch(`${cfg.url}?secret=${encodeURIComponent(cfg.secret)}`);
            remote = await res.json();
            if (remote.error || !Array.isArray(remote.profiles)) throw new Error(remote.error || "bad response");
            serverApi = remote.api || 1;
        } catch (e) { console.error("sync", e); setStatus("error"); return; }
        remote.comments ||= []; remote.picks ||= [];
        if (flushing) return;
        if (waiting()) { flush(); return; }            // a local change started while we were fetching (or the script was just updated): send, pull next time

        const before = JSON.stringify([db.profiles, db.bets, db.comments, db.picks]);
        const synced = new Set(db.syncedIds || []);
        const remoteEmpty = !remote.profiles.length && !remote.bets.length && !remote.comments.length && !remote.picks.length;

        if (remoteEmpty && (db.profiles.length || db.bets.length)) {
            // sheet is empty: upload what this device has. Profiles can only be
            // created by an admin, so they are skipped unless the admin PIN is unlocked.
            if (adminPin !== null) db.profiles.forEach(p => push({ action: "upsert", kind: "profile", record: p }));
            db.bets.forEach(b => push({ action: "upsert", kind: "bet", record: b }));
            db.comments.forEach(c => push({ action: "upsert", kind: "comment", record: c }));
            db.picks.forEach(p => push({ action: "upsert", kind: "pick", record: p }));
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
            // a sheet that can't store these yet (older script) never deletes them: keep ours untouched
            if (serverApi >= 2) {
                db.comments = merge(db.comments, remote.comments, "comment");
                db.picks = merge(db.picks, remote.picks, "pick");
            }
            db.syncedIds = [...remote.profiles, ...remote.bets, ...remote.comments, ...remote.picks].map(r => r.id);
        }
        save();
        if (!waiting() && !flushing) setStatus("synced");
        if (serverApi >= 2 && waiting()) flush();                      // the script was updated: send what was waiting
        if (JSON.stringify([db.profiles, db.bets, db.comments, db.picks]) !== before) window.dispatchEvent(new Event("storage"));
    }

    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    /* ---------- Profiles ---------- */
    const COLORS = ["#3ea6ff", "#34d399", "#f5b942", "#f87171", "#a78bfa", "#f472b6", "#22d3ee", "#fb923c"];

    const memberOf = p => (p.groupIds && p.groupIds.length ? p.groupIds : [DEFAULT_GROUP]);
    const gid = r => r.groupId || DEFAULT_GROUP;
    const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
    const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

    /* ---------- Sign-in + current group ----------
       The signed-in profile is remembered on this device. The "current group" decides which
       profiles, bets, comments and picks every page shows. */
    const session = () => db.profiles.find(x => x.id === lsGet("bwmb.session")) || null;
    const myGroups = () => { const p = session(); return p ? db.groups.filter(g => memberOf(p).includes(g.id)) : db.groups.slice(); };
    const activeGroup = () => {
        const mine = myGroups(), saved = lsGet("bwmb.group");
        return (mine.find(g => g.id === saved) || mine[0] || db.groups[0]).id;
    };
    const setActiveGroup = id => { if (myGroups().some(g => g.id === id)) lsSet("bwmb.group", id); };
    const inGroup = r => gid(r) === activeGroup();
    const hashPass = async (p, pass) => {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(p.id + ":" + String(pass)));
        return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
    };
    // { ok, profile } | { ok:false, needsSetup, profile } | { ok:false, error }
    async function login(name, pass) {
        const p = db.profiles.find(x => x.name.toLowerCase() === String(name || "").trim().toLowerCase());
        if (!p) return { ok: false, error: "no_user" };
        if (!p.pass) return { ok: false, needsSetup: true, profile: p };
        if (await hashPass(p, pass) !== p.pass) return { ok: false, error: "bad_pass" };
        lsSet("bwmb.session", p.id); lsSet("bwmb.lastProfile", p.id); return { ok: true, profile: p };
    }
    async function setPasscode(profileId, pass, { signIn } = {}) {
        const p = db.profiles.find(x => x.id === profileId); if (!p) throw new Error("No such profile.");
        if (String(pass).length < 4) throw new Error("Use at least 4 characters.");
        p.pass = await hashPass(p, pass); save(); push({ action: "upsert", kind: "profile", record: p });
        if (signIn) { lsSet("bwmb.session", p.id); lsSet("bwmb.lastProfile", p.id); }
    }
    function resetPasscode(profileId) {
        const p = db.profiles.find(x => x.id === profileId);
        if (p) { delete p.pass; save(); push({ action: "upsert", kind: "profile", record: p }); }
    }
    const logout = () => lsSet("bwmb.session", null);

    const allProfiles = () => db.profiles.slice();
    const profiles = () => db.profiles.filter(p => memberOf(p).includes(activeGroup()));
    const profile = id => db.profiles.find(p => p.id === id);

    /* ---------- Groups (super admin) ---------- */
    const groups = () => db.groups.slice();
    const group = id => db.groups.find(g => g.id === id);
    function addGroup(name, color) {
        name = String(name || "").trim();
        if (!name) throw new Error("Group name is required.");
        if (db.groups.some(g => g.name.toLowerCase() === name.toLowerCase())) throw new Error("A group with that name already exists.");
        const g = { id: uid(), name, color: color || COLORS[db.groups.length % COLORS.length] };
        db.groups.push(g); save(); return g;
    }
    function updateGroup(id, f) {
        const g = group(id); if (!g) return;
        if (f.name !== undefined) {
            const n = f.name.trim(); if (!n) throw new Error("Group name is required.");
            if (db.groups.some(x => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) throw new Error("A group with that name already exists.");
            g.name = n;
        }
        if (f.color) g.color = f.color;
        save();
    }
    function deleteGroup(id) {
        if (db.groups.length < 2) throw new Error("You need at least one group.");
        db.groups = db.groups.filter(g => g.id !== id);
        db.profiles.forEach(p => { if (p.groupIds) p.groupIds = p.groupIds.filter(x => x !== id); });
        db.bets = db.bets.filter(b => gid(b) !== id);
        const ids = new Set(db.bets.map(b => b.id));
        db.comments = db.comments.filter(c => ids.has(c.betId));
        db.picks = db.picks.filter(p => gid(p) !== id);
        save();
    }
    function setMembership(profileId, groupId, on) {
        const p = profile(profileId); if (!p) return;
        const cur = new Set(memberOf(p)); on ? cur.add(groupId) : cur.delete(groupId);
        p.groupIds = [...cur]; save(); push({ action: "upsert", kind: "profile", record: p });
    }
    const groupStats = id => ({
        members: db.profiles.filter(p => memberOf(p).includes(id)).length,
        bets: db.bets.filter(b => !b.deleted && gid(b) === id).length
    });

    function addProfile(name, color, groupIds) {
        name = name.trim();
        if (!name) throw new Error("Name is required.");
        if (db.profiles.some(p => p.name.toLowerCase() === name.toLowerCase()))
            throw new Error("That name is already taken.");
        const p = { id: uid(), name, color: color || COLORS[db.profiles.length % COLORS.length], groupIds: groupIds?.length ? groupIds : [activeGroup()] };
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
        const gone = new Set(db.bets.filter(b => b.profileId === id).map(b => b.id));
        db.bets = db.bets.filter(b => b.profileId !== id);
        db.comments = db.comments.filter(c => c.profileId !== id && !gone.has(c.betId));
        db.picks = db.picks.filter(p => p.profileId !== id);
        save(); push({ action: "remove", kind: "profile", id });   // the sheet also removes their bets, comments and picks
    }

    /* ---------- Bets ----------
       bet = { id, profileId, createdAt, type: "single"|"parlay",
               stake, odds (American), legs: [{ id, text, status }] }
       leg.status: "pending" | "won" | "lost"
       A parlay loses as soon as one leg loses, wins when every leg wins. */
    // Removed bets are soft-deleted: flagged, hidden everywhere, and recoverable by an admin.
    const byNewest = (a, b) => b.createdAt - a.createdAt;
    const bets = () => db.bets.filter(b => !b.deleted && inGroup(b)).sort(byNewest);
    const removedBets = () => db.bets.filter(b => b.deleted && inGroup(b)).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

    function addBet({ profileId, type, stake, odds, legs, privateAmount, book }) {
        if (!profile(profileId)) throw new Error("Pick a profile.");
        // a leg is a plain string (custom) or { text, pick } built from the dropdowns
        const clean = legs.map(l => typeof l === "string" ? { text: l.trim() } : { text: String(l.text).trim(), pick: l.pick })
            .filter(l => l.text);
        // pre-game bets close at kickoff; a leg flagged live (placed on a game in progress) is allowed
        if (clean.some(l => l.pick?.start && !l.pick.live && Date.parse(l.pick.start) <= Date.now()))
            throw new Error("A game in this bet has already kicked off. Pick it from the live games to place a live bet.");
        if (type === "parlay" && clean.length < 2) throw new Error("A parlay needs at least 2 legs.");
        if (type === "single" && clean.length < 1) throw new Error("Describe your bet.");
        if (!(stake > 0)) throw new Error("Enter a stake above 0.");
        if (!Number.isFinite(odds) || Math.abs(odds) < 100) throw new Error("Odds must be American, like -110 or +250.");
        const bet = {
            id: uid(), profileId, groupId: activeGroup(), createdAt: Date.now(), type, stake, odds, private: !!privateAmount, book: book || "",
            legs: (type === "single" ? clean.slice(0, 1) : clean).map(l => ({ id: uid(), text: l.text, status: "pending", ...(l.pick ? { pick: l.pick } : {}) }))
        };
        db.bets.push(bet); save(); pushBet(bet.id); return bet;
    }
    /* ---------- Comments ---------- comment = { id, betId, profileId, text, createdAt } */
    const comments = betId => db.comments.filter(c => c.betId === betId).sort((a, b) => a.createdAt - b.createdAt);
    function addComment({ betId, profileId, text }) {
        text = String(text || "").trim().slice(0, 200);
        if (!profile(profileId)) throw new Error("Pick your profile first.");
        if (!db.bets.some(b => b.id === betId && !b.deleted)) throw new Error("That bet is gone.");
        if (!text) throw new Error("Write something first.");
        const c = { id: uid(), betId, profileId, text, createdAt: Date.now() };
        db.comments.push(c); save(); push({ action: "upsert", kind: "comment", record: c }); return c;
    }
    function removeComment(id) {                     // admin
        db.comments = db.comments.filter(c => c.id !== id);
        save(); push({ action: "remove", kind: "comment", id });
    }
    const allComments = () => db.comments.filter(c => { const b = db.bets.find(x => x.id === c.betId); return !b || inGroup(b); }).sort((a, b) => b.createdAt - a.createdAt);

    /* ---------- Pool picks ----------
       pick = { id, mode: "survivor"|"pickem", profileId, season, week, eventId, teamId, teamAbbr, teamName,
                gameLabel, start, createdAt }
       survivor: one pick per player per week (id is per week, so choosing again replaces it)
       pickem:   one pick per player per game */
    const picks = () => db.picks.filter(inGroup);
    function setPick(r) {
        if (!profile(r.profileId)) throw new Error("Pick your profile first.");
        if (Date.parse(r.start) <= Date.now()) throw new Error("That game has already kicked off.");
        const suffix = activeGroup() === DEFAULT_GROUP ? "" : `:${activeGroup()}`;       // the default group keeps its old ids
        const id = (r.mode === "survivor" ? `sv:${r.profileId}:${r.season}:${r.week}` : `pe:${r.profileId}:${r.eventId}`) + suffix;
        const old = db.picks.find(p => p.id === id);
        if (old && old.eventId !== r.eventId && Date.parse(old.start) <= Date.now())
            throw new Error("Your pick for this week is locked: its game already kicked off.");
        if (r.mode === "survivor" && db.picks.some(p => inGroup(p) && p.mode === "survivor" && p.profileId === r.profileId &&
                p.season === r.season && p.week !== r.week && p.teamId === r.teamId))
            throw new Error(`You already used ${r.teamName} in an earlier week.`);
        const p = { ...r, id, groupId: activeGroup(), createdAt: Date.now() };
        db.picks = db.picks.filter(x => x.id !== id); db.picks.push(p);
        save(); push({ action: "upsert", kind: "pick", record: p }); return p;
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

    // Bets lost within the last `windowMs`. A bet is lost the moment a leg loses; `legs` are the ones that missed.
    function recentLosses(windowMs) {
        const cutoff = Date.now() - windowMs;
        return db.bets.filter(b => !b.deleted && inGroup(b) && betStatus(b) === "lost").map(b => {
            const missed = b.legs.filter(l => l.status === "lost");
            if (!missed.every(l => l.settledAt)) return null;          // settled before times were recorded: don't announce
            return { bet: b, missed, at: Math.min(...missed.map(l => l.settledAt)) };
        }).filter(x => x && x.at >= cutoff).sort((a, b) => b.at - a.at);
    }

    // Hits settled within the last `windowMs`: individual legs, and whole bets that have fully hit.
    function recentHits(windowMs) {
        const cutoff = Date.now() - windowMs, legs = [], full = [];
        db.bets.filter(b => !b.deleted && inGroup(b)).forEach(b => {
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
        db = { profiles: d.profiles, bets: d.bets, comments: d.comments || db.comments, picks: d.picks || db.picks,
               pinHash: db.pinHash || d.pinHash || null, syncedIds: db.syncedIds, outbox: db.outbox || [] };
        save(); push({ action: "replaceAll" });
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
        COLORS, esc, allProfiles, profiles, profile, groups, group, addGroup, updateGroup, deleteGroup, setMembership, groupStats, memberOf,
        session, myGroups, activeGroup, setActiveGroup, login, setPasscode, resetPasscode, logout, addProfile, updateProfile, deleteProfile,
        comments, allComments, addComment, removeComment, picks, setPick,
        bets, removedBets, addBet, setLegStatus, recentHits, recentLosses, removeBet, restoreBet, deleteBet, betStatus, betProfit, multiplier, exposure, fmtOdds, money,
        adminLogin, adminLogout, isAdmin, adminPost, exportData, importData,
        reload() { db = Object.assign(EMPTY(), load()); ensureGroups(); }
    };
})();
