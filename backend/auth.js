/* =============================================================================
   CloudPaw — authentication (sign-up, sign-in, sessions)

   Everything auth-related lives in this file so it can be swapped for a cloud
   auth service later without touching the rest of the API.

   Passwords: hashed with Node's built-in scrypt and a random salt per user.
              Plain-text passwords are never stored, logged, or returned.
   Sessions:  a random token is given to the browser; only its SHA-256 hash is
              stored in the sessions table. The browser sends the token back as
              "Authorization: Bearer <token>".

   Exports:
     router        mount with app.use('/auth', router)
                   POST /signup, POST /login, POST /logout, GET /me
     requireAuth   middleware: 401 unless signed in; sets req.user
     requireAdmin  middleware: 401 unless signed in, 403 unless role is admin
   ============================================================================= */

const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const db = require('./db');

const scrypt = promisify(crypto.scrypt);

const SESSION_DAYS = 7;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const NAME_MAX = 100;
const EMAIL_MAX = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// scrypt settings. They are saved inside each hash, so they can be raised later
// without breaking existing passwords.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* ---------- Passwords ---------- */

// Returns "scrypt$N$r$p$<salt>$<hash>" (salt and hash in base64).
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = await scrypt(password, salt, keylen, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

// True if the password matches the stored hash. Never throws on a bad hash.
async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  try {
    const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Used when an email isn't registered, so a failed login takes about as long
// whether or not the account exists.
let dummyHashPromise;
const dummyHash = () => (dummyHashPromise ??= hashPassword(crypto.randomBytes(16).toString('hex')));

/* ---------- Sessions ---------- */

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Creates a session and returns the raw token (the only time it exists unhashed).
function createSession(userId) {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES (?, ?, datetime('now', ?))`
  ).run(userId, hashToken(token), `+${SESSION_DAYS} days`);
  return token;
}

// Reads the Bearer token from the request, or null.
function getToken(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('Authorization') || '');
  return match ? match[1] : null;
}

// Returns the signed-in user for a token, or null if missing, unknown, or expired.
function getSessionUser(token) {
  if (!token) return null;
  return db.prepare(
    `SELECT u.id, u.name, u.email, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now')`
  ).get(hashToken(token)) || null;
}

// The only user fields ever sent to the browser (never password_hash).
const publicUser = ({ id, name, email, role }) => ({ id, name, email, role });

/* ---------- Middleware ---------- */

function requireAuth(req, res, next) {
  const user = getSessionUser(getToken(req));
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

/* ---------- Input checks ---------- */

const bodyOf = (req) =>
  req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};

const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

function validateSignup(body) {
  const errors = {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = normalizeEmail(body.email);
  const { password } = body;

  if (!name) errors.name = 'This field is required.';
  else if (name.length > NAME_MAX) errors.name = `Must be ${NAME_MAX} characters or fewer.`;

  if (!email) errors.email = 'This field is required.';
  else if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address.';

  // Passwords are not trimmed: spaces are allowed and count.
  if (typeof password !== 'string' || password === '') errors.password = 'This field is required.';
  else if (password.length < PASSWORD_MIN) errors.password = `Must be at least ${PASSWORD_MIN} characters.`;
  else if (password.length > PASSWORD_MAX) errors.password = `Must be ${PASSWORD_MAX} characters or fewer.`;

  return { values: { name, email, password }, errors };
}

/* ---------- Routes ---------- */

const router = express.Router();

// POST /auth/signup  { name, email, password } -> 201 { user, token }
router.post('/signup', async (req, res) => {
  const { values, errors } = validateSignup(bodyOf(req));
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
  }

  const taken = () =>
    res.status(409).json({
      error: 'An account with that email already exists.',
      fields: { email: 'An account with that email already exists.' },
    });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(values.email)) return taken();

  const passwordHash = await hashPassword(values.password);
  let userId;
  try {
    // role is never taken from the request; new accounts are always adopters.
    userId = Number(
      db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'adopter')")
        .run(values.name, values.email, passwordHash).lastInsertRowid
    );
  } catch (err) {
    // Two sign-ups with the same email at the same moment.
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return taken();
    throw err;
  }

  const token = createSession(userId);
  res.status(201).json({
    user: publicUser({ id: userId, name: values.name, email: values.email, role: 'adopter' }),
    token,
  });
});

// POST /auth/login  { email, password } -> 200 { user, token }
router.post('/login', async (req, res) => {
  const body = bodyOf(req);
  const email = normalizeEmail(body.email);
  const { password } = body;

  if (!email || typeof password !== 'string' || password === '') {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }

  // Same message for unknown email and wrong password, so this route can't be
  // used to find out who has an account. Over-long passwords simply fail.
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = password.length <= PASSWORD_MAX &&
    (await verifyPassword(password, user ? user.password_hash : await dummyHash()));
  if (!user || !ok) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }

  res.json({ user: publicUser(user), token: createSession(user.id) });
});

// POST /auth/logout -> 204. Ends the current session; succeeds even if it
// was already gone, so the browser can always clear its token.
router.post('/logout', (req, res) => {
  const token = getToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.status(204).end();
});

// GET /auth/me -> 200 { user } or 401
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = { router, requireAuth, requireAdmin };
