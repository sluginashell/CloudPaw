const express = require('express');
const cors = require('cors');
const db = require('./db');
const app = express();
app.use(cors());
app.use(express.json());

app.get('/pets', (req, res) => {
  const { species } = req.query;
  const rows = species
    ? db.prepare('SELECT * FROM pets WHERE species = ?').all(species)
    : db.prepare('SELECT * FROM pets').all();
  res.json(rows);
});

app.get('/pets/:id', (req, res) => {
  const pet = db.prepare('SELECT * FROM pets WHERE id = ?').get(req.params.id);
  if (!pet) return res.status(404).json({ error: 'Pet not found' });
  res.json(pet);
});

app.listen(3000, () => console.log('API on http://localhost:3000'));
