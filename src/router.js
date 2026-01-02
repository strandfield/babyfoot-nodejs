
const elo2v2 = require("./main");
const auth = require("./auth");
const { transliterate } = require("./common");

var express = require('express');

var router = express.Router();

const isDevelopment = process.env.NODE_ENV != 'production';

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

function createRenderVars(req, values) {
  let result = {
    isDevelopment: isDevelopment,
    authenticated: req.isAuthenticated(),
    user: req.user
  };

  if (req.user) {
    Object.assign(result.user, elo2v2.getPlayerById(req.user.id));
  }

  if (values) {
    Object.assign(result, values);
  }

  return result;
}

router.get('/', (req, res) => {
  const vars = createRenderVars(req);
  res.render("index", vars);
});

router.get('/create-player', ensureAuthenticated, (req, res) => {
  if (!auth.hasPermission(req.user, auth.Permissions.PLAYER_ADD)) {
    return res.redirect("/");
  }

  const vars = createRenderVars(req);
  res.render("create-player", vars);
});

router.post('/create-player', ensureAuthenticated, (req, res) => {

  if (!auth.hasPermission(req.user, auth.Permissions.PLAYER_ADD)) {
    return res.redirect("/");
  }

  let firstname = req.body.first_name?.trim();
  let lastname = req.body.last_name?.trim();
  let username = req.body.user_name?.trim();

  if (!firstname || !lastname) {
    res.redirect('/create-player');
    return;
  }

  if (!username) {
    username = transliterate(firstname).toLowerCase() + transliterate(lastname).toLowerCase()[0];
  }
  
  let player = elo2v2.addPlayer(username, firstname, lastname);

  const ctx = createRenderVars(req, {
    addedUser: player,
  });
  res.render("create-player", ctx);
});

// #upload
router.get('/upload-game', ensureAuthenticated, (req, res) => {
  if (!auth.hasPermission(req.user, auth.Permissions.GAME_UPLOAD)) {
    return res.redirect("/");
  }

  const vars = createRenderVars(req, {
    error: null,
    players: elo2v2.getActivePlayers()
  });
  res.render("upload-game", vars);
});


router.post('/upload-game', ensureAuthenticated, (req, res) => {
  if (!auth.hasPermission(req.user, auth.Permissions.GAME_UPLOAD)) {
    return res.redirect("/");
  }

  console.log(req.body);

  let exit_with_error = function (errorMessage) {
    const vars = createRenderVars(req, {
      error: errorMessage,
      players: elo2v2.getActivePlayers()
    });
    res.render("upload-game", vars);
  };

  for (const i of [1,2,3,4]) {
    if (!req.body[`player${i}_name`]) {
      return exit_with_error("Missing some player names");
    }
  }

  const p1 = elo2v2.getPlayerByUsername(req.body.player1_name);
  const p2 = elo2v2.getPlayerByUsername(req.body.player2_name);
  const p3 = elo2v2.getPlayerByUsername(req.body.player3_name);
  const p4 = elo2v2.getPlayerByUsername(req.body.player4_name);

  // check that all players are found
  {
    const players = [p1,p2,p3,p4];
    for (const i in players) {
      if (!players[i]) {
        const username = req.body[`player${i+1}_name`];
        return exit_with_error(`Unknown player: ${username}.`);
      }
    }
  }

  const team1_score = Number.parseInt(req.body.team1_score);
  const team2_score = Number.parseInt(req.body.team2_score);

  if (isNaN(team1_score) || isNaN(team2_score)) {
    return exit_with_error(`Missing some team score.`);
  }

  if (team1_score > 10 || team2_score > 10 || team1_score < -10 || team2_score < -10) {
    return exit_with_error(`Invalid range for some score.`);
  } 

  const utctime = Number.parseInt(req.body.utctime);
  
  // check utctime
  {
    if (isNaN(utctime)) {
      return exit_with_error("Missing game date and/or time.");
    }

    const min = (new Date("2025-01-01")).getTime();
    const max = Date.now();

    if (utctime < min || utctime > max) {
      return exit_with_error("Invalid game date.");
    }
  }

  const date = new Date(utctime);

  let uploader = elo2v2.getPlayerById(req.user.id);

  let game = elo2v2.addGame(p1, p2, p3, p4, team1_score, team2_score, date, uploader);

  if (game) {
    res.redirect(`/view-match?id=${game.uuid}`);
    return;
  }
});

router.get('/rating', (req, res) => {
  const vars = createRenderVars(req, {
    playerRatings: elo2v2.getPlayerRatingsSortedByScore()
  });
  res.render("rating", vars);
});

