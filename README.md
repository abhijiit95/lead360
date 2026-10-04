# LeadFlow360

LeadFlow360 is a lead management platform for real-estate sales teams. This repository is being built incrementally. The current step provides a TypeScript/Express API backed by PostgreSQL.

## Backend

Requirements: Node.js, npm, and Docker Desktop (for local PostgreSQL).

From the repository root, copy `.env.example` to `.env` and set a private local database password. These values configure both Docker Compose and the API. Then start PostgreSQL:

```powershell
Copy-Item .env.example .env
docker compose up -d postgres
```

Start the API from the backend directory:

```powershell
cd backend
npm install
npm run dev
```

On startup, the API checks the database connection and creates the `leads` table if needed. The API listens on port `4000` by default. `GET http://localhost:4000/api/health` reports API health.

## Lead API

All examples use `http://localhost:4000`. Create a lead:

```powershell
curl.exe -X POST http://localhost:4000/api/leads `
  -H "Content-Type: application/json" `
  -d '{"name":"Rahul Sharma","email":"rahul@example.com","phone":"9876543210","source":"facebook","status":"new"}'
```

List leads:

```powershell
curl.exe http://localhost:4000/api/leads
```

List leads with pagination and filters:

```powershell
curl.exe "http://localhost:4000/api/leads?page=1&limit=10&status=new&source=website"
```

Get, update, or delete a lead by its UUID:

```powershell
curl.exe http://localhost:4000/api/leads/LEAD_UUID
curl.exe -X PATCH http://localhost:4000/api/leads/LEAD_UUID `
  -H "Content-Type: application/json" `
  -d '{"status":"contacted"}'
curl.exe -X DELETE http://localhost:4000/api/leads/LEAD_UUID
```

`name`, `email`, `phone`, and `source` are required on create. `email` is checked for basic email format; `status` is optional and defaults to `new`. PATCH accepts one or more of these fields. List requests default to page 1 and 10 results; `limit` cannot exceed 100. Invalid query or body input returns HTTP 400, and missing UUIDs return HTTP 404.

The `leads` table retains its UUID primary key, non-null columns, and defaults. Startup adds idempotent CHECK constraints preventing blank text values. Email is not unique because existing records can share an email address.

## Authentication and access control

Set `JWT_SECRET` to a random secret of at least 32 bytes and choose a duration such as `1h` for `JWT_EXPIRES_IN` in the root `.env`. Registration creates agent accounts; it never accepts a role from the request. To grant admin access, a trusted database operator can promote a registered account:

```sql
UPDATE users SET role = 'admin' WHERE email = 'admin@example.com';
```

After changing a role, log in again to receive a token containing the updated role. Lead requests require `Authorization: Bearer <accessToken>`. Admins can perform all lead operations. Agents can list, view, and update leads; creating and deleting leads requires an admin.

Register and log in:

```powershell
curl.exe -X POST http://localhost:4000/api/auth/register `
  -H "Content-Type: application/json" `
  -d '{"name":"Priya Mehta","email":"priya@example.com","password":"ChangeThis123!"}'

curl.exe -X POST http://localhost:4000/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"priya@example.com","password":"ChangeThis123!"}'
```

Use the returned `accessToken` as a Bearer token for requests to `/api/leads`.

## Project structure

- `backend/` — TypeScript and Express API, organized into routes, controllers, services, repositories, and database configuration
- `frontend/` — reserved for the Next.js application

The local Compose configuration starts PostgreSQL only. No authentication or other infrastructure is configured yet.
