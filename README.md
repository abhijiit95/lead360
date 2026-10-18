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

During local development, the API checks the database connection and creates its required tables if needed. The API listens on port `4000` by default. `GET http://localhost:4000/api/health` is a liveness check; `/api/health/ready` checks required database and Redis dependencies.

## Full-stack Docker Compose

The root Compose file runs the frontend, backend API, BullMQ worker, PostgreSQL, Redis, MySQL, and MongoDB together. Ensure the root `.env` already exists and is configured; Compose uses its database and application settings without copying `.env` into the images.

Start the stack from the repository root:

```sh
docker compose up --build -d
docker compose ps
```

The frontend is available at `http://localhost:5173` and the API health endpoint at `http://localhost:4000/api/health`. `VITE_API_BASE_URL` is compiled into the browser bundle and defaults to `http://localhost:4000`; set it to the API URL reachable by users' browsers for a non-local deployment. It must not be set to the Compose-only hostname `api` or `backend`.

Compose waits for infrastructure health checks before starting the API and worker, and for the API health check before starting the frontend. PostgreSQL is the backend's core database in every mode; the selected lead adapter is initialized only when configured. MySQL application settings are required by the backend only when `DATABASE_TYPE=mysql`. Compose still starts its local MySQL service and therefore uses the example's `MYSQL_*` settings to configure that service. Google OAuth secrets are passed only to the API. MongoDB root credentials stay with the MongoDB service. If selecting MongoDB with `DATABASE_TYPE=mongodb`, configure `MONGODB_DOCKER_URI` in the local `.env` with the internal hostname `mongodb` and the appropriate URL-encoded credentials. The existing `MONGODB_URI` is for processes running outside Compose. A separate `MYSQL_ROOT_PASSWORD` is recommended; if omitted, Compose uses `MYSQL_PASSWORD` as the local MySQL root password.

Stop the stack without deleting its named database volumes:

```sh
docker compose down
```

The existing `postgres_data`, `redis_data`, `mysql_data`, and `mongodb_data` volumes remain in place after this command.

### Production runtime preparation

The backend image includes a one-time, non-destructive schema initializer. Build the backend image, then run a one-off task using the same database configuration/secrets as the API with command `node dist/database-init.js` before starting or updating API and worker tasks. It creates missing PostgreSQL tables and constraints, and initializes the MySQL leads table when `DATABASE_TYPE=mysql`; it does not drop data. MongoDB creates its lead collection on first write, so the initializer verifies MongoDB connectivity when that adapter is selected. The API continues its existing schema initialization only in development. Production API and worker processes perform connection checks but no schema DDL. Local Compose keeps development mode; its API initializes schemas before the worker becomes ready.

For a production frontend image, provide `VITE_API_BASE_URL` as the HTTPS URL users' browsers will use to reach the API and build with `FRONTEND_BUILD_ENV=production`. The build rejects HTTP, localhost, and loopback URLs in production. Local Compose explicitly uses development build mode and its localhost URL. GHCR publishing reads the non-secret GitHub repository variable `VITE_API_BASE_URL`; configure it before publishing. No production domain is set in this repository.

The worker waits for BullMQ's Redis connection and updates a local heartbeat only while that Redis connection is ready. Compose health checks `node dist/scripts/worker-healthcheck.js`; configure the same command as the ECS worker container health check. This verifies process heartbeat and Redis connectivity, not successful delivery of external notifications. Notifications remain development mocks.

Socket.IO currently uses its in-memory adapter. Multiple API tasks can serve connections, but broadcasts from one task do not reach clients connected to another task. Before scaling API tasks, add and configure a supported shared Socket.IO adapter and ensure the load balancer supports the selected transport (including session stickiness for long-polling). No adapter or extra infrastructure is configured here.

