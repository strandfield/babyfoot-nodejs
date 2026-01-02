
This is an almost complete rewrite in Javascript of [baby-foot-python](https://github.com/lkolebka/baby-foot-python), because Python... :weary:

Quoting the original author:
> This project is a sophisticated baby-foot (table soccer) Elo rating system [...]. 
> Designed specifically for four-player (2vs2) games, it refines the Elo rating system with new parameters and a modified K-value to provide accurate player ratings. 

The Medium article is a very good starting point for understanding how the system works: 
[Developing an Elo Based, Data-Driven Rating System for 2v2 Multiplayer Games](https://towardsdatascience.com/developing-an-elo-based-data-driven-ranking-system-for-2v2-multiplayer-games-7689f7d42a53#e1e8).

Shout-out to lkolebka for working on this scoring system and developing the original web-app! 🫡

A short summary of the reasons for developing the project and how it improves on the original
is presented in the [Why ?](#why) section.

Key differences for the end-user:
- games are played in 10 points (instead of 11)
- negative scores can be submitted for the loosing team
- players need to log in to submit game results

Known missing features:
- the "Rating evolution" page

## Installation

Requirements:
- Node.js

1. Clone the repository.

2. Install the dependencies

```
npm install --omit=dev
```

3. Specify some environment variables.

```
export NODE_ENV=production
export PORT=9000 # (optional) port the server will listen to
export DATA_DIR=./data # (optional) directory in which data will be saved
``` 

4. Start the server.

```
npm start
```

Server should now be listening on the port specified above.

5. Open the app in a web browser `http://localhost:9000/`.

When running for the first time, the server will create a user "John Doe" with admin rights.
The credentials for this user are:
- username: `doej`
- password: `1234`

1. Click the login button and log in by using the above username and password.

2. Go to the "My account" page (`http://localhost:9000/account`), and change the username and password.

If everything went fine, you are good to go!

Alternatively, you may use the provided `Dockerfile` to build and start a container
for the application.

```
docker build -t babyfoot:latest .
docker run -d -p 9000:9000 --name my-babyfoot babyfoot:latest
```

## <a name="why"></a>Why ?

Why this project improves on the original:
- no Python.

That's it. (no, it isn't)

But since this is a web application, knowing Javascript is largely required.
Having the server also is Javascript (and not in Python) means you have one 
less language to know in order to work on the project.

This version of the project also uses an embedded SQLite database instead
of Postgres database, which should make the setup easier.

The database schema is also simplified by removing mostly unused features 
(such as "team ratings") and computing "on the fly" player ratings instead
of storing them in the database. <br/>
Now the database mostly consists of two tables: one for the players, one 
for the games.

(to be completed)

## Developer guide

(to be improved)

Install all dependencies (including dev-dependencies) using `npm`.

```
npm install
```

The project was developed using Visual Studio Code.
A `.vscode/launch.json` file is provided so that the server can easily be started with a debugger.

Brief summary of the dependencies:
- Express.js backend with EJS templates for rendering the pages
- SQLite database provided by `better-sqlite3`
- user sessions managed with `express-session`:
  - storage: memory-store (production), file-store (development)
  - user authentication uses Passport.js with the `passport-local` strategy

The Elo 2v2 rating system is mostly implemented in `./src/main.js`.
