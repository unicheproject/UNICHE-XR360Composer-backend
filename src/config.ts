import { z } from "zod"

/**
 * Runtime configuration, parsed once at boot; an invalid value exits the
 * process. Defaults target the local dev stack. With NODE_ENV=production the
 * known dev-default secrets are rejected.
 */

// Only "true"/"1" are true; z.coerce.boolean() would turn "false" into true.
const boolFromEnv = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? fallback : v === "true" || v === "1"))

// Optional URL: empty string → undefined (so `??` fallbacks apply), trailing slash stripped.
const urlFromEnv = () =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.replace(/\/$/, "") : undefined))

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),

  DATABASE_URL: z
    .string()
    .default("postgres://xr360:xr360devpassword@localhost:5432/xr360"),

  // "s3" = MinIO or any S3-compatible endpoint; "local" = a plain directory.
  // The MINIO_* vars are read only by the "s3" driver.
  STORAGE_DRIVER: z.enum(["s3", "local"]).default("s3"),
  STORAGE_LOCAL_DIR: z.string().default("./data/media"),

  MINIO_ENDPOINT: z.string().default("localhost"),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: boolFromEnv(false),
  MINIO_ACCESS_KEY: z.string().default("minioadmin"),
  MINIO_SECRET_KEY: z.string().default("minioadmin"),
  MINIO_BUCKET: z.string().default("xr360-media"),
  // Must match the bucket's region. Passed explicitly so presigning never looks
  // the region up via the public endpoint.
  MINIO_REGION: z.string().default("us-east-1"),
  // Path-style (host/bucket/key) for MinIO; false = virtual-host style for regional AWS endpoints.
  MINIO_PATH_STYLE: boolFromEnv(true),
  // Host the browser uses to reach MinIO; presigned URLs are signed against it.
  MINIO_PUBLIC_ENDPOINT: z.string().default("localhost"),
  MINIO_PUBLIC_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_PUBLIC_USE_SSL: boolFromEnv(false),
  MEDIA_URL_EXPIRY_SECONDS: z.coerce.number().int().positive().default(3600),
  // Per-file upload cap (default 2 GiB). Uploads stream to disk, so this bounds disk, not RAM.
  MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024 * 1024),

  // Chunked (resumable) upload. Part bytes spool to the OS temp dir until `complete`.
  MEDIA_UPLOAD_PART_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
  MEDIA_UPLOAD_MAX_PART_BYTES: z.coerce.number().int().positive().default(64 * 1024 * 1024),
  MEDIA_UPLOAD_MAX_PARTS: z.coerce.number().int().positive().default(10_000),
  MEDIA_UPLOAD_TTL_MINUTES: z.coerce.number().int().positive().default(1440),

  // Keycloak URL as the browser reaches it (also returned by /api/config); the token issuer derives from it.
  KEYCLOAK_PUBLIC_URL: z.string().default("http://localhost:8081"),
  // Keycloak URL as the backend reaches it (JWKS, token endpoint). Unset or empty = the public URL.
  KEYCLOAK_INTERNAL_URL: urlFromEnv(),
  KEYCLOAK_REALM: z.string().default("uniche"),
  // Public SPA client the composer logs in through (Auth Code + PKCE).
  KEYCLOAK_CLIENT_ID: z.string().default("xr360composer-web"),
  // Required `aud` claim; empty disables the check.
  KEYCLOAK_REQUIRED_AUDIENCE: z.string().default("uniche-platform"),
  // Confidential client for service-to-service Catalogue calls (client_credentials).
  // The secret has no default.
  KEYCLOAK_SVC_CLIENT_ID: z.string().default("xr360composer-svc"),
  KEYCLOAK_SVC_CLIENT_SECRET: z.string().optional(),

  // Catalogue (orgs/projects/membership). Backend-only, never sent to the browser.
  // Unset = integration disabled and authorization is owner-only. INTERNAL_URL
  // overrides the host the backend uses to reach it.
  CATALOGUE_URL: urlFromEnv(),
  CATALOGUE_INTERNAL_URL: urlFromEnv(),

  LOCK_TTL_MINUTES: z.coerce.number().int().positive().default(15),

  // Project scope for new experiences created without a Catalogue project.
  DEFAULT_PROJECT_ID: z.string().default("default"),

  // Tool slug this backend is registered under in the Catalogue. Must match a
  // registered tool slug, or every project is filtered out of the authorable list.
  PID_TOOL: z.string().default("xr360-composer"),

  // Composer static build directory; empty/missing dir = API-only mode.
  COMPOSER_DIST: z.string().default("../UNICHE-XR360Composer-frontend/dist"),
  MIGRATIONS_DIR: z.string().default("src/db/migrations"),

  EXPERIENCE_BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error("[config] Invalid environment:", parsed.error.flatten().fieldErrors)
  process.exit(1)
}

