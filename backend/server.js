const express = require('express');
const cors = require('cors');
const db = require('./db');
const app = express();
app.use(cors());
app.use(express.json());

app.get('/pets', (req, res) => {
  const { species, q } = req.query;
  const conditions = [];
  const params = [];

  if (species) {
    conditions.push('species = ?');
    params.push(species);
  }

  // Free-text search: case-insensitive partial match on name, species, or breed.
  // % and _ are wildcards in LIKE, so escape them to search for them literally.
  const term = typeof q === 'string' ? q.trim() : '';
  if (term) {
    const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(
      "(name LIKE ? ESCAPE '\\' OR species LIKE ? ESCAPE '\\' OR breed LIKE ? ESCAPE '\\')"
    );
    params.push(pattern, pattern, pattern);
  }

  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM pets${where}`).all(...params);
  res.json(rows);
});

app.get('/pets/:id', (req, res) => {
  const pet = db.prepare('SELECT * FROM pets WHERE id = ?').get(req.params.id);
  if (!pet) return res.status(404).json({ error: 'Pet not found' });
  res.json(pet);
});

app.listen(3000, () => console.log('API on http://localhost:3000'));
