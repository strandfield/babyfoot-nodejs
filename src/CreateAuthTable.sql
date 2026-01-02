
CREATE TABLE IF NOT EXISTS Auth (
    playerId      INTEGER PRIMARY KEY,
    passwordHash  TEXT NOT NULL,
    userRole      TEXT NOT NULL,
    FOREIGN KEY(playerId) REFERENCES Player(id)
);
