
const { resolveDataDir } = require('./common');
const { checkTableExists, execSqlFile } = require('./db-utils');

const sqlite3 = require('better-sqlite3');

const crypto = require("crypto");
const path = require('path');

const DEFAULT_PLAYER_SCORE = 1500; // Elo score assigned to a player that has never player any game.

// The "skill factor" influences how a difference of Elo scores between two players tips the
// odds of a player winning against another.
// The higher the value, the more the difference of scores will unbalance the odds; that is, 
// the chance of a low skilled player winning against a skilled opponent is reduced.
// Lower values for the "skill factor" reduce the effect of differences in the Elo scores.
// Chess uses a value of 1/400. 
// For babyfoot, we will be using 1/500. A lower value that is consistent with the fact that 
// sometimes a win is more the result of luck rather than skills. (in french: l'effet chatteman)
const SKILL_FACTOR = 1 / 500;

let ctx = {
    database: null,
    playerTable: [],
    gameMap: new Map(),
    scoreTracker: null,
};

function initDatabase(db) {
    const srcpath = path.join(__dirname, 'CreateDatabase.sql');
    console.log("Initializing database...");
    execSqlFile(db, srcpath);
    console.log("Database initialized!");
}

function getDatabase() {
    return ctx.database;
}

function getPlayerById(id) {
    return id >= 0 && id < ctx.playerTable.length ? ctx.playerTable[id] : null;
}

function getPlayerByUsername(username) {
    for (const p of ctx.playerTable) {
        if (p && p.username == username) {
            return p;
        }
    }
    return null;
}

function getAllPlayers() {
    let result = [];
    for (const p of ctx.playerTable) {
        if (p) {
            result.push(p);
        }
    }
    return result;
}

function getActivePlayers() {
    let result = [];
    for (const p of ctx.playerTable) {
        if (p && p.active) {
            result.push(p);
        }
    }
    return result;
}

function resolvePlayer(p) {
    if (typeof p == 'string') {
        return getPlayerByUsername(p);
    } else if (typeof p == 'number') {
        return getPlayerById(p);
    }
    return p;
}

function insertPlayerIntoTable(p) {
    while (ctx.playerTable.length <= p.id) {
        ctx.playerTable.push(null);
    }
    ctx.playerTable[p.id] = p;
}

function getAllGames() {
    let games = [];
    ctx.gameMap.forEach(value => {
        games.push(value);
    });
    return games;
}

function insertIntoGameMap(g) {
    ctx.gameMap.set(g.uuid, g);
}

class Player {
    id;
    username;
    firstName;
    lastName;
    active = true;
    shortName;

    constructor(id, user, firstName, lastName) {
        this.id = id;
        this.username = user;
        this.firstName = firstName;
        this.lastName = lastName;
        this.shortName = this.firstName;
    }

    won(game) {
        if (game && game.winningTeam == 1) {
            return this == game.player1 || this == game.player2;
        } else if (game && game.winningTeam == 2) {
            return this == game.player3 || this == game.player4;
        }

        return false;
    }

    get fullName() {
        return this.firstName + " " + this.lastName;
    }
}

class Game {
    uuid;
    submissionDate;
    submittedBy;
    gameDate;
    player1;
    player2;
    player3;
    player4;
    team1Score;
    team2Score;

    constructor(uuid) {
        if (!uuid) {
            this.uuid = crypto.randomUUID();
        } else {
            this.uuid = uuid;
        }
    }

    get winningTeam() {
        return this.team1Score > this.team2Score ? 1 : 2;
    }

    get losingTeam() {
        return 1 + (2 - this.winningTeam);
    }

    getTeamOfPlayer(p) {
        if (p == this.player1 || p == this.player2) {
            return 1;
        } else if (p == this.player3 || p == this.player4) {
            return 2;
        }

        return 0;
    }

    getTeamScore(teamNumber) {
        if (teamNumber == 1) return this.team1Score;
        if (teamNumber == 2) return this.team2Score;
        return 0;
    }

