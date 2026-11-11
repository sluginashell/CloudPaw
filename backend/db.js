const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database(__dirname + '/cloudpaw.db');
db.exec(fs.readFileSync(__dirname + '/schema.sql', 'utf8'));

// CREATE TABLE IF NOT EXISTS never changes a table that already exists, so
// columns added to schema.sql later must also be added to older databases here.
// Each one is added only if missing, so this is safe to run on every start and
// keeps all existing rows.
function addColumnIfMissing(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing('pets', 'location', 'TEXT');

module.exports = db;
