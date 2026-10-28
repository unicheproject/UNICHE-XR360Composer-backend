# XR360 Composer Backend

The server of the XR360 Composer, an authoring tool for immersive 360° experiences: it stores and versions
experiences, stores media, authenticates users through Keycloak and serves the
[frontend](https://github.com/unicheproject/UNICHE-XR360Composer-frontend) build.

Node 22 · TypeScript · Fastify 5 · PostgreSQL · Keycloak.

## Run locally

You need Node.js 22 and Docker. Clone both repositories side by side; the backend serves
`../UNICHE-XR360Composer-frontend/dist` (build it as that repository's README describes, or skip it to run
API-only).

### 1. PostgreSQL and Keycloak

```sh
docker run -d --name xr360-postgres -p 5432:5432 \
  -e POSTGRES_USER=xr360 -e POSTGRES_PASSWORD=xr360devpassword -e POSTGRES_DB=xr360 postgres:17
docker run -d --name xr360-keycloak -p 8081:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26.2 start-dev
```

These match the backend's defaults, so neither needs configuring.

### 2. Keycloak realm

In the Keycloak admin console (port 8081, `admin` / `admin`):

1. Create the realm `uniche`.
2. Create the client `xr360composer-web`: client authentication **off**, standard flow **on**, PKCE method
   **S256**. Add `<origin>/*` to the valid redirect and post-logout redirect URIs and `<origin>` to the web
   origins, for every origin the composer is opened from: the backend (port 8080) and, when developing the
   frontend, its dev server (port 5173).
3. Create a user with a password and an e-mail address marked **verified** (unverified users are rejected).

### 3. Start

Create `.env` in this folder (ignored by git):

```sh
STORAGE_DRIVER=local
KEYCLOAK_REQUIRED_AUDIENCE=
```

`STORAGE_DRIVER=local` keeps media in `./data/media`. The empty audience turns off a check that plain
Keycloak tokens fail. Then:

```sh
npm ci
npm run build
node --env-file=.env dist/server.js
```

The composer is at port 8080. Migrations run at startup. For reload on change, use
`npx tsx watch --env-file=.env src/server.ts` instead of the last two commands.

## Configuration

Every setting is an environment variable; all of them, with defaults, are in `src/config.ts`. The ones
you are most likely to change:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `KEYCLOAK_PUBLIC_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID` | Keycloak as the browser reaches it. Must match the token issuer exactly |
| `KEYCLOAK_INTERNAL_URL` | Keycloak as the backend reaches it, when that differs (e.g. inside a container network) |
| `STORAGE_DRIVER` | `s3` (default) or `local` |
| `MINIO_*` | S3-compatible storage (MinIO, AWS S3, …). `MINIO_PUBLIC_*` is the host browsers download media from |
| `CATALOGUE_URL` | Optional project catalogue. Without it, users see only the experiences they created |
| `NODE_ENV=production` | Refuses to start with the development default secrets |

## Docker

```sh
docker build --build-context frontend-dist=../UNICHE-XR360Composer-frontend/dist -t xr360-composer-backend .
```

Leave out `--build-context` for an API-only image. The container listens on port 8080 and keeps local-driver
media in `/data/media` (mount a volume there).

## Third-party components

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
