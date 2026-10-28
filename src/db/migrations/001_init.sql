-- Initial schema: users, experiences (with current snapshot + lock columns),
-- append-only version history, email-based shares, content-addressed media.

CREATE TABLE users (
  sub          TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE experiences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Project scope: the Catalogue project the experience belongs to.
  project_id      TEXT NOT NULL DEFAULT 'default',
  owner_sub       TEXT NOT NULL REFERENCES users(sub),
  owner_email     TEXT NOT NULL,
  title           TEXT NOT NULL,
  current_version INT  NOT NULL DEFAULT 0,
  current_json    JSONB NOT NULL,
  locked_by       TEXT,
  locked_by_email TEXT,
  locked_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE experience_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  version_no    INT  NOT NULL,
  json_blob     JSONB NOT NULL,
  author_sub    TEXT NOT NULL,
  author_email  TEXT,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (experience_id, version_no)
);

CREATE TABLE experience_shares (
  experience_id     UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  shared_with_email TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (experience_id, shared_with_email)
);

CREATE TABLE media (
  hash              TEXT PRIMARY KEY, -- sha256 hex of the file bytes
  bucket_key        TEXT NOT NULL,
  mime              TEXT NOT NULL,
  size              BIGINT NOT NULL,
  original_name     TEXT,
  first_uploaded_by TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_experiences_owner ON experiences(owner_sub);
CREATE INDEX idx_experiences_project ON experiences(project_id);
CREATE INDEX idx_shares_email ON experience_shares(shared_with_email);
CREATE INDEX idx_versions_exp ON experience_versions(experience_id, version_no DESC);
