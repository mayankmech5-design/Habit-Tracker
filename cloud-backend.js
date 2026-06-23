const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(helmet());
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));

// Global rate limit (lenient)
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // limit each IP to 120 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// Stricter limiter for admin endpoints
const adminLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const backupFile = path.resolve(__dirname, 'cloud-data.json');
const backupsDir = path.resolve(__dirname, 'backups');
const maxBackups = 10; // keep this many recent backups
const store = new Map();

function loadStore() {
  try {
    if (!fs.existsSync(backupFile)) return;
    const file = fs.readFileSync(backupFile, 'utf8');
    const data = JSON.parse(file);
    if (data && typeof data === 'object') {
      Object.entries(data).forEach(([email, value]) => {
        if (value && typeof value === 'object' && value.passwordHash && value.state) {
          store.set(email, value);
        }
      });
    }
    console.log(`Loaded ${store.size} cloud backup(s) from disk.`);
  } catch (error) {
    console.error('Failed to load cloud backup file:', error);
  }
}

function saveStore() {
  try {
    const data = Object.fromEntries(store.entries());
    fs.writeFileSync(backupFile, JSON.stringify(data, null, 2), 'utf8');
    try {
      if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = `cloud-data-${timestamp}.json`;
      const backupPath = path.join(backupsDir, backupName);
      fs.writeFileSync(backupPath, JSON.stringify(data, null, 2), 'utf8');
      // prune old backups
      const files = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.json')).sort();
      if (files.length > maxBackups) {
        const remove = files.slice(0, files.length - maxBackups);
        remove.forEach((file) => {
          try { fs.unlinkSync(path.join(backupsDir, file)); } catch (e) { /* ignore */ }
        });
      }
    } catch (e) {
      console.error('Failed to write backup copy:', e);
    }
  } catch (error) {
    console.error('Failed to save cloud backup file:', error);
  }
}

loadStore();

app.post('/cloud/:email', (req, res) => {
  const email = req.params.email;
  const { state, passwordHash } = req.body;
  // basic validation
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ message: 'Invalid email.' });
  }
  if (!passwordHash || typeof passwordHash !== 'string' || passwordHash.length > 200) {
    return res.status(400).json({ message: 'Invalid passwordHash.' });
  }
  if (state === undefined || state === null) {
    return res.status(400).json({ message: 'Missing state.' });
  }
  const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
  const byteLen = Buffer.byteLength(stateStr, 'utf8');
  if (byteLen > 200 * 1024) { // 200 KB limit
    return res.status(413).json({ message: 'State payload too large.' });
  }

  const existing = store.get(email);
  if (existing && existing.passwordHash !== passwordHash) {
    return res.status(401).json({ message: 'Invalid password.' });
  }

  store.set(email, { passwordHash, state });
  saveStore();
  return res.json({ message: 'Backup saved.' });
});

app.get('/cloud/:email', (req, res) => {
  const email = req.params.email;
  const passwordHash = req.query.passwordHash;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ message: 'Invalid email.' });
  }
  if (!passwordHash || typeof passwordHash !== 'string') {
    return res.status(400).json({ message: 'Missing passwordHash.' });
  }

  const existing = store.get(email);
  if (!existing || existing.passwordHash !== passwordHash) {
    return res.status(401).json({ message: 'Invalid credentials or no cloud data.' });
  }

  return res.json({ state: existing.state });
});

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'habit-tracker-backend' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Admin: create a manual backup, list backups, and download
app.post('/admin/backup', adminLimiter, (_req, res) => {
  try {
    saveStore();
    const files = fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).filter((f) => f.endsWith('.json')).sort() : [];
    const latest = files.length ? files[files.length - 1] : null;
    return res.json({ message: 'Backup created', file: latest });
  } catch (e) {
    return res.status(500).json({ message: 'Backup failed', error: String(e) });
  }
});

app.get('/admin/backups', adminLimiter, (_req, res) => {
  try {
    if (!fs.existsSync(backupsDir)) return res.json({ backups: [] });
    const files = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.json')).sort();
    return res.json({ backups: files });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to list backups', error: String(e) });
  }
});

app.get('/admin/backups/:file', adminLimiter, (req, res) => {
  try {
    const file = req.params.file;
    if (!/^[0-9A-Za-z\-_.]+\.json$/.test(file)) return res.status(400).json({ message: 'Invalid file name' });
    const filePath = path.join(backupsDir, file);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Not found' });
    return res.sendFile(filePath);
  } catch (e) {
    return res.status(500).json({ message: 'Failed to retrieve backup', error: String(e) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Cloud backend running on port ${port}`);
  console.log(`Health endpoint available at /health`);
});
