const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();
app.use(helmet());
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));

// Global rate limit (lenient)
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// Stricter limiter for admin endpoints
const adminLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const dataDir = path.resolve(__dirname, 'data');
const dbFile = path.join(dataDir, 'cloud-data.json');
const backupsDir = path.resolve(__dirname, 'backups');
const maxBackups = 14;
const backupIntervalMs = 24 * 60 * 60 * 1000;

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

async function initDb() {
  try {
    await db.read();
    if (!db.data) {
      db.data = { users: [], sessions: [], states: [] };
      await db.write();
    }
  } catch (err) {
    console.error('Failed to initialize DB:', err);
    db.data = { users: [], sessions: [], states: [] };
  }
}

initDb();

const getUserByEmail = (email) => db.data.users.find((user) => user.email === email);
const getUserById = (id) => db.data.users.find((user) => user.id === id);
const insertUser = (user) => { db.data.users.push(user); db.write().catch((e) => console.error('db write failed', e)); };
const upsertState = (userId, stateJson) => {
  const index = db.data.states.findIndex((item) => item.user_id === userId);
  const updatedAt = new Date().toISOString();
  if (index >= 0) {
    db.data.states[index] = { user_id: userId, state_json: stateJson, updated_at: updatedAt };
  } else {
    db.data.states.push({ user_id: userId, state_json: stateJson, updated_at: updatedAt });
  }
  db.write().catch((e) => console.error('db write failed', e));
};
const getStateByUserId = (userId) => db.data.states.find((item) => item.user_id === userId);
const insertSession = (session) => { db.data.sessions.push(session); db.write().catch((e) => console.error('db write failed', e)); };
const getSessionByToken = (token) => db.data.sessions.find((item) => item.token === token && item.expires_at > new Date().toISOString());
const deleteSession = (token) => {
  db.data.sessions = db.data.sessions.filter((item) => item.token !== token);
  db.write().catch((e) => console.error('db write failed', e));
};

function createHash(password, salt = null) {
  const usedSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(password, usedSalt, 120000, 64, 'sha512').toString('hex');
  return { hash: derived, salt: usedSalt };
}

function verifyPassword(password, hash, salt) {
  const derived = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function tryBackupDatabase() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `cloud-data-${timestamp}.json`;
    const backupPath = path.join(backupsDir, backupName);
    fs.copyFileSync(dbFile, backupPath);
    pruneOldBackups();
    return backupName;
  } catch (error) {
    console.error('Failed to create backup copy:', error);
    return null;
  }
}

function pruneOldBackups() {
  const files = fs.readdirSync(backupsDir).filter((file) => file.endsWith('.json')).sort();
  if (files.length <= maxBackups) return;
  const remove = files.slice(0, files.length - maxBackups);
  remove.forEach((file) => {
    try {
      fs.unlinkSync(path.join(backupsDir, file));
    } catch (ignored) {
      // ignore cleanup failure
    }
  });
}

function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing authorization token.' });
  }
  const token = authorization.slice(7).trim();
  const session = getSessionByToken(token);
  if (!session) {
    return res.status(401).json({ message: 'Invalid or expired session.' });
  }
  const user = getUserById(session.user_id);
  if (!user) {
    return res.status(401).json({ message: 'User not found.' });
  }
  req.user = user;
  next();
}

app.post('/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ message: 'Register requires name, email, and password (min 6 chars).' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    return res.status(400).json({ message: 'Invalid email address.' });
  }
  if (getUserByEmail(normalizedEmail)) {
    return res.status(409).json({ message: 'Account already exists for this email.' });
  }
  const id = crypto.randomUUID();
  const { hash, salt } = createHash(password);
  insertUser({ id, name: name.trim() || normalizedEmail.split('@')[0], email: normalizedEmail, password_hash: hash, password_salt: salt, created_at: new Date().toISOString() });

  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  insertSession({ token, user_id: id, expires_at: expiresAt });

  return res.status(201).json({ user: { id, name: name.trim() || normalizedEmail.split('@')[0], email: normalizedEmail, createdAt: new Date().toISOString() }, token });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ message: 'Login requires email and password.' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const user = getUserByEmail(normalizedEmail);
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  insertSession({ token, user_id: user.id, expires_at: expiresAt });

  return res.json({ user: { id: user.id, name: user.name, email: user.email, createdAt: user.created_at }, token });
});

app.post('/auth/logout', authMiddleware, (req, res) => {
  const authorization = req.headers.authorization;
  const token = authorization.slice(7).trim();
  deleteSession(token);
  return res.json({ message: 'Logged out successfully.' });
});

app.get('/auth/me', authMiddleware, (req, res) => {
  const user = req.user;
  return res.json({ user: { id: user.id, name: user.name, email: user.email, createdAt: user.created_at } });
});

app.get('/cloud', authMiddleware, (req, res) => {
  const stateRow = getStateByUserId(req.user.id);
  if (!stateRow) {
    return res.json({ state: null });
  }
  try {
    return res.json({ state: JSON.parse(stateRow.state_json) });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to parse stored state.' });
  }
});

app.post('/cloud', authMiddleware, (req, res) => {
  const { state } = req.body;
  if (state === undefined || state === null) {
    return res.status(400).json({ message: 'Missing state payload.' });
  }
  const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
  const byteLen = Buffer.byteLength(stateStr, 'utf8');
  if (byteLen > 250 * 1024) {
    return res.status(413).json({ message: 'State payload too large.' });
  }

  upsertState(req.user.id, stateStr);
  return res.json({ message: 'State synced successfully.' });
});

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'habit-tracker-cloud-backend' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.post('/admin/backup', adminLimiter, (_req, res) => {
  const backupName = tryBackupDatabase();
  if (!backupName) {
    return res.status(500).json({ message: 'Backup failed.' });
  }
  return res.json({ message: 'Backup created', file: backupName });
});

app.get('/admin/backups', adminLimiter, (_req, res) => {
  const files = fs.readdirSync(backupsDir).filter((file) => file.endsWith('.json')).sort();
  return res.json({ backups: files });
});

app.get('/admin/backups/:file', adminLimiter, (req, res) => {
  const fileName = req.params.file;
  if (!/^[0-9A-Za-z\-_.]+\.json$/.test(fileName)) {
    return res.status(400).json({ message: 'Invalid file name.' });
  }
  const filePath = path.join(backupsDir, fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'Backup not found.' });
  }
  return res.sendFile(filePath);
});

setInterval(() => {
  tryBackupDatabase();
}, backupIntervalMs);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Cloud backend running on port ${port}`);
  console.log(`Health endpoint available at /health`);
  tryBackupDatabase();
});
