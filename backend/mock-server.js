const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve the static frontend files
app.use(express.static(path.join(__dirname, '..')));

// API endpoint matching Safia's new /api/pets structure
app.get('/api/pets', (req, res) => {
    try {
        const dataPath = path.join(__dirname, '..', 'data', 'pets.json');
        const pets = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        res.json(pets);
    } catch (err) {
        res.status(500).json({ error: "Could not load pets" });
    }
});

app.get('/api/pets/:id', (req, res) => {
    try {
        const dataPath = path.join(__dirname, '..', 'data', 'pets.json');
        const pets = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        const pet = pets.find(p => String(p.id) === String(req.params.id));
        if (pet) res.json(pet);
        else res.status(404).json({ error: "Pet not found" });
    } catch (err) {
        res.status(500).json({ error: "Could not load pet" });
    }
});

// Fake adoption endpoint
app.post('/api/applications', (req, res) => {
    console.log("Application received");
    res.status(201).json({ message: "Application received!" });
});

app.listen(3000, () => {
    console.log('Mock Server running on http://localhost:3000');
});
