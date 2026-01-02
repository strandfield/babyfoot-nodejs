
const mainmodule = require("./src/main");

const { resolveDataDir } = require("./src/common");

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const createError = require('http-errors');

const crypto = require('crypto');
const path = require('path');

console.log(`Data directory is ${resolveDataDir()}`);

const isDevelopment = process.env.NODE_ENV != 'production';

if (isDevelopment) {
  console.log("Warning: you are running in development mode.");
}

mainmodule.init();

const app = express();
app.disable('x-powered-by'); // do not advertise that we are using express.js
app.set('trust proxy', true); // permet de récupérer l'ip d'une requête via req.ip même si l'on passe par un reverse-proxy

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json()); // Used to parse JSON bodies
app.use(express.urlencoded()); // Parse URL-encoded bodies using query-string library

const sessionSecret = isDevelopment ? "whoa-such-a-secret-12345!" : crypto.randomBytes(32).toString('base64');

const MemoryStore = require('memorystore')(session);

function createSessionStore() {
  if (isDevelopment) {
    const FileStore = require('session-file-store')(session);
    return new FileStore({
      path: "./data/sessions"
    });
  }

  return new MemoryStore({
    checkPeriod: 86400000 // prune expired entries every 24h
  });
}

app.use(session({
  name: 'relwithdebinfo',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true, // client-side JS won't have access to the cookie
    maxAge: 7 * 86400 * 1000, // 7 days
  },
  store: createSessionStore()
}));

app.use(passport.initialize());
app.use(passport.session());

app.use(require("./src/router"));

const auth = require("./src/auth");
auth.setup();
app.use(auth.router);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
