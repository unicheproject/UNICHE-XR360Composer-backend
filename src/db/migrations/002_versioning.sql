-- Versioning: experiences.draft_json is the autosaved working copy;
-- experience_versions holds immutable (major, minor) snapshots. Existing
-- versions become major 0 (version N -> 0.N). published_major is a movable
-- pointer (NULL = never published).

ALTER TABLE experiences RENAME COLUMN current_json TO draft_json;

ALTER TABLE experiences
  ADD COLUMN major            INT NOT NULL DEFAULT 0,
  ADD COLUMN minor            INT NOT NULL DEFAULT 0,
  ADD COLUMN published_major  INT,
  ADD COLUMN draft_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE experiences SET minor = current_version, draft_updated_at = updated_at;

ALTER TABLE experiences DROP COLUMN current_version;

ALTER TABLE experience_versions
  ADD COLUMN major INT,
  ADD COLUMN minor INT;

UPDATE experience_versions SET major = 0, minor = version_no;

ALTER TABLE experience_versions
  ALTER COLUMN major SET NOT NULL,
  ALTER COLUMN minor SET NOT NULL;

-- Re-key: (experience_id, major, minor) is the identity. Dropping version_no
-- also drops its UNIQUE constraint and the idx_versions_exp index.
ALTER TABLE experience_versions DROP CONSTRAINT experience_versions_pkey;
ALTER TABLE experience_versions DROP COLUMN id;
ALTER TABLE experience_versions DROP COLUMN version_no;
ALTER TABLE experience_versions ADD PRIMARY KEY (experience_id, major, minor);
