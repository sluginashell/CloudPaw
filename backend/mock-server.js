const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const dataPath = path.join(__dirname, '..', 'data', 'pets.json');

app.get('/pets', (req, res) => {
    try {
        const pets = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        res.json(pets);
    } catch (err) {
        res.status(500).json({ error: "Could not load pets" });
    }
});

app.post('/inquiries', (req, res) => {
    console.log("Inquiry received");
    res.status(201).json({ message: "Application received!" });
});

app.listen(3000, () => {
    console.log('Mock Server running on http://localhost:3000');
});