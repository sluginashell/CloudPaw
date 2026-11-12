/* =============================================================================
   CloudPaw — mock API server (no database)

   Same URLs and response shapes as server.js, but everything is kept in memory
   and reset when the server restarts. Use it to work on the frontend without
   SQLite. Pets start from data/pets.json.

   Run (from backend/):  node mock-server.js   ->  http://localhost:3000

   Mock admin account:   admin@mock.test / mock-password
   (Sign-up works too, but always creates an "adopter", like the real API.)

   Matches server.js on purpose:
     - only the frontend files are served (root *.html, css/, js/, images/, data/)
     - admin routes return 401 without "Authorization: Bearer <token>" and 403
       for a non-admin token
     - errors are JSON: { error } or { error, fields: { field: message } }
   ============================================================================= */

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const SITE_ROOT = path.join(__dirname, '..');

/* ---------- In-memory data ---------- */

// Same columns as a row from the real pets table.
const rawPets = require('../data/pets.json');
const pets = (Array.isArray(rawPets) ? rawPets : rawPets.pets).map((p) => ({
  id: p.id,
  name: p.name,
  species: p.species ?? p.type ?? null,
  breed: p.breed ?? null,
  age: typeof p.age === 'number' ? p.age : null,
  description: p.description ?? p.bio ?? null,
  photo_url: p.photo ?? p.image ?? p.img ?? null,
  status: 'available',
  location: p.location ?? null,
}));
let nextPetId = Math.max(0, ...pets.map((p) => p.id)) + 1;

const users = [{ id: 1, name: 'Mock Admin', email: 'admin@mock.test', password: 'mock-password', role: 'admin' }];
const sessions = new Map(); // token -> user id
const inquiries = [];
const messages = [];

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19); // like SQLite CURRENT_TIMESTAMP
const publicUser = ({ id, name, email, role }) => ({ id, name, email, role });
const bodyOf = (req) =>
  req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const trimmed = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Light validation: required fields only, plus a few checks the frontend relies on.
// Error format matches server.js.
function missingFields(body, fields) {
  const errors = {};
  for (const f of fields) if (isBlank(body[f])) errors[f] = 'This field is required.';
  return errors;
}
const badRequest = (res, fields) =>
  res.status(400).json({ error: 'Please fix the highlighted fields.', fields });

/* ---------- Auth ---------- */

function newSession(userId) {
  const token = `mock-${crypto.randomBytes(16).toString('hex')}`;
  sessions.set(token, userId);
  return token;
}

function userFromRequest(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('Authorization') || '');
  const userId = match && sessions.get(match[1]);
  return userId ? users.find((u) => u.id === userId) : null;
}

function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Please sign in.' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
    next();
  });
}

const api = express.Router();

api.post('/auth/signup', (req, res) => {
  const body = bodyOf(req);
  const errors = missingFields(body, ['name', 'email', 'password']);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!errors.email && !EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address.';
  if (!errors.password && (typeof body.password !== 'string' || body.password.length < 8)) {
    errors.password = 'Must be at least 8 characters.';
  }
  if (Object.keys(errors).length) return badRequest(res, errors);
  if (users.some((u) => u.email === email)) {
    return res.status(409).json({
      error: 'An account with that email already exists.',
      fields: { email: 'An account with that email already exists.' },
    });
  }
  const user = { id: users.length + 1, name: body.name.trim(), email, password: body.password, role: 'adopter' };
  users.push(user);
  res.status(201).json({ user: publicUser(user), token: newSession(user.id) });
});

api.post('/auth/login', (req, res) => {
  const body = bodyOf(req);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || typeof body.password !== 'string' || body.password === '') {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }
  const user = users.find((u) => u.email === email && u.password === body.password);
  if (!user) return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.json({ user: publicUser(user), token: newSession(user.id) });
});

api.post('/auth/logout', (req, res) => {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('Authorization') || '');
  if (match) sessions.delete(match[1]);
  res.status(204).end();
});

api.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/* ---------- Pets ---------- */

api.get('/pets', (req, res) => {
  const { species, q } = req.query;
  const term = typeof q === 'string' ? q.trim().toLowerCase() : '';
  res.json(pets.filter((p) =>
    (!species || p.species === species) &&
    (!term || [p.name, p.species, p.breed].some((f) => String(f || '').toLowerCase().includes(term)))
  ));
});

api.get('/pets/:id', (req, res) => {
  const pet = pets.find((p) => String(p.id) === req.params.id);
  if (!pet) return res.status(404).json({ error: 'Pet not found' });
  res.json(pet);
});

