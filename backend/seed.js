const db = require('./db');
const raw = require('../data/pets.json');
const pets = Array.isArray(raw) ? raw : raw.pets;
const insert = db.prepare(`INSERT INTO pets
  (name, species, breed, age, description, photo_url)
  VALUES (?, ?, ?, ?, ?, ?)`);
for (const p of pets) {
  insert.run(
    p.name,
    p.species ?? p.type ?? null,
    p.breed ?? null,
    typeof p.age === 'number' ? p.age : null,
    p.description ?? p.bio ?? null,
    p.photo ?? p.image ?? p.img ?? null
  );
}
console.log('Seeded', pets.length, 'pets');
