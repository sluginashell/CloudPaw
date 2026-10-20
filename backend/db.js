const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database(__dirname + '/cloudpaw.db');
db.exec(fs.readFileSync(__dirname + '/schema.sql', 'utf8'));
module.exports = db;
