
    
     let nflGames = [
   {
    matchup: "Carolina Panthers at Green Bay Packers",
    status: "Final"
},
    {
        matchup: "Chiefs (-6.5) vs Raiders",
        status: "24 - 21 Q4"
        
    },
    {
        matchup: "Bills (-2.5) vs Dolphins",
        status: "7:20 PM"
    },
    {
        matchup: "Cowboys (-1.5) vs Eagles",
        status: "8:20 PM"
    },
    {
        matchup: "Lions (-4.5) vs Bears",
        status: "1:00 PM"
    },
    {
        matchup: "Packers (+2.5) vs Vikings",
        status: "4:25 PM"
    },
    {
        matchup: "Ravens (-7) vs Browns",
        status: "1:00 PM"
    },
    {
        matchup: "49ers (-3) vs Rams",
        status: "8:20 PM"
    }
];

const nflContainer = document.getElementById("nfl-container");
const tickerContent =
    document.getElementById("ticker-content");

let currentNFLPage = 0;

function renderNFLGames() {

    nflContainer.innerHTML = "";

    const start = currentNFLPage * 4;

    const gamesToShow = nflGames.slice(start, start + 4);
document.getElementById("nfl-status").innerText =
    `Showing Games ${start + 1}-${Math.min(start + 4, nflGames.length)} of ${nflGames.length}`;
    gamesToShow.forEach(game => {

       nflContainer.innerHTML += `
    <div class="game">
        <div>${game.matchup}</div>
        <span>${game.status}</span>
    </div>
`;

    });

}

renderNFLGames();
setInterval(() => {

    currentNFLPage++;

    const totalNFLPages = Math.ceil(nflGames.length / 4);

if(currentNFLPage >= totalNFLPages){
    currentNFLPage = 0;
}

    renderNFLGames();

}, 7000);

let ncaafGames = [
    {
        matchup: "Ohio State (-14.5) vs Iowa",
        status: "31 - 14"
    },
    {
        matchup: "Michigan (-7.5) vs Wisconsin",
        status: "17 - 13"
    },
    {
        matchup: "Oregon (-5.5) vs USC",
        status: "24 - 20"
    },
    {
    matchup: "Texas (-10.5) vs Baylor",
    status: "28 - 10"
},

{
    matchup: "Penn State (-3.5) vs USC",
    status: "21 - 17"
},
{
    matchup: "Alabama (-10.5) vs Tennessee",
    status: "35 - 24"
},
{
    matchup: "Notre Dame (-7) vs Louisville",
    status: "28 - 14"
},
{
    matchup: "LSU (-4) vs Auburn",
    status: "17 - 13"
}

];


const ncaafContainer = document.getElementById("ncaaf-container");

let currentNCAAFPage = 0;

function renderNCAAFGames() {

    ncaafContainer.innerHTML = "";

    const start = currentNCAAFPage * 4;

    const gamesToShow = ncaafGames.slice(start, start + 4);
document.getElementById("ncaaf-status").innerText =
    `Showing Games ${start + 1}-${Math.min(start + 4, ncaafGames.length)} of ${ncaafGames.length}`;
    gamesToShow.forEach(game => {

        ncaafContainer.innerHTML += `
            <div class="game">
                ${game.matchup}
                <span>${game.status}</span>
            </div>
        `;

    });

}

renderNCAAFGames();

setInterval(() => {

    currentNCAAFPage++;

    const totalNCAAFPages = Math.ceil(ncaafGames.length / 4);

if(currentNCAAFPage >= totalNCAAFPages){
    currentNCAAFPage = 0;
}

    renderNCAAFGames();

}, 7000);
function updateClock() {

    const now = new Date();

    const options = {
        weekday: "long",
        month: "short",
        day: "numeric"
    };

    const dateString = now.toLocaleDateString("en-US", options);

    const timeString = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
});

    document.getElementById("clock").innerText =
        `${dateString} • ${timeString}`;
}

updateClock();

setInterval(updateClock, 1000);




async function buildLiveNFLArray() {

    const response = await fetch(
        "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
    );

    const data = await response.json();

    const liveGames = data.events.map(event => ({

    matchup: event.name,

    status: (() => {

    const state = event.status.type.state;

    const awayScore =
        event.competitions[0].competitors[0].score;

    const homeScore =
        event.competitions[0].competitors[1].score;

    const spread =
        event.competitions[0].odds?.[0]?.details || "No Line";

    const overUnder =
        event.competitions[0].odds?.[0]?.overUnder || "N/A";

    if (state === "pre") {

        return event.status.type.shortDetail +
            " • " +
            spread +
            " • O/U " +
            overUnder;

    }

    return awayScore +
        "-" +
        homeScore +
        " " +
        event.status.type.shortDetail +
        " • " +
        spread +
        " • O/U " +
        overUnder;

})()
}));

nflGames = liveGames;

currentNFLPage = 0;

renderNFLGames();

tickerContent.innerText =
    "🏈 NFL TICKER • " +
    liveGames
        .map(game =>
            `${game.matchup} • ${game.status}`
        )
        .join(" • ");



}

buildLiveNFLArray();
setInterval(buildLiveNFLArray, 60000);
async function buildLiveNCAAFArray() {

    const response = await fetch(
        "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard"
    );

    const data = await response.json();

    const liveGames = data.events.map(event => ({

    matchup: event.name,

    status: (() => {

    const state = event.status.type.state;

    const awayScore =
        event.competitions[0].competitors[0].score;

    const homeScore =
        event.competitions[0].competitors[1].score;

    const spread =
        event.competitions[0].odds?.[0]?.details || "No Line";

    const overUnder =
        event.competitions[0].odds?.[0]?.overUnder || "N/A";

    if (state === "pre") {

        return event.status.type.shortDetail +
            " • " +
            spread +
            " • O/U " +
            overUnder;

    }

    return awayScore +
        "-" +
        homeScore +
        " " +
        event.status.type.shortDetail +
        " • " +
        spread +
        " • O/U " +
        overUnder;

})()
}));

    ncaafGames = liveGames;

    currentNCAAFPage = 0;

    renderNCAAFGames();

    

}

buildLiveNCAAFArray();
setInterval(buildLiveNCAAFArray, 60000);