    // Returns an array of size 3, with the first element being
    // the player's partner and the other two elements being 
    // its rivals.
    getPartnerAndRivalsOfPlayer(p) {
        if (p == this.player1) return [this.player2, this.player3, this.player4];
        if (p == this.player2) return [this.player1, this.player3, this.player4];
        if (p == this.player3) return [this.player4, this.player1, this.player2];
        if (p == this.player4) return [this.player3, this.player1, this.player2];
        return [];
    }
}

class PlayerRating {
    player;
    score;
    game;
    gamesPlayed = 0;
    previous = null;

    constructor(player, score, game, previous) {
        this.player = player;
        this.score = score;
        this.game = game;
        this.previous = previous;

        if (!this.score) {
            this.score = DEFAULT_PLAYER_SCORE;
        }

        if (this.previous) {
            this.gamesPlayed = 1 + this.previous.gamesPlayed;
        }
    }

    expectedScoreAgainst(otherPlayerRating) {
        console.assert(otherPlayerRating instanceof PlayerRating);
        return 1 / (1 + Math.pow(10, SKILL_FACTOR * (otherPlayerRating.score - this.score)));
    }
}

class GameRating {
    game;
    ratingPlayer1;
    ratingPlayer2;
    ratingPlayer3;
    ratingPlayer4;

    constructor(game, playerRatings) {
        this.game = game;
        console.assert(playerRatings.length == 4);
        this.ratingPlayer1 = playerRatings[0];
        this.ratingPlayer2 = playerRatings[1];
        this.ratingPlayer3 = playerRatings[2];
        this.ratingPlayer4 = playerRatings[3];
    }

    get ratings() {
        return [this.ratingPlayer1, this.ratingPlayer2, this.ratingPlayer3, this.ratingPlayer4];
    }
}

function calculatePointFactor(scoreDiff) {
    return 2 + Math.pow(Math.log(scoreDiff + 1) / Math.log(10), 3);
}

class EloScoreTracker {
    playerRatingTable;
    gameRatings;

    constructor() {
        this.playerRatingTable = [];
        this.gameRatings = [];
    }

    getPlayerRating(p) {
        p = resolvePlayer(p);
        console.assert(p);

        while (this.playerRatingTable.length <= p.id) {
            this.playerRatingTable.push(null);
        }

        if (!this.playerRatingTable[p.id]) {
            this.playerRatingTable[p.id] = new PlayerRating(p);
        }

        return this.playerRatingTable[p.id];
    }

    getActivePlayersRatings() {
        return this.playerRatingTable.filter(e => e && e.player.active);
    }

