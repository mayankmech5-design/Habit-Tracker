const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));

const backupFile = path.resolve(__dirname, 'cloud-data.json');
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
  } catch (error) {
    console.error('Failed to save cloud backup file:', error);
  }
}

loadStore();

app.post('/cloud/:email', (req, res) => {
  const email = req.params.email;
  const { state, passwordHash } = req.body;

  if (!email || !state || !passwordHash) {
    return res.status(400).json({ message: 'Missing email, passwordHash, or state.' });
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

  if (!email || !passwordHash) {
    return res.status(400).json({ message: 'Missing email or passwordHash.' });
  }

  const existing = store.get(email);
  if (!existing || existing.passwordHash !== passwordHash) {
    return res.status(401).json({ message: 'Invalid credentials or no cloud data.' });
  }

  return res.json({ state: existing.state });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Cloud backend running on http://localhost:${port}`);
});