router.get('/match-list', (req, res) => {
  const vars = createRenderVars(req, {
    matchRatings: elo2v2.getMatchHistory()
  });
  res.render("match-list", vars);
});

router.get('/calculate-odds', (req, res) => {
  const vars = createRenderVars(req, {
    userdata: elo2v2.getActivePlayerScores()
  });
  res.render("calculate-odds", vars);
});

router.get('/api/player-metrics', (req, res) => {
  const username = req.query.username?.trim();
  if (!username) {
    res.json({status: "bad", message: "missing username"});
    return;
  }

  const player = elo2v2.getPlayerByUsername(username);
  if (!player) {
    res.json({status: "bad", message: "no such player"});
    return;
  }

  res.json(elo2v2.getPlayerMetrics(player));
});

router.get('/player-metrics', (req, res) => {
  const vars = createRenderVars(req, {
    players: elo2v2.getActivePlayers()
  });
  res.render("player-metrics", vars);
});

router.get('/view-match', (req, res) => {
  if (!req.query.number && !req.query.id) {
    return res.redirect("/match-list");
  }

  let game = null;
  if (req.query.id) {
    game = elo2v2.getGameInfo(req.query.id);
  } else if (req.query.number) {
    const num = Number.parseInt(req.query.number);
    if (isNaN(num) || num <= 0) {
      return res.redirect("/match-list");;
    }
    game = elo2v2.getGameInfo(num);
  }

  if (!game) {
    // TODO: call next() to eventually reach the "not found" page ?
    return res.redirect("/match-list");
  }

  const quotes = [
    "We're going to win so much, you may even get tired of winning.",
    "Nobody wins like us. Believe me.",
    "I know more about this sport than anybody.",
    "We're winning bigly.",
    "Many people are saying this was the greatest victory ever.",
    "That was a total disaster. A total disaster.",
    "We have the best players. The absolute best.",
    "I've never seen anything like it.",
    "Frankly, we did win.",
    "The other team? Not so good. Not so good.",
    "This team has incredible energy. Tremendous energy.",
    "We're very smart. The smartest.",
    "It's going to be amazing. Absolutely amazing.",
    "A lot of people didn't think it could be done.",
    "We're setting records that nobody's ever seen before.",
    "Nobody thought we could pull it off, and then boom — we did.",
    "The talent on this team is unbelievable. Unbelievable.",
    "We came in, we competed, and we dominated.",
    "This was a landslide victory. A landslide.",
    "The strategy was perfect. Perfect in every way.",
    "They had no answer for us. None.",
    "We showed great strength, great stamina.",
    "This is what winning looks like.",
    "We played at a very high level. A very, very high level.",
    "The scoreboard doesn't lie.",
  ];

  const vars = createRenderVars(req, {
    game: game,
    quote: quotes[Math.floor(Math.random()*quotes.length)],
    canDeleteMatch: auth.hasPermission(req.user, auth.Permissions.GAME_DELETE)
  });
  res.render("view-match", vars);
});

router.delete('/match/:gameId', (req, res) => {
  if (!auth.hasPermission(req.user, auth.Permissions.GAME_DELETE)) {
    return res.status(403).json({status: "unauthorized"});
  }

  let game = elo2v2.getGameInfo(req.params.gameId);

  if (!game) {
    return res.status(404).json({status: "not found"});
  }

  elo2v2.deleteGame(game.id);

  res.json({status: "deleted"});
});

router.get('/players.csv', (req, res) => {
  if (!auth.hasPermission(req.user, auth.Permissions.GENERATE_PLAYER_CSV)) {
    return res.redirect("/");
  }
  
  const players = elo2v2.getAllPlayers();

  let text = "id,username,firstName,lastName,active\n";

  for (const p of players) {
    text += [p.id, p.username, p.firstName, p.lastName, p.active ? 1 : 0].join(",") + "\n";
  }

  res.type('text/csv');
  res.send(text);
});

router.get('/games.csv', (req, res) => {
  if (!auth.hasPermission(req.user, auth.Permissions.GENERATE_PLAYER_CSV)) {
    return res.redirect("/");
  }
  
  const games = elo2v2.getAllGames();

  let text = "uuid,submissionDate,submittedBy,gameDate,player1,player2,player3,player4,scoreTeam1,scoreTeam2\n";

  for (const g of games) {
    text += [
      g.uuid, g.submissionDate.getTime(), g.submittedBy?.username, g.gameDate.getTime(), 
      g.player1.username, g.player2.username, g.player3.username, g.player4.username,
      g.team1Score, g.team2Score
    ].join(",") + "\n";
  }

  res.type('text/csv');
  res.send(text);
});

module.exports = router;
