/* =============================================================================
   CloudPaw — create or reset an admin account

   Usage (from the backend folder):
     node create-admin.js <email> <name>

   Asks for the password without showing it, then:
     - no user with that email: creates one with role "admin"
     - user already exists:     sets role to "admin", sets the name, replaces the
                                password and signs them out everywhere (deletes
                                their sessions), so the old password stops working
                                at once.

   Passwords are hashed with hashPassword from auth.js, exactly like sign-up.
   In a terminal you're asked twice; if the password is piped in instead
   (echo "..." | node create-admin.js ...), the first line is used once.
   ============================================================================= */

const readline = require('readline');
const db = require('./db');
const {
  hashPassword, normalizeEmail, PASSWORD_MIN, PASSWORD_MAX, NAME_MAX, EMAIL_MAX, EMAIL_PATTERN,
} = require('./auth');

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

// Reads one line from the terminal with nothing echoed.
function askHidden(question) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    // Turn off echo before showing the prompt, so nothing typed right away is shown.
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdout.write(question);

    let input = '';
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') { // Enter or Ctrl-D
          finish();
          return resolve(input);
        }
        if (ch === '\u0003') { // Ctrl-C
          finish();
          console.error('Cancelled.');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') input = input.slice(0, -1); // Backspace
        else input += ch;
      }
    };
    stdin.on('data', onData);
  });
}

// Reads the first line of piped input.
async function readPipedLine() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    rl.close();
    return line.replace(/\r$/, '');
  }
  return '';
}

async function getPassword() {
  if (!process.stdin.isTTY) return readPipedLine();
  const password = await askHidden('Password: ');
  const confirm = await askHidden('Confirm password: ');
  if (password !== confirm) fail("Passwords don't match.");
  return password;
}

async function main() {
  const [rawEmail, ...nameParts] = process.argv.slice(2);
  const email = normalizeEmail(rawEmail);
  const name = nameParts.join(' ').trim(); // allows: node create-admin.js a@b.com Jordan Test

  if (!email || !name) fail('Usage: node create-admin.js <email> <name>');
  if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) fail('Enter a valid email address.');
  if (name.length > NAME_MAX) fail(`Name must be ${NAME_MAX} characters or fewer.`);

  const password = await getPassword();
  if (password.length < PASSWORD_MIN) fail(`Password must be at least ${PASSWORD_MIN} characters.`);
  if (password.length > PASSWORD_MAX) fail(`Password must be ${PASSWORD_MAX} characters or fewer.`);

  const passwordHash = await hashPassword(password);
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

  if (existing) {
    db.transaction(() => {
      db.prepare("UPDATE users SET name = ?, password_hash = ?, role = 'admin' WHERE id = ?")
        .run(name, passwordHash, existing.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
    })();
    console.log(`Updated ${email} (id ${existing.id}): role admin, password reset, old sessions signed out.`);
  } else {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
      .run(name, email, passwordHash);
    console.log(`Created admin ${email} (id ${lastInsertRowid}).`);
  }
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
