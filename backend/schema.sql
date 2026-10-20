CREATE TABLE IF NOT EXISTS pets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  species TEXT,
  breed TEXT,
  age INTEGER,
  description TEXT,
  photo_url TEXT,
  status TEXT DEFAULT 'available'
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'adopter'
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id INTEGER NOT NULL REFERENCES pets(id),
  user_id INTEGER REFERENCES users(id),
  answers TEXT,
  status TEXT DEFAULT 'pending',
  submitted_at TEXT DEFAULT CURRENT_TIMESTAMP
);