Production runtime configuration must use `NODE_ENV=production`, a browser-facing HTTPS `VITE_API_BASE_URL` at frontend build time, HTTPS `FRONTEND_ORIGIN`, and exact HTTPS `GOOGLE_OAUTH_REDIRECT_URI` and `GOOGLE_OIDC_REDIRECT_URI` callback URLs registered with Google. Supply `DATABASE_TYPE`, PostgreSQL connection settings, and `REDIS_URL`. MySQL settings are needed only when `DATABASE_TYPE=mysql`; MongoDB settings are needed only when `DATABASE_TYPE=mongodb`. Supply JWT and Google OAuth secrets only through a production secret manager. Do not bake runtime credentials into images. The frontend URL is public configuration and must contain no credentials.

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

## Redis caching

PostgreSQL remains the source of truth. Redis is used only as a cache for `GET /api/leads`, using the cache-aside pattern. The first request for a query reads from PostgreSQL and stores the response in Redis; an identical request within the TTL can be served from Redis without querying PostgreSQL. Cache keys include page, limit, status, and source, so different query combinations do not share cached responses.

Configure `REDIS_URL` in the root `.env` (the example value is `redis://localhost:6379`). `LEADS_CACHE_TTL_SECONDS` controls the lead-list cache lifetime and defaults to 60 seconds.

Start PostgreSQL and Redis from the repository root:

```sh
docker compose up -d postgres redis
docker compose ps
```

Verify Redis is responding:

```sh
docker exec -it leadflow360-redis redis-cli
PING
```

Redis cache entries are invalidated after a successful lead create, update, or delete. If Redis is unavailable, the API logs the cache issue and continues reading from PostgreSQL; a cache write or invalidation failure does not turn a successful database operation into an API failure. Redis reconnects in the background when its connection drops. PostgreSQL errors are still returned through the normal API error handling.

## Background lead jobs

BullMQ stores asynchronous jobs in Redis. The API is the **producer**: after a lead is saved and list caches are invalidated, it enqueues a development notification and a one-time delayed follow-up using only the lead ID. A separate **worker** fetches the current lead through the configured repository and runs the job. The notification adapters are explicitly development-only mocks; no WhatsApp message is sent.

The database write and queue insertion are separate operations, so they are not atomic. If Redis is down or insertion times out, the lead remains created, the API logs the enqueue failure, and the existing create response is returned. This can leave a lead without jobs; a transactional outbox would be a future reliability improvement. Queue insertion uses stable job IDs to avoid duplicates while a job with that ID is retained. Completed jobs are removed after the retention window, so this is not permanent exactly-once protection. Follow-ups are one-time delayed jobs, not repeating reminders. The worker reloads the lead at execution time and skips reminders for leads that have since been deleted.

`LEAD_FOLLOWUP_DELAY_SECONDS` defaults to `86400` (one day), `LEAD_JOB_ENQUEUE_TIMEOUT_MS` defaults to `3000`, and `LEAD_JOB_WORKER_CONCURRENCY` defaults to `5`. Jobs use five attempts with exponential backoff starting at one second; up to 500 completed and 1,000 failed jobs are retained. BullMQ uses separate ioredis connections, while the existing node-redis client continues to serve caching.

Start Redis and the API, then start the worker in a second terminal from `backend`:

```sh
npm run dev
npm run dev:worker
```

For a built deployment, run `npm run build`, then `npm start` and `npm run start:worker` in separate processes. Inspect status counts and recent failure reasons without printing job payloads with `npm run jobs:inspect`. Shutdown signals close the API/worker, database pools, and queue connections gracefully. Run unit tests with `npm test`; `npm run test:integration` runs Redis-backed integration tests when those test files are present.

## Real-time lead updates (Socket.IO)

The API attaches Socket.IO to the same Node HTTP server that serves Express. The service publishes an event only after its selected repository has successfully created, updated, or deleted a lead. The separate BullMQ worker continues handling notification and follow-up jobs; it does not publish these events, so one REST change produces one real-time event.

| Event | Payload |
| --- | --- |
| `lead:created` | `{ id, source, status, created_at, updated_at }` |
| `lead:updated` | `{ id, source, status, created_at, updated_at }` |
| `lead:deleted` | `{ id }` |

