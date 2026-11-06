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
        db.profiles.push(p); save(); return p;
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
        save();
    }
    function deleteProfile(id) {
        db.profiles = db.profiles.filter(p => p.id !== id);
        db.bets = db.bets.filter(b => b.profileId !== id);
        save();
    }

    /* ---------- Bets ----------
       bet = { id, profileId, createdAt, type: "single"|"parlay",
               stake, odds (American), legs: [{ id, text, status }] }
       leg.status: "pending" | "won" | "lost"
       A parlay loses as soon as one leg loses, wins when every leg wins. */
    const bets = () => db.bets.slice().sort((a, b) => b.createdAt - a.createdAt);

    function addBet({ profileId, type, stake, odds, legs }) {
        if (!profile(profileId)) throw new Error("Pick a profile.");
        const clean = legs.map(t => String(t).trim()).filter(Boolean);
        if (type === "parlay" && clean.length < 2) throw new Error("A parlay needs at least 2 legs.");
        if (type === "single" && clean.length < 1) throw new Error("Describe your bet.");
        if (!(stake > 0)) throw new Error("Enter a stake above 0.");
        if (!Number.isFinite(odds) || Math.abs(odds) < 100) throw new Error("Odds must be American, like -110 or +250.");
        const bet = {
            id: uid(), profileId, createdAt: Date.now(), type, stake, odds,
            legs: (type === "single" ? clean.slice(0, 1) : clean).map(text => ({ id: uid(), text, status: "pending" }))
        };
        db.bets.push(bet); save(); return bet;
    }
    function setLegStatus(betId, legId, status) {
        const leg = db.bets.find(b => b.id === betId)?.legs.find(l => l.id === legId);
        if (leg) { leg.status = status; save(); }
    }
    function deleteBet(id) { db.bets = db.bets.filter(b => b.id !== id); save(); }

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
    const fmtOdds = o => (o > 0 ? "+" : "") + o;
    const money = n => (n < 0 ? "-$" : "$") + Math.abs(n).toFixed(2);

    /* ---------- Admin PIN (light protection only: the site is public) ---------- */
    const hash = s => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return String(h); };
    const hasPin = () => !!db.pinHash;
    const setPin = pin => { db.pinHash = hash(pin); save(); };
    const checkPin = pin => db.pinHash === hash(pin);

    /* ---------- Backup ---------- */
    const exportData = () => JSON.stringify(db, null, 2);
    function importData(text) {
        const d = JSON.parse(text);
        if (!Array.isArray(d.profiles) || !Array.isArray(d.bets)) throw new Error("Not a valid backup file.");
        db = { profiles: d.profiles, bets: d.bets, pinHash: db.pinHash || d.pinHash || null };
        save();
    }

    return {
        COLORS, esc, profiles, profile, addProfile, updateProfile, deleteProfile,
        bets, addBet, setLegStatus, deleteBet, betStatus, betProfit, multiplier, fmtOdds, money,
        hasPin, setPin, checkPin, exportData, importData,
        reload() { db = Object.assign({ profiles: [], bets: [], pinHash: null }, load()); }
    };
})();