    #updatePlayerRating(player, newScore, game, prev) {
        console.assert(player && typeof player == 'object');
        console.assert(player.id < this.playerRatingTable.length);
        let result = new PlayerRating(player, newScore, game, prev);
        this.playerRatingTable[player.id] = result;
        return result;
    }

    processGame(game) {
        if (this.gameRatings.length && game.gameDate < this.gameRatings.at(-1).game.gameDate) {
            // the game we need to process occurred before the last processed game.
            // since games need to be processed in chronological order, we are out of luck.
            // it is simpler to reprocess every game.
            // hopefully this won't happen very often as games are supposed to be submitted 
            // just after being played.
            return this.rebuild();
        }

        const players = [
            this.getPlayerRating(game.player1), 
            this.getPlayerRating(game.player2), 
            this.getPlayerRating(game.player3), 
            this.getPlayerRating(game.player4)
        ];

        const expected_player_scores = [
            0.5 * (players[0].expectedScoreAgainst(players[2]) + players[0].expectedScoreAgainst(players[3])),
            0.5 * (players[1].expectedScoreAgainst(players[2]) + players[1].expectedScoreAgainst(players[3])),
            0.5 * (players[2].expectedScoreAgainst(players[0]) + players[2].expectedScoreAgainst(players[1])),
            0.5 * (players[3].expectedScoreAgainst(players[0]) + players[3].expectedScoreAgainst(players[1]))
        ];

        const team_expected_scores = [
            0.5 * (expected_player_scores[0] + expected_player_scores[1]),
            0.5 * (expected_player_scores[2] + expected_player_scores[3]),
        ];

        const team_actual_scores = [
            game.winningTeam == 1 ? 1 : 0,
            game.winningTeam == 2 ? 1 : 0,
        ];

        const diff = Math.abs(game.team1Score - game.team2Score);
        const pointfactor = calculatePointFactor(diff);

        const k = players.map(playerRating => 50 / (1 + playerRating.gamesPlayed / 300));

        let new_player_ratings = [];

        for (const i in players) {
            const playerrating = players[i];
            const player = playerrating.player;
            const teamNumber = game.getTeamOfPlayer(player);
            console.assert(teamNumber == 1 || teamNumber == 2);
            const teamIndex = teamNumber-1;
            const newscore = playerrating.score + k[i] * pointfactor * (team_actual_scores[teamIndex] - team_expected_scores[teamIndex]);
            let newrating = this.#updatePlayerRating(player, newscore, game, playerrating);
            new_player_ratings.push(newrating);
        }

        const game_ratings = new GameRating(game, new_player_ratings);
        this.gameRatings.push(game_ratings);

        return game_ratings;
    }

    rebuild() {
        this.playerRatingTable = [];
        this.gameRatings = [];

        let games = getAllGames();
        games.sort((a,b) => a.gameDate - b.gameDate);

        if (games.length) {
            for (const g of games) {
                this.processGame(g);
            }
        } else {
            // If no games have ever been played, give at least 
            // the default score to all active players.
            let players = getActivePlayers();
            for (const p of players) {
                this.getPlayerRating(p); // this will assign a score if none have been assigned before
            }
        }
    }

    getGameRatingsOrderedAsc() {
        return this.gameRatings;
    }

    getGameRatingByNumber(num) {
        if (num <= 0 || num > this.gameRatings.length) {
            return null;
        }
        return this.gameRatings[num-1];
    }
}

function init() {
    
    // setup database
    {
        let data_dir = resolveDataDir();

        let options = {
            readonly: false,
            fileMustExist: false
        };

        const filepath = path.join(data_dir, "2v2.db");
        ctx.database = new sqlite3(filepath, options);

        if (!checkTableExists(ctx.database, "Player")) {
            initDatabase(ctx.database);
        }
    }

    // load players from database
    {
        let stmt = ctx.database.prepare(`SELECT id, username, firstName, lastName, active FROM Player`);
        let allps = stmt.all();
        for (const row of allps) {
            let p = new Player(row.id, row.username, row.firstName, row.lastName);
            insertPlayerIntoTable(p);
        }

        buildPlayerShortNames();
    }

    // load games from database
    {
        let stmt = ctx.database.prepare(`SELECT uuid, submissionDate, submittedBy, gameDate, team1Player1Id, team1Player2Id, team2Player1Id, team2Player2Id, team1Score, team2Score FROM Game`);
        let allgs = stmt.all();
        for (const row of allgs) {
            let g = new Game(row.uuid);
            g.submissionDate = new Date(row.submissionDate * 1000);
            g.gameDate = new Date(row.gameDate * 1000);
            g.player1 = getPlayerById(row.team1Player1Id);
            g.player2 = getPlayerById(row.team1Player2Id);
            g.player3 = getPlayerById(row.team2Player1Id);
            g.player4 = getPlayerById(row.team2Player2Id);
            g.team1Score = row.team1Score;
            g.team2Score = row.team2Score;
            if (row.submittedBy) {
                g.submittedBy = getPlayerById(row.submittedBy);
            }
            insertIntoGameMap(g);
        }
    }

    ctx.scoreTracker = new EloScoreTracker();
    ctx.scoreTracker.rebuild();
}

