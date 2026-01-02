
// Database utils

const fs = require('fs');

function checkTableExists(db, tableName) {
    let stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?");
    return stmt.get(tableName) != undefined;
}

function execSqlFile(db, filePath) {
    const queries = fs.readFileSync(filePath, { encoding: 'utf8' }).split(';');

    for (let q of queries) {
        q = q.trim();
        if (q.length > 0) {
            console.log(`Running next query:\n${q};`);
            db.exec(q);
        }
    }
}

module.exports = {
    checkTableExists,
    execSqlFile
};
