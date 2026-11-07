/* ============================================================
   Roasts shown on the red "bet lost" banner and in the ticker.
   Adult humor between buddies: crude and cocky, but aimed at the pick, never at who someone is.
   Add, remove or rewrite lines freely. {name} is replaced with the player's name.
   Each lost bet gets one at random, and the same bet always gets the same one.
   ============================================================ */
const Roasts = (() => {
    const LINES = [
        "{name} got absolutely railed by that ticket and didn't even get a dinner first.",
        "{name}'s picks have the staying power of a guy at his first sleepover. Done in 30 seconds.",
        "That bet went down faster than {name}'s date's opinion of him.",
        "{name} just got screwed harder than a hardware store.",
        "Congrats {name}, you've been fully pegged by the sportsbook.",
        "{name} tapped out before the second half. Classic.",
        "The only thing {name} cashed today was a check his ego can't afford.",
        "{name} bet with his heart and his heart is a dumbass.",
        "That pick was limper than {name} on a cold morning.",
        "{name} couldn't hit that with a bat, a glove, and a map.",
        "Somewhere a bookie lit a cigar with {name}'s money.",
        "{name} is a donor. Not a bettor. A donor.",
        "{name} walked in with confidence and walked out with a hole where his money used to be.",
        "Pretty sure {name}'s picks are what the sportsbook uses to calm down after a bad day.",
        "{name} went deep. Unfortunately the pick did not.",
        "Fun fact: {name} has less accuracy than a drunk guy at a urinal.",
        "The house just sent {name} a thank-you card and a cigarette.",
        "{name}, a bad bet is like a bad ex. Expensive, loud, and you keep going back.",
        "{name} blew it. Not in the fun way.",
        "That ticket wasn't a bet, it was an expensive way for {name} to say 'I don't know ball.'",
        "{name} has the foresight of a mole with a hangover.",
        "{name} is the reason there's a gambling hotline and a whole lot of therapists.",
        "Bad news {name}: it wasn't a bad beat. It was just a bad pick. A really, really bad pick.",
        "{name} stayed hard for the ticket and went soft when the game started.",
        "{name} could lose a coin flip with a two-headed coin.",
        "{name} fumbled that harder than a drunk uncle at a barbecue.",
        "If {name} were a stripper, the only thing he'd be making is rent... for the sportsbook.",
        "Absolute dogshit pick, {name}. We're proud of you for trying.",
        "{name}'s bankroll is on life support and the picks keep pulling the plug.",
        "The only streak {name} is on is the one he leaves in his underwear after that loss.",
        "Holy hell {name}, even your luck wants a restraining order.",
        "{name} touched the stove, got burned, and will do it again Sunday.",
        "That pick had the same energy as {name} texting his ex at 2am. Terrible, and everyone saw it.",
        "{name} treats every bet like a tinder date. Hopeful, delusional, and ghosted by the end.",
        "{name} just lost money with the confidence of a man who owns three fantasy teams and no wins.",
        "Nobody is crying for {name}, they're just laughing in the group chat.",
        "{name} is two more bad picks away from selling his plasma.",
        "It's not that {name} is unlucky. It's that the dice, the refs, and the bookie all agree he's a clown.",
        "{name}'s sportsbook account is basically an OnlyFans for the house. They keep paying for nothing.",
        "{name} just got eliminated faster than a Vegas buffet in a hurricane.",
        "That loss is on {name}'s mom. She's the one who told him he was good at everything.",
        "{name} picked wrong the way some folks get up in the morning. Instinctively, and with regret.",
        "Hold {name}'s beer, because he's definitely about to chase this loss.",
        "{name} is bad at this the way a cat is bad at being wet. Loudly and often.",
        "If {name}'s picks were a sex position, it'd be the 'nobody finishes' special.",
        "Dear {name}: your 'lock of the week' came back with a restraining order.",
        "{name}'s ticket got shredded harder than a deer in hunting season.",
        "{name}, congratulations. You played yourself, and the game, and the whole damn spread.",
        "Somewhere in Vegas a slot machine just whispered 'amateur' at {name}.",
        "The only thing {name} is cashing in is his 'bad ideas' loyalty card.",
        "{name} gave it everything he had. Sadly it was nothing."
    ];

    // The same bet always gets the same roast (so it doesn't change on refresh or between devices)
    function pick(id, name) {
        let h = 0;
        for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        return LINES[h % LINES.length].replace(/\{name\}/g, name || "Someone");
    }
    return { pick, count: LINES.length };
})();