function buildPlayerShortNames() {
    let players = getAllPlayers();

    if (!players || !players.length) return;

    players.sort((a,b) => {
        let comp = a.firstName.toLowerCase().localeCompare(b.firstName.toLowerCase());
        if (comp) return comp;
        return a.lastName.toLowerCase().localeCompare(b.lastName.toLowerCase());
    });

    for (let i = 0; i < players.length - 1; /* void */ ) {
        const current_first_name = players[i].firstName.toLowerCase();
        // If only I knew how to use iterators in javascript... 
        // would like to do some C++ std::find_if, starting from i+1
        let j = i+1;
        while (j < players.length) {
            if (players[j].firstName.toLowerCase() == current_first_name) {
                ++j;
            } else {
                break;
            }
        }

        const nb_namesake = j-i-1;
        if (!nb_namesake) {
            players[i].shortName = players[i].firstName;
            ++i;
            continue;
        } 

        // There are people with the same first name. 
        // We must find a way to distinguish them.
        // We will compute the minimum number of characters we must
        // take from their last to be able to tell them apart.

        let nmax = 0; // maximum number of chars we can use
        for (let k = i; k < j; ++k) {
            nmax = Math.max(nmax, players[k].lastName.length);
        }

        let n = 1; // number of chars we want to use
        while (n < nmax) {
            // let's see if `n` is enough
            let names = new Set();
            for (let k = i; k < j; ++k) {
                const e = players[k].lastName.substring(0, n).toLowerCase();
                if (names.has(e)) {
                    break;
                } else {
                    names.add(e);
                }
            }
            const enough = names.size == nb_namesake+1;
            if (enough) {
                break;
            } else {
                ++n;
            }
        }

        // compute short names for the current set of players with the same first name
        for (let k = i; k < j; ++k) {
            let player = players[k];
            player.shortName = player.firstName + " " + player.lastName.substring(0, n);
            if (n < player.lastName.length) {
                player.shortName += ".";
            }
        }

        // go on to the next player with a different first name
        i = j;
    }
}

function addPlayer(username, firstName, lastName) {
    // check if a player with the same username or (first,lane) names exists.
    for (const p of ctx.playerTable)
    {
        if (!p) continue;
        
        if ((p.username == username) || (p.firstName == firstName && p.lastName == lastName)) {
            return p.id;
        }
    }

    let stmt = ctx.database.prepare(`INSERT INTO Player(username, firstName, lastName) VALUES(?,?,?)`);
    const info = stmt.run(username, firstName, lastName);
    let p = new Player(info.lastInsertRowid, username, firstName, lastName);
    insertPlayerIntoTable(p);
    buildPlayerShortNames();

    return p;
}

function getAllGames() {
    let games = [];
    ctx.gameMap.forEach(g => games.push(g));
    return games;
}

function addGame(p1, p2, p3, p4, t1score, t2score, date, submittedBy) {
    // we start be reordering the data so that it appears consistently
    // in the same order in the database.
    // this is optional, but ought to make things easier to debug if there
    // is a problem.
    {
        if (p2.id < p1.id) {
            [p1, p2] = [p2, p1];
        }

        if (p4.id < p3.id) {
            [p3, p4] = [p4, p3];
        }

        if (p3.id < p1.id) {
            [p1, p2, p3, p4, t1score, t2score] = [p3, p4, p1, p2, t2score, t1score];
        }
    }

    submittedBy = resolvePlayer(submittedBy);

    let game = new Game();
    game.submissionDate = new Date();
    game.gameDate = date;
    game.player1 = p1;
    game.player2 = p2;
    game.player3 = p3;
    game.player4 = p4;
    game.team1Score = t1score;
    game.team2Score = t2score;
    game.submittedBy = submittedBy;

    let stmt = ctx.database.prepare(`INSERT INTO 
        Game(uuid, submissionDate, gameDate, team1Player1Id, team1Player2Id, team2Player1Id, team2Player2Id, team1Score, team2Score, submittedBy) 
        VALUES(?,?,?,?,?,?,?,?,?,?)
    `);
    const info = stmt.run(game.uuid, game.submissionDate.getTime() / 1000, date.getTime() / 1000, p1.id, p2.id, p3.id, p4.id, t1score, t2score, submittedBy?.id);

    if (!info || !info.lastInsertRowid) {
        return null;
    }

    insertIntoGameMap(game);
    ctx.scoreTracker.processGame(game);

    return game;
}

function getPlayerRatingsSortedByScore() {
    let ratings = ctx.scoreTracker.getActivePlayersRatings();
    ratings.sort((a,b) => b.score - a.score);
    return ratings;
}