Payloads deliberately omit name, email, and phone. Clients authenticate the Socket.IO handshake with the same JWT returned by `/api/auth/login`, using `auth: { token: accessToken }` (the Node test client below does this). Socket connections use the same HS256 verification, expiry, subject, and admin/agent claim validation as REST Bearer authentication. Both roles may read leads through the existing REST API and can therefore join the server-controlled `leads:read` room. The server joins authenticated sockets automatically; clients cannot request arbitrary user or team rooms. Team rooms are not used because the project does not yet model teams.

The React frontend now lives in `frontend/`. A small Node client listens for events and reconnects automatically. From `backend`, first obtain an access token from the login endpoint, then run:

```sh
SOCKET_TEST_TOKEN='<access token>' npm run socket:client
```

Optionally set `SOCKET_URL` if the API is not at `http://localhost:4000`. Keep the token private. The client reports connect/disconnect and connection errors, and prints the sanitized lead event payloads. When a socket disconnects it may miss events; Socket.IO delivery is not a durable event log. After reconnecting, clients should call the authenticated `GET /api/leads` endpoint with their current page and filters, or `GET /api/leads/:id` for a specific lead, to resynchronize. The client must refresh or replace an expired token before reconnecting.

The API emits realtime events independently of BullMQ. BullMQ keeps its existing role for asynchronous notifications and delayed reminders. Running multiple API instances requires a Socket.IO adapter (for example, the Socket.IO Redis adapter) to broadcast room events across instances; the existing Redis cache client and BullMQ connections do not provide that adapter automatically. The current Socket.IO room state and broadcasts are process-local. Shutdown closes Socket.IO clients and the attached HTTP server before closing the database, cache, and queue resources.

Socket.IO transport/auth tests are included in `npm test`; build with `npm run build` as usual.

## OAuth 2.0 delegated API access

This module connects an authenticated LeadFlow360 account to Google OAuth 2.0 for delegated Google API access. It uses Google's maintained `google-auth-library` for consent URLs, PKCE, token exchange, refresh, and revocation. It remains separate from `/api/auth/login`: a Google access token is never accepted as LeadFlow360 identity. This is not Google Login or OIDC.

`POST /api/oauth/google/connect` requires the existing LeadFlow360 JWT. The API creates state and an S256 PKCE verifier, stores a one-time transaction in Redis (ten minutes by default), and redirects to Google. `GET /api/oauth/google/callback` consumes state once, validates it and the transaction expiry, then exchanges the code with the verifier. `GET /api/oauth/google/resource` requires the LeadFlow360 JWT and calls the configured Google resource URL server-side. `DELETE /api/oauth/google/connection` revokes the saved Google token and removes local storage.

The exact callback URL configured in code and `.env.example`, and the URI that must be registered in Google Cloud Console, is:

