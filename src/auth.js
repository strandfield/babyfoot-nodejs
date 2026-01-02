
const { execSqlFile, checkTableExists } = require("./db-utils");
const elo2v2 = require("./main");
const { transliterate } = require("./common");

const bcrypt = require('bcrypt');
const express = require('express');
const jwt = require('jsonwebtoken');
const passport = require('passport');

const crypto = require('crypto');
const path = require('path');

const SALT_ROUNDS = 10;

const JWT_HEADER = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.";
const JWT_SECRET = crypto.randomBytes(32).toString('base64');

const Roles = Object.freeze({
  OWNER: 'owner',
  MAINTAINER: 'maintainer',
  DEVELOPER: 'developer',
  REPORTER: 'reporter'
});

const DefaultRole = Roles.REPORTER;

const Permissions = Object.freeze({
  GENERATE_RECOVERY_LINK: "auth.generateRecoveryLink", // generate a recovery link for any user
  CHANGE_USER_ROLE: "user.changeRole", // (not implemented) the user can change the role of other users
  PLAYER_ADD: "player.add", // add new player
  PLAYER_DELETE: "player.delete", // (not implemented) delete a player, the associated user (if any), and all the games played by the player
  PLAYER_RENAME: "player.rename", // (not implemented) rename any player that is not a user
  GAME_UPLOAD: "game.upload", // upload a game
  GAME_DELETE: "game.delete", // delete a game
  GENERATE_PLAYER_CSV: "csv.players", // generate a csv file listing all players
});

// A few notes about the permissions.
// If a user is allowed to upload a match, he/she should be allowed to add players; otherwise games
// involving new players may not be uploaded.
// Ideally, if a user is allowed to upload a match, he/she should be allowed to delete *that* match.
// On the other hand, a "maintainer" should be allowed to delete any match.
// A "maintainer" should also be able to rename a player, to fix typos; but only if that player
// is not already user.
const PermissionsByRole = {
  'owner': ["*"],
  'maintainer': ["player.add", "game.upload", "game.delete", "player.rename", "csv.players"],
  'developer': ["player.add", "game.upload", "csv.players"],
  'reporter': ["player.add", "game.upload"]
};

for (const key in PermissionsByRole) {
  console.assert(checkRoleExists(key), `Permissions are defined for role '${key}', but no such role exists.`);
}

for (const key in Roles) {
  const roleName = Roles[key];
  console.assert(Array.isArray(PermissionsByRole[roleName]), `No permissions are defined for role '${roleName}'.`);
}

function getDbUserById(playerId) {
  const db = elo2v2.getDatabase();
  let query = db.prepare(`
    SELECT playerId as id, passwordHash, userRole
    FROM Auth
    WHERE playerId = ?
  `);
  return query.get(playerId);
}

function getDbUserByUsername(username) {
  const db = elo2v2.getDatabase();
  let query = db.prepare(`
    SELECT id, passwordHash, userRole
    FROM Auth
    LEFT JOIN Player ON Auth.playerId = Player.id
    WHERE username = ?
  `);
  return query.get(username);
}

function createUserFromDbUser(dbUser) {
  let u = {
    id: dbUser.id,
    role: dbUser.userRole
  };

  if (!dbUser.passwordHash) {
    u.passwordless = true;
  }

  return u;
}

function checkRoleExists(roleName) {
  for (const key in Roles) {
    if (Roles[key] == roleName) {
      return true;
    }
  }
  return false;
}

console.assert(checkRoleExists('owner'));
console.assert(!checkRoleExists('manager'));

function hasPermission(user, permission) {
  if (!user || !user.role) {
    return false;
  }

  const permissions = PermissionsByRole[user.role];

  if (permissions.includes("*")) {
    return true;
  }

  if (permissions.includes(permission)) {
    return true;
  }

  if (permissions.includes(permission.split('.')[0] + '.*')) {
    return true;
  }

  return false;
}

function getVerifiedDbUser(username, password) {
  let user = getDbUserByUsername(username);
  if (!user || !user.passwordHash) {
    return null;
  }

  const nword = password.trim().normalize('NFC');

  if (!bcrypt.compareSync(nword, user.passwordHash)) {
    return null;
  }

  return user;
}

function verifyUser(username, password, cb) {
  let user = getDbUserByUsername(username);
  if (!user || !user.passwordHash) {
    return cb(null, false, { message: 'Incorrect username or password.' });
  }

  const nword = password.trim().normalize('NFC');

  if (!bcrypt.compareSync(nword, user.passwordHash)) {
    return cb(null, false, { message: 'Incorrect username or password.' });
  }

  return cb(null, createUserFromDbUser(user));
}

function createUser(id, password = null, role = DefaultRole) {
  let hash = "";

  if (typeof password === 'string' && password.length) {
    const nword = password.trim().normalize('NFC');
    hash = bcrypt.hashSync(nword, SALT_ROUNDS);
  }

  let database = elo2v2.getDatabase();
  let stmt = database.prepare(`
    INSERT OR REPLACE INTO Auth (playerId, passwordHash, userRole) VALUES(?,?,?)
  `);
  stmt.run(id, hash, role); 

  return {
    id: id,
    passwordHash: hash,
    userRole: role
  };
}

function updateUserPassword(id, newPassword) {
  if (typeof newPassword !== 'string') {
    throw new TypeError('Password must be a string');
  }

  const nword = newPassword.trim().normalize('NFC');
  const hash = bcrypt.hashSync(nword, SALT_ROUNDS);

  let database = elo2v2.getDatabase();
  let stmt = database.prepare(`
    UPDATE Auth SET passwordHash = ? WHERE playerId = ?
  `);
  stmt.run(hash, id); 
}