function getMatchHistory() {
    // TODO: use toReversed() when available
    return ctx.scoreTracker.getGameRatingsOrderedAsc().slice().reverse();
}

function getActivePlayerScores() {
    let result = {};
    for (const playerRating of ctx.scoreTracker.playerRatingTable) {
        if (!playerRating || !playerRating.player.active) {
            continue;
        }

        result[playerRating.player.username] = {
            score: Math.floor(playerRating.score),
            shortName: playerRating.player.shortName
        };
    }
    return result;
}

class WinsAndLosses {
    wins = 0;
    losses = 0;

    record(didWin) {
        if (didWin) {
            this.wins += 1;
        } else {
            this.losses += 1;
        }
    }

    get totals() {
        return this.wins + this.losses;
    }

    get winrate() {
        return this.wins / this.totals;
    }

    get lossrate() {
        return this.losses / this.totals;
    }
}

function getPlayerMetrics(player) {
    player = resolvePlayer(player);
    console.assert(player);

    let games_played = 0;
    let total_points_scored = 0;
    let games_won = 0;

    const partners = new Map();
    const rivals = new Map();

    const get_stats_for = function(theMap, p) {
        let e = theMap.get(p);
        if (!e) {
            e = new WinsAndLosses();
            theMap.set(p, e);
        }
        return e;
    };
    
    for (const entry of ctx.gameMap) {
        const game = entry[1];
        const team_number = game.getTeamOfPlayer(player);
        if (!team_number) {
            continue;
        }

        ++games_played;
        total_points_scored += game.getTeamScore(team_number);
        const won_this_game = game.winningTeam == team_number;
        if (won_this_game) {
            ++games_won;
        }

        let pnr = game.getPartnerAndRivalsOfPlayer(player);

        get_stats_for(partners, pnr[0]).record(won_this_game);
        get_stats_for(rivals, pnr[1]).record(won_this_game);
        get_stats_for(rivals, pnr[2]).record(won_this_game);
    }

    if (!games_played) {
        return {
            player: {
                username: player.username,
                shortName: player.shortName
            },
            games: {
                played: 0,
                won: 0,
                lost: 0
            },
            totalPointsScored: 0
        };
    }

    const get_max_element = function(theMap, f) {
        let result = ["", null];
        let best = -1;
        for (const [otherPlayer, wnl] of theMap) {
            const val = f(wnl);
            if (val > best) {
                result[0] = otherPlayer.shortName;
                result[1] = wnl;
                best = val;
            }
        }
        return result;
    };

    const main_partner = get_max_element(partners, e => e.totals);
    const best_partner = get_max_element(partners, e => e.winrate);
    const worst_partner = get_max_element(partners, e => e.lossrate);

    const main_rival = get_max_element(rivals, e => e.totals);
    const easiest_rival = get_max_element(rivals, e => e.winrate);
    const strongest_rival = get_max_element(rivals, e => e.lossrate);

    const format_player = function(e) {
        return {
            shortName: e[0],
            wins: e[1].wins,
            losses: e[1].losses
        };
    }

    return {
        player: {
            username: player.username,
            shortName: player.shortName
        },
        games: {
            played: games_played,
            won: games_won,
            lost: games_played - games_won
        },
        totalPointsScored: total_points_scored,
        partners: {
            main: format_player(main_partner),
            best: format_player(best_partner),
            worst: format_player(worst_partner)
        },
        rivals: {
            main: format_player(main_rival),
            easiest: format_player(easiest_rival),
            strongest: format_player(strongest_rival)
        }
    };
}

function getPlayerRatingEvolution(player) {
    player = resolvePlayer(player);
    console.assert(player);

    let ratings = [];
    let dates = [];

    let rating_iterator = ctx.scoreTracker.getPlayerRating(player);

    while (rating_iterator && rating_iterator.game) {

        ratings.push(Math.round(rating_iterator.score));
        dates.push(rating_iterator.game.gameDate.getTime());
        rating_iterator = rating_iterator.previous;
    }

    ratings.reverse();
    dates.reverse();

    return {
        player: {
            username: player.username,
            shortName: player.shortName,
        },
        timeSeries: {
            x: dates,
            y: ratings
        }
    };
}

