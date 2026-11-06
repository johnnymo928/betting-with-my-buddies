/* ============================================================
   Roasts shown on the red "bet lost" banner and in the ticker.
   Friendly ribbing between buddies. Add, remove or rewrite lines freely:
   {name} is replaced with the player's name. Keep them playful.
   Each lost bet gets one at random, and the same bet always gets the same one.
   ============================================================ */
const Roasts = (() => {
    const LINES = [
        "{name}, that pick had the confidence of a lion and the results of a houseplant.",
        "Somewhere a coin flip just felt sorry for {name}.",
        "{name} read the odds the way most people read terms and conditions: not at all.",
        "Bold strategy, {name}. Let's see how it plays out... oh. That's how.",
        "{name} didn't lose money, they made a very generous donation to the sportsbook.",
        "The sportsbook just sent {name} a thank-you card.",
        "{name}'s picks should come with a warning label.",
        "Breaking news: {name} is still not a bookie.",
        "{name} has the touch of a golfer swinging a hockey stick.",
        "Experts agree: {name} should consult an expert.",
        "{name} picked with their heart and their heart has terrible taste.",
        "That wasn't a bet, {name}. That was a tip jar with extra steps.",
        "If bad picks were an Olympic sport, {name} would at least medal in the opening ceremony.",
        "{name}'s lucky socks have officially filed for retirement.",
        "The only thing {name} beat today was the spread of embarrassment.",
        "Hot take from {name}, served ice cold.",
        "Even the kicker is shaking his head at {name}.",
        "{name} is the reason the sportsbook has a nice lobby.",
        "Plot twist: the underdog was {name}'s bankroll all along.",
        "{name} saw the line, ignored the line, and became the line.",
        "Thoughts and prayers for {name}'s ticket.",
        "{name}, a magic eight ball would have done better, and it's mostly empty space.",
        "A dart-throwing monkey just texted {name} to ask for notes. He declined.",
        "{name} confidently walked into a rake. Again.",
        "Not to pile on, {name}, but the pile is already pretty big.",
        "{name}'s gut feeling called. It wants a refund.",
        "The refs, the bounce, the weather, and {name}'s judgment all disagreed. One of them was right.",
        "{name} treats the odds as a suggestion. The odds disagree.",
        "That ticket had a better chance of being framed than cashed, {name}.",
        "{name} went all in on vibes. The vibes left early.",
        "If you squint, {name}'s pick was almost correct. Stop squinting.",
        "{name} is proof that confidence and accuracy are not related.",
        "The scoreboard has seen enough of {name}'s picks and requests a break.",
        "{name}'s research method: close eyes, point, regret.",
        "Another one for the {name} highlight reel. The wrong kind of highlight.",
        "{name} must be playing a long game. A very, very long game.",
        "Somebody check on {name}'s picks, they're not feeling well.",
        "Respect to {name} for committing to the bit.",
        "{name} didn't miss the pick by much. Just by all of it.",
        "Statistically, {name} should have gotten one of those by accident."
    ];

    // The same bet always gets the same roast (so it doesn't change on refresh or between devices)
    function pick(id, name) {
        let h = 0;
        for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        return LINES[h % LINES.length].replace(/\{name\}/g, name || "Someone");
    }
    return { pick, count: LINES.length };
})();