```text
http://localhost:4000/api/oauth/google/callback
```

Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_OAUTH_REDIRECT_URI` in the root `.env`. Choose `GOOGLE_OAUTH_SCOPES` and `GOOGLE_OAUTH_RESOURCE_URL` for the specific Google API enabled in the Cloud project; this project does not assume a Google API or request identity scopes. Set `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` to a base64 encoded 32-byte key (`openssl rand -base64 32`). `GOOGLE_OAUTH_TRANSACTION_TTL_SECONDS` defaults to 600. Keep secrets in an ignored local `.env` or production secret manager; `.env` is ignored by Git. Do not copy credentials into source or `.env.example`.

Provider access and refresh tokens are AES-256-GCM encrypted in PostgreSQL. Redis is required for short-lived OAuth transactions. Expired access tokens are refreshed when Google supplies a refresh token; updated credentials remain encrypted. The resource URL is fixed by server configuration and never comes from the request. Production requires HTTPS and the exact production callback registered with Google. Request only the narrow scopes required by the enabled API. OAuth 2.0 delegates resource access; OIDC adds identity assertions and is intentionally out of scope.

## Project structure

- `backend/` — TypeScript and Express API, organized into routes, controllers, services, repositories, and database configuration
- `backend/src/config/socket.ts` and `backend/src/realtime/` — authenticated realtime server and typed lead events
- `backend/src/scripts/socket-test-client.ts` — minimal Socket.IO event listener for local verification
- `frontend/` — React + TypeScript + Vite login page for Google OIDC

The local Compose configuration starts PostgreSQL and Redis. Redis is an optional cache layer; authentication and lead data remain backed by PostgreSQL and the existing API.

## Google Login with OpenID Connect

The React login UI is in `frontend/` and uses a separate backend OIDC flow. It does not reuse the Google Drive delegated OAuth routes. The browser opens `GET /api/oidc/google/login`; the backend creates one-time state, nonce, and an S256 PKCE challenge in Redis, then redirects to Google. Google returns to the backend callback, where `google-auth-library` exchanges the code and validates the ID token signature, issuer, audience, and expiry. The service also checks the ID-token nonce against the one-time transaction.

After verification, the backend looks up the local user by the validated Google subject in `user_identities`. It never links accounts from matching email addresses and does not auto-create unknown users. To link an existing LeadFlow360 account, use the login page's “First time?” form: it verifies the existing email/password, sends the resulting LeadFlow360 JWT only to `POST /api/oidc/google/link`, then redirects the browser to the returned Google authorization URL. Google subject links are unique. The login flow requests only the `openid` scope; it does not need a Google email/profile scope. New Google users must first have an existing LeadFlow360 account; a registration/product policy for Google-only users is not implemented.

For a linked account, the backend issues the existing LeadFlow360 HS256 JWT in an `HttpOnly; SameSite=Lax` cookie named `lf_session`; production also marks it `Secure`. The callback redirects to the frontend with only a non-sensitive status code. The frontend calls `GET /api/oidc/session` with credentials to display the signed-in user. It does not store JWTs in local or session storage. `POST /api/oidc/logout` revokes the cookie token in Redis until its JWT expiry and clears the browser cookie. Cookie-authenticated requests check this revocation record; existing Bearer-token authentication remains unchanged. Redis must remain available for OIDC transactions and cookie-session revocation.

### Local setup

Backend defaults to `http://localhost:4000`; the Vite frontend uses `http://localhost:5173`. Add the following OIDC callback variable to the existing root `.env` without removing the existing Drive OAuth variables:

```text
GOOGLE_OIDC_REDIRECT_URI=http://localhost:4000/api/oidc/google/callback
FRONTEND_ORIGIN=http://localhost:5173
```

The OIDC flow reuses the Google client ID and secret already used by the backend. In Google Cloud Console, add this exact additional Authorized redirect URI; keep the Drive callback too:

```text
http://localhost:4000/api/oidc/google/callback
```

Frontend `.env.example` contains `VITE_API_BASE_URL=http://localhost:4000`. It is a browser-visible URL only; never put Google secrets there.

Start the backend and frontend in separate terminals:

```sh
cd backend && npm run dev
```

```sh
cd frontend && npm install && npm run dev
```

Open `http://localhost:5173`, link an existing LeadFlow360 account the first time, and then choose “Continue with Google”. Redis must be available for one-time OIDC transactions. In production, use HTTPS, an exact registered callback, a same-site frontend/backend deployment for the `SameSite=Lax` cookie, and a precisely configured `FRONTEND_ORIGIN`.

### Learning flow

```text
React button → backend login endpoint → Google authentication
→ backend callback → ID-token verification → linked local user lookup
→ LeadFlow360 JWT in HttpOnly cookie → authenticated frontend page
```

- **React frontend:** displays sign-in, linking, loading, success, and error states; begins redirects and asks the API for session status.
- **Express backend:** creates and validates the OIDC transaction, validates the ID token, looks up the local identity, and sets the application cookie.
- **Google:** authenticates the account and returns an authorization code and OIDC tokens to the backend callback.
- **Google ID token:** signed identity assertion; validated by `verifyIdToken` before using its `sub`.
- **Google access token:** grants access to Google APIs; not used as proof of identity and not persisted by the login flow.
- **LeadFlow360 JWT:** existing application token; for OIDC login it is held in an HttpOnly cookie and protects app endpoints.

Automated OIDC tests use mocked Google responses. They do not claim to test live Google authentication. The existing Google Drive OAuth flow remains under `/api/oauth`.