function resolveGameRatingNumber(numberOrId) {
    const gameratings = ctx.scoreTracker.getGameRatingsOrderedAsc();

    if (Number.isInteger(numberOrId)) {
        const idx = numberOrId - 1;
        if (idx < 0 || idx >= gameratings.length) {
            return 0;
        }
        return idx+1;
    }

    const idx = gameratings.findIndex(e => e.game.uuid.startsWith(numberOrId));
    return idx == -1 ? 0 : (idx+1);
}

function getGameInfo(numberOrId) {
    const num = resolveGameRatingNumber(numberOrId);
    if (!num) {
        return null;
    }

    const gr = ctx.scoreTracker.getGameRatingByNumber(num);
    const game = gr.game;

    const format_playerrating = function(pr) {
        return {
            username: pr.player.username,
            shortName: pr.player.shortName,
            gameNumber: pr.gamesPlayed,
            previousScore: pr.previous.score,
            newScore: pr.score
        };
    };

    let info = {
        id: game.uuid,
        number: num,
        date: game.gameDate,
        submissionDate: game.submissionDate,
        player1: format_playerrating(gr.ratingPlayer1),
        player2: format_playerrating(gr.ratingPlayer2),
        player3: format_playerrating(gr.ratingPlayer3),
        player4: format_playerrating(gr.ratingPlayer4),
        scoreTeam1: game.team1Score,
        scoreTeam2: game.team2Score,
    };

    if (game.submittedBy) {
        info.submittedBy = game.submittedBy.shortName;
    }

    const prev = ctx.scoreTracker.getGameRatingByNumber(num - 1);

    if (prev) {
        info.previousGame = {
            id: prev.game.uuid
        };
    }

    const next = ctx.scoreTracker.getGameRatingByNumber(num +1);
    if (next) {
        info.nextGame = {
            id: next.game.uuid
        };
    }

    return info;
}

function updatePlayerNames(player, newFirstName, newLastName) {
    player = resolvePlayer(player);
    console.assert(player);

    if (!newFirstName || !newFirstName.length) {
        newFirstName = player.firstName;
    }

    if (!newLastName || !newLastName.length) {
        newLastName = player.lastName;
    }

    player.firstName = newFirstName;
    player.lastName = newLastName;
    player.shortName = player.firstName;
    buildPlayerShortNames();
    
    let db = getDatabase();
    let stmt = db.prepare(`UPDATE Player SET firstName = ?, lastName = ? WHERE id = ?`);
    stmt.run(newFirstName, newLastName, player.id);
}

function updatePlayerUsername(player, newUsername) {
    console.assert(newUsername && newUsername.length);

    player = resolvePlayer(player);
    console.assert(player);

    if (player.username == newUsername) {
        return;
    }

    // check if username is already used
    {
        let other_player = getPlayerByUsername(newUsername);
        if (other_player) {
            return;
        }
    }
    
    player.username = newUsername;
    
    let db = getDatabase();
    let stmt = db.prepare(`UPDATE Player SET username = ? WHERE id = ?`);
    stmt.run(newUsername, player.id);
}

function deleteGame(gameId) {
    if (!ctx.gameMap.delete(gameId)) {
        return false;
    }

    ctx.scoreTracker.rebuild();

    let db = getDatabase();
    let stmt = db.prepare("DELETE FROM Game WHERE uuid = ?");
    const info = stmt.run(gameId);
   
    if (info.changes != 1) {
        console.log(`deleteGame(): info.changes = ${info.changes} (big doo-doo)`);
    }

    return true;
}

module.exports = {
    init,
    getDatabase,
    getPlayerById,
    getPlayerByUsername,
    getActivePlayers,
    getAllPlayers,
    addPlayer,
    getAllGames,
    addGame,
    getPlayerRatingsSortedByScore,
    getMatchHistory,
    getActivePlayerScores,
    getPlayerMetrics,
    getPlayerRatingEvolution,
    getGameInfo,
    updatePlayerNames,
    updatePlayerUsername,
    deleteGame
};
