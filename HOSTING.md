# Backend Hosting Guide

This project includes a small Node/Express backup backend in `cloud-backend.js`.

## What the backend does

- `POST /cloud/:email`
  - saves a user state payload
  - requires JSON body `{ state, passwordHash }`

- `GET /cloud/:email?passwordHash=...`
  - returns the saved state for that email
  - requires a matching `passwordHash`

## How to deploy

### 1. Add the backend to a Node host

Choose a service such as:
- Render
- Railway
- Fly.io
- DigitalOcean App Platform
- Heroku (if available)

### 2. Point the host at this repository

Use the repository root containing `package.json` and `cloud-backend.js`.

### 3. Set the startup command

Use:

```sh
npm run start:backend
```

### 4. Confirm deployment

Use a browser or HTTP client to test:

```sh
GET https://<your-host>/cloud/<email>?passwordHash=<hash>
```

```sh
POST https://<your-host>/cloud/<email>
Content-Type: application/json

{
  "state": { ... },
  "passwordHash": "hash-..."
}
```

## Notes

- `cloud-backend.js` writes to `cloud-data.json` for persistence.
- `cloud-data.json` is ignored by Git because it is runtime data.
- For production use, a real database is recommended, but disk persistence is acceptable for prototypes.

## App configuration

In `App.tsx`, update:

```ts
const cloudBackendUrl = 'https://your-host'
```

Once deployed and updated, the app will sync to your hosted backend.
