const fetch = global.fetch || require('node-fetch');
const url = 'http://localhost:3000';
const email = 'testuser@example.com';
const passwordHash = 'hash-1234';
const state = {
  currentUserId: 'uid1',
  accounts: [{ id: 'uid1', name: 'Test', email, passwordHash, createdAt: new Date().toISOString() }],
  habits: [],
  completions: [],
  cloudUrl: url
};

(async () => {
  try {
    const upload = await fetch(`${url}/cloud/${encodeURIComponent(email)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, passwordHash })
    });
    console.log('upload status', upload.status);
    console.log('upload body', await upload.text());

    const download = await fetch(`${url}/cloud/${encodeURIComponent(email)}?passwordHash=${encodeURIComponent(passwordHash)}`);
    console.log('download status', download.status);
    console.log('download body', await download.text());
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();