function setup() {

  const db = elo2v2.getDatabase();

  if (!checkTableExists(db, "Auth"))
  {
    console.log("Creating auth table...");
    const srcpath = path.join(__dirname, 'CreateAuthTable.sql');
    execSqlFile(db, srcpath);
    console.log("Done!");
  }

  // create admin user if none exists
  {
    let query = db.prepare(`SELECT playerId FROM Auth`);
    let user = query.get();
    if (!user) {
      console.log("No users in database, creating admin user...");
      let player = null;
      {
        let active_players = elo2v2.getActivePlayers();
        if (!active_players.length) {
          console.log("No players in database, creating John Doe.");
          player = elo2v2.addPlayer("doej", "John", "Doe");
        } else {
          player = active_players[0];
        }
      }

      console.assert(player);
      console.log(`${player.firstName} ${player.lastName} will be granted admin rights.`);

      createUser(player.id, "1234", Roles.OWNER);
      console.log("Done!");
    }
  }

  // setup passport lib
  {
    const LocalStrategy = require('passport-local');
    const opts = {
      usernameField: 'urname',
      passwordField: 'mdp'
    };
    passport.use(new LocalStrategy(opts, verifyUser));

    passport.serializeUser((user, cb) => {
      process.nextTick(() => {
        cb(null, user);
      });
    });

    passport.deserializeUser((user, cb) => {
      process.nextTick(() => {
        return cb(null, user);
      });
    });
  }

}

const router = express.Router();

router.get("/login", (req, res) => {
  res.render("login");
});

router.post("/login", passport.authenticate('local', {
  successRedirect: "/",
  failureRedirect: "/login",
  failureMessage: true
}));

router.post("/logout", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }
  req.logout(function (err) {
    if (err) { return next(err); }
    res.redirect('/');
  })
});

router.get("/account", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }
  const vars = {
    user: req.user,
    passwordlessUser: req.user.passwordless ?? false,
    player: elo2v2.getPlayerById(req.user.id),
    isAdmin: req.user.role == Roles.OWNER
  }
  res.render("account", vars);
});

router.post('/account/update', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }

  const player = elo2v2.getPlayerById(req.user.id);

  if (!req.user.passwordless) {
    // verify the password!
    let dbu = getVerifiedDbUser(player.username, req.body.password);

    if (!dbu) {
      console.log("bad password");
      return res.redirect("/account");
    }
  }

  let newpassword = req.body.newpassword?.trim();

  if (req.user.passwordless) {
    // check that a new password was provided for user without a password
    if (!newpassword || !newpassword.length) {
      console.log("missing new password");
      return res.redirect("/account");
    }
  }

  if (newpassword && newpassword.length) {
    // update the password for current user
    updateUserPassword(req.user.id, newpassword);

    if (req.user.passwordless) {
      delete req.user.passwordless;
    }
  }

  let firstname = req.body.first_name?.trim();
  let lastname = req.body.last_name?.trim();
  let username = transliterate(req.body.username?.trim() ?? "");

  if ((firstname && firstname.length) || (lastname && lastname.length)) {
    if (firstname != player.firstName || lastname != player.lastName) {
      elo2v2.updatePlayerNames(player, firstname, lastname);
    }
  }

  if (username && username.length && username != player.username) {
    elo2v2.updatePlayerUsername(player, username);
  }

  res.redirect("/account");
});

router.get('/generate-recovery-link', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }

  if (!hasPermission(req.user, Permissions.GENERATE_RECOVERY_LINK)) {
    return res.redirect("/");
  }

  const vars = {
      players: elo2v2.getActivePlayers()
  };
  res.render("generate-recovery-link", vars);
});

router.post('/generate-recovery-link', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }

  if (!hasPermission(req.user, Permissions.GENERATE_RECOVERY_LINK)) {
    return res.redirect("/");
  }

  let username = req.body.player_name;
  let player = elo2v2.getPlayerByUsername(username);

  if (!player) {
    return res.redirect("/generate-recovery-link");
  }

  if (!player.active) {
    // TODO: make the player active ?
  }

  let user = getDbUserById(player.id);

  if (!user) {
    user = createUser(player.id);
  } else {
    // reset user password
    let db = elo2v2.getDatabase();
    // careful: the SQL standard requires single-quotes around string literals.
    // see also: https://sqlite.org/quirks.html#double_quoted_string_literals_are_accepted
    db.exec(`UPDATE Auth SET passwordHash = '' WHERE playerId = ${player.id}`);
  }

  let token = jwt.sign({sub: player.id}, JWT_SECRET, {
    expiresIn: "1d",
    noTimestamp: true,
  });

  if (token.startsWith(JWT_HEADER)) {
    token = token.substring(JWT_HEADER.length);
  }

  const vars = {
      players: elo2v2.getActivePlayers(),
      recoveryLink: {
        url: "/recovery?tok=" + token,
        player: player
      }
  };
  res.render("generate-recovery-link", vars);
});

router.get('/recovery', (req, res) => {
  
  // note: we could use passport-hash for this route, but it seems doing
  // things manually here is not overkill and will make it easier to understand.
  // link: https://www.passportjs.org/packages/passport-hash/

  let token = req.query.tok.trim();
  if (!token) {
    return res.redirect("/login");
  }

  if (token.split('.').length != 3) {
    token = JWT_HEADER + token;
  }

  let user = null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    user = getDbUserById(payload.sub);
  } catch(err) {
    console.log(err);
    return res.redirect("/login");
  }

  if (!user) {
    return res.redirect("/login");
  }
 
  user = createUserFromDbUser(user);
  req.logIn(user, function(err) {
    if (err) res.redirect("/login");
    else res.redirect("/account");
  });
});

module.exports = {
  setup,
  router,
  hasPermission,
  Roles,
  Permissions,
};
