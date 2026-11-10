const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const auth = require('./auth');
const app = express();
app.use(cors());
app.use(express.json());

// All JSON API routes live under /api (e.g. /api/pets), so they can never
// collide with the frontend's page and asset paths.
const api = express.Router();

api.use('/auth', auth.router);

api.get('/pets', (req, res) => {
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

api.get('/pets/:id', (req, res) => {
  const pet = db.prepare('SELECT * FROM pets WHERE id = ?').get(req.params.id);
  if (!pet) return res.status(404).json({ error: 'Pet not found' });
  res.json(pet);
});

/* ---------- Adoption inquiries ---------- */
// Matches the options in adopt.html.
const HOUSING_OPTIONS = ['House', 'Apartment', 'Condo / Townhouse', 'Other'];
const YARD_OPTIONS = ['Yes', 'No'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+().\-\s]+$/;

// Checks the adoption form fields sent by adopt.html.
// Returns { values, errors }: values are trimmed and ready to save,
// errors maps each bad field name to a message (empty when everything is valid).
function validateInquiry(body) {
  const errors = {};
  const values = {};

  // Reads a text field. Missing or blank is an error only when the field is required.
  const text = (field, { required, max }) => {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) errors[field] = 'This field is required.';
      return null;
    }
    if (typeof raw !== 'string') {
      errors[field] = 'Must be text.';
      return null;
    }
    const value = raw.trim();
    if (!value) {
      if (required) errors[field] = 'This field is required.';
      return null;
    }
    if (value.length > max) {
      errors[field] = `Must be ${max} characters or fewer.`;
      return null;
    }
    return value;
  };

  values.name = text('name', { required: true, max: 100 });
  values.email = text('email', { required: true, max: 254 });
  values.phone = text('phone', { required: true, max: 30 });
  values.city = text('city', { required: true, max: 100 });
  values.housing = text('housing', { required: true, max: 50 });
  values.yard = text('yard', { required: false, max: 10 });
  values.otherPets = text('otherPets', { required: false, max: 2000 });
  values.reason = text('reason', { required: true, max: 2000 });

  if (values.email && !EMAIL_PATTERN.test(values.email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (values.phone) {
    const digits = values.phone.replace(/\D/g, '').length;
    if (!PHONE_PATTERN.test(values.phone) || digits < 7 || digits > 15) {
      errors.phone = 'Enter a valid phone number.';
    }
  }
  if (values.housing && !HOUSING_OPTIONS.includes(values.housing)) {
    errors.housing = `Must be one of: ${HOUSING_OPTIONS.join(', ')}.`;
  }
  if (values.yard && !YARD_OPTIONS.includes(values.yard)) {
    errors.yard = 'Must be Yes or No.';
  }
  if (body.agree !== 'yes') {
    errors.agree = 'You must agree before submitting.';
  }

  // The form sends petId as a string ("3"); accept a whole number in either form.
  const petId = String(body.petId ?? '').trim();
  if (!/^[1-9]\d*$/.test(petId)) {
    errors.petId = 'Choose a pet.';
  } else {
    values.petId = Number(petId);
  }

  return { values, errors };
}

api.post('/inquiries', (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { values, errors } = validateInquiry(body);

  // better-sqlite3 enforces REFERENCES pets(id), so a missing pet would make the INSERT
  // fail with a 500. Check here first so the form gets a clear 400 for petId instead.
  if (!errors.petId && !db.prepare('SELECT 1 FROM pets WHERE id = ?').get(values.petId)) {
    errors.petId = 'That pet could not be found.';
  }

  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
  }

  try {
    const result = db.prepare(`INSERT INTO inquiries
      (pet_id, name, email, phone, city, housing, yard, other_pets, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      values.petId,
      values.name,
      values.email,
      values.phone,
      values.city,
      values.housing,
      values.yard,
      values.otherPets,
      values.reason
    );
    res.status(201).json({ id: Number(result.lastInsertRowid), message: 'Application received!' });
  } catch (err) {
    console.error('Failed to save inquiry:', err);
    res.status(500).json({ error: 'Could not save your application. Please try again later.' });
  }
});

// Admin only: every saved application, newest first, with the pet's name.
// LEFT JOIN so an application is never dropped from the list, even if its pet
// row is missing (pet_name is then null).
api.get('/inquiries', auth.requireAdmin, (req, res) => {
  // Contains applicants' personal details, so never let a browser or proxy cache it.
  res.set('Cache-Control', 'no-store');
  try {
    const rows = db.prepare(`
      SELECT i.id, i.pet_id, p.name AS pet_name, i.name, i.email, i.phone, i.city,
             i.housing, i.yard, i.other_pets, i.reason, i.status, i.created_at
      FROM inquiries i
      LEFT JOIN pets p ON p.id = i.pet_id
      ORDER BY i.created_at DESC, i.id DESC`).all();
    res.json(rows);
  } catch (err) {
    console.error('Failed to load inquiries:', err);
    res.status(500).json({ error: 'Could not load applications.' });
  }
});

/* ---------- Contact messages ---------- */
// Checks the contact form fields sent by about.html: name, email, message.
// Returns { values, errors } like validateInquiry; other fields are ignored.
function validateMessage(body) {
  const errors = {};
  const values = {};

  const text = (field, max) => {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === '') {
      errors[field] = 'This field is required.';
      return null;
    }
    if (typeof raw !== 'string') {
      errors[field] = 'Must be text.';
      return null;
    }
    const value = raw.trim();
    if (!value) {
      errors[field] = 'This field is required.';
      return null;
    }
    if (value.length > max) {
      errors[field] = `Must be ${max} characters or fewer.`;
      return null;
    }
    return value;
  };

  values.name = text('name', 100);
  values.email = text('email', 254);
  values.message = text('message', 5000);

  if (values.email && !EMAIL_PATTERN.test(values.email)) {
    errors.email = 'Enter a valid email address.';
  }

  return { values, errors };
}

// Public: anyone can send a message from the About page.
api.post('/messages', (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { values, errors } = validateMessage(body);

  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
  }

  try {
    const result = db.prepare('INSERT INTO messages (name, email, message) VALUES (?, ?, ?)')
      .run(values.name, values.email, values.message);
    res.status(201).json({ id: Number(result.lastInsertRowid), message: 'Message sent!' });
  } catch (err) {
    console.error('Failed to save message:', err);
    res.status(500).json({ error: 'Could not send your message. Please try again later.' });
  }
});

// Unknown /api paths get a JSON 404 instead of falling through to the static files.
api.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/api', api);

/* ---------- Frontend ---------- */
// The site's files sit in the repo root next to backend/, which holds the
// database (users, password hashes, sessions). So never serve the root folder
// as a whole: expose only the frontend, the same allowlist the CI deploy uses
// (*.html, css/, js/, images/, data/).
const SITE_ROOT = path.join(__dirname, '..');
for (const dir of ['css', 'js', 'images', 'data']) {
  app.use(`/${dir}`, express.static(path.join(SITE_ROOT, dir)));
}
// Top-level pages only: "/" -> index.html, "/pets.html", "/about.html", ...
app.get(/^\/(?:[\w-]+\.html)?$/, (req, res, next) => {
  const file = req.path === '/' ? 'index.html' : req.path.slice(1);
  res.sendFile(file, { root: SITE_ROOT }, (err) => err && next());
});

app.listen(3000, () => console.log('CloudPaw on http://localhost:3000 (API at /api)'));
