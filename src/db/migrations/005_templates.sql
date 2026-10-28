-- Experience templates: reusable, org-scoped snapshots of experience content.
-- json_blob carries stable /api/media/<sha256> URLs, so templates count as
-- media references.

CREATE TABLE experience_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Catalogue org the template is scoped to; visible to that org's members.
  org_id           TEXT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT,
  json_blob        JSONB NOT NULL,
  created_by       TEXT NOT NULL,
  created_by_email TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_templates_org ON experience_templates(org_id);