const env = parsed.data

if (env.NODE_ENV === "production") {
  const devDefaults: Array<[string, string, string]> = [
    ["DATABASE_URL", env.DATABASE_URL, "xr360devpassword"],
  ]
  // Only the s3 driver reads MINIO_SECRET_KEY.
  if (env.STORAGE_DRIVER === "s3") {
    devDefaults.push(["MINIO_SECRET_KEY", env.MINIO_SECRET_KEY, "minioadmin"])
  }
  // Optional, but when set it must not be the dev secret.
  if (env.KEYCLOAK_SVC_CLIENT_SECRET) {
    devDefaults.push([
      "KEYCLOAK_SVC_CLIENT_SECRET",
      env.KEYCLOAK_SVC_CLIENT_SECRET,
      "dev-svc-secret",
    ])
  }
  for (const [name, value, marker] of devDefaults) {
    if (value.includes(marker)) {
      console.error(`[config] ${name} still uses the dev default in production. Refusing to start.`)
      process.exit(1)
    }
  }
}

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  storage: {
    driver: env.STORAGE_DRIVER,
    localDir: env.STORAGE_LOCAL_DIR,
  },
  minio: {
    endpoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSsl: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ACCESS_KEY,
    secretKey: env.MINIO_SECRET_KEY,
    bucket: env.MINIO_BUCKET,
    region: env.MINIO_REGION,
    pathStyle: env.MINIO_PATH_STYLE,
    publicEndpoint: env.MINIO_PUBLIC_ENDPOINT,
    publicPort: env.MINIO_PUBLIC_PORT,
    publicUseSsl: env.MINIO_PUBLIC_USE_SSL,
  },
  media: {
    urlExpirySeconds: env.MEDIA_URL_EXPIRY_SECONDS,
    maxBytes: env.MEDIA_MAX_BYTES,
    upload: {
      defaultPartBytes: env.MEDIA_UPLOAD_PART_BYTES,
      maxPartBytes: env.MEDIA_UPLOAD_MAX_PART_BYTES,
      maxParts: env.MEDIA_UPLOAD_MAX_PARTS,
      ttlMinutes: env.MEDIA_UPLOAD_TTL_MINUTES,
    },
  },
  keycloak: {
    publicUrl: env.KEYCLOAK_PUBLIC_URL.replace(/\/$/, ""),
    internalUrl: env.KEYCLOAK_INTERNAL_URL ?? env.KEYCLOAK_PUBLIC_URL.replace(/\/$/, ""),
    realm: env.KEYCLOAK_REALM,
    clientId: env.KEYCLOAK_CLIENT_ID,
    // Empty string = audience check disabled.
    requiredAudience: env.KEYCLOAK_REQUIRED_AUDIENCE,
    // Confidential client for outbound service-to-service tokens. Unset secret = service calls disabled.
    svc: {
      clientId: env.KEYCLOAK_SVC_CLIENT_ID,
      secret: env.KEYCLOAK_SVC_CLIENT_SECRET,
      get tokenUrl() {
        return `${config.keycloak.internalUrl}/realms/${config.keycloak.realm}/protocol/openid-connect/token`
      },
    },
    get issuer() {
      return `${config.keycloak.publicUrl}/realms/${config.keycloak.realm}`
    },
    get jwksUri() {
      return `${config.keycloak.internalUrl}/realms/${config.keycloak.realm}/protocol/openid-connect/certs`
    },
  },
  // `enabled` gates the user-token Catalogue calls and needs only the URL;
  // service-token calls are additionally gated on the svc secret.
  catalogue: {
    internalUrl: env.CATALOGUE_INTERNAL_URL ?? env.CATALOGUE_URL,
    enabled: Boolean(env.CATALOGUE_URL),
  },
  lockTtlMinutes: env.LOCK_TTL_MINUTES,
  // Platform identifier parts. `tool` is the registered tool slug; the project is per-row data.
  pid: {
    tool: env.PID_TOOL,
    defaultProject: env.DEFAULT_PROJECT_ID,
  },
  composerDist: env.COMPOSER_DIST,
  migrationsDir: env.MIGRATIONS_DIR,
  experienceBodyLimitBytes: env.EXPERIENCE_BODY_LIMIT_BYTES,
}

export type Config = typeof config
