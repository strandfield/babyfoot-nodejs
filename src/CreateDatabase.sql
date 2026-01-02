CREATE TABLE Player (
    id         INTEGER PRIMARY KEY,
    username   TEXT,
    firstName  TEXT,
    lastName   TEXT,
    active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE Game (
    id              INTEGER PRIMARY KEY,
    uuid            TEXT NOT NULL,
    submissionDate  REAL NOT NULL,
    submittedBy     INTEGER,
    gameDate        REAL NOT NULL,
    team1Player1Id  INTEGER NOT NULL,
    team1Player2Id  INTEGER NOT NULL,
    team2Player1Id  INTEGER NOT NULL,
    team2Player2Id  INTEGER NOT NULL,
    team1Score      INTEGER NOT NULL,
    team2Score      INTEGER NOT NULL,
    FOREIGN KEY(team1Player1Id) REFERENCES Player(id),
    FOREIGN KEY(team1Player2Id) REFERENCES Player(id),
    FOREIGN KEY(team2Player1Id) REFERENCES Player(id),
    FOREIGN KEY(team2Player2Id) REFERENCES Player(id),
    FOREIGN KEY(submittedBy)    REFERENCES Player(id)
);