api.post('/pets', requireAdmin, (req, res) => {
  const body = bodyOf(req);
  const errors = missingFields(body, ['name', 'species']);
  if (!errors.species && !['Dog', 'Cat', 'Other'].includes(String(body.species).trim())) {
    errors.species = 'Must be one of: Dog, Cat, Other.';
  }
  let age = null;
  if (!isBlank(body.age)) {
    if (!/^\d+$/.test(String(body.age).trim()) || Number(body.age) > 100) {
      errors.age = 'Must be a whole number, 0 or higher.';
    } else {
      age = Number(body.age);
    }
  }
  if (Object.keys(errors).length) return badRequest(res, errors);

  const pet = {
    id: nextPetId++,
    name: body.name.trim(),
    species: body.species.trim(),
    breed: trimmed(body.breed),
    age,
    description: trimmed(body.description),
    photo_url: null, // the real API ignores photo_url too
    status: 'available',
    location: trimmed(body.location),
  };
  pets.push(pet);
  console.log('[mock] Pet added:', pet.name);
  res.status(201).json(pet);
});

/* ---------- Adoption inquiries ---------- */

api.post('/inquiries', (req, res) => {
  const body = bodyOf(req);
  const errors = missingFields(body, ['name', 'email', 'phone', 'city', 'housing', 'reason', 'petId']);
  if (body.agree !== 'yes') errors.agree = 'You must agree before submitting.';
  if (!errors.email && !EMAIL_PATTERN.test(String(body.email).trim())) errors.email = 'Enter a valid email address.';
  if (!errors.petId && !pets.some((p) => String(p.id) === String(body.petId).trim())) {
    errors.petId = 'That pet could not be found.';
  }
  if (Object.keys(errors).length) return badRequest(res, errors);

  const inquiry = {
    id: inquiries.length + 1,
    pet_id: Number(body.petId),
    name: body.name.trim(),
    email: body.email.trim(),
    phone: body.phone.trim(),
    city: body.city.trim(),
    housing: body.housing.trim(),
    yard: trimmed(body.yard),
    other_pets: trimmed(body.otherPets),
    reason: body.reason.trim(),
    status: 'pending',
    created_at: now(),
  };
  inquiries.push(inquiry);
  console.log('[mock] Application received for pet', inquiry.pet_id);
  res.status(201).json({ id: inquiry.id, message: 'Application received!' });
});

// Admin only, newest first, with the pet's name — same shape as server.js.
api.get('/inquiries', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json([...inquiries].reverse().map((i) => ({
    id: i.id,
    pet_id: i.pet_id,
    pet_name: pets.find((p) => p.id === i.pet_id)?.name ?? null,
    name: i.name, email: i.email, phone: i.phone, city: i.city, housing: i.housing,
    yard: i.yard, other_pets: i.other_pets, reason: i.reason, status: i.status, created_at: i.created_at,
  })));
});

/* ---------- Contact messages ---------- */

api.post('/messages', (req, res) => {
  const body = bodyOf(req);
  const errors = missingFields(body, ['name', 'email', 'message']);
  if (!errors.email && !EMAIL_PATTERN.test(String(body.email).trim())) errors.email = 'Enter a valid email address.';
  if (Object.keys(errors).length) return badRequest(res, errors);

  const message = { id: messages.length + 1, name: body.name.trim(), email: body.email.trim(), message: body.message.trim(), created_at: now() };
  messages.push(message);
  console.log('[mock] Message received from', message.email);
  res.status(201).json({ id: message.id, message: 'Message sent!' });
});

// Unknown /api paths get a JSON 404 instead of falling through to the static files.
api.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/api', api);

/* ---------- Frontend ---------- */
// Same allowlist as server.js: never serve the repo root as a whole, because it
// also holds backend/ (database, code, node_modules).
for (const dir of ['css', 'js', 'images', 'data']) {
  app.use(`/${dir}`, express.static(path.join(SITE_ROOT, dir)));
}
// Top-level pages only: "/" -> index.html, "/pets.html", "/about.html", ...
app.get(/^\/(?:[\w-]+\.html)?$/, (req, res, next) => {
  const file = req.path === '/' ? 'index.html' : req.path.slice(1);
  res.sendFile(file, { root: SITE_ROOT }, (err) => err && next());
});

// 127.0.0.1 only: reachable from this computer, not from others on the network.
app.listen(3000, '127.0.0.1', () => {
  console.log('Mock server on http://localhost:3000 (API at /api, in-memory data)');
  console.log('Mock admin: admin@mock.test / mock-password');
});
