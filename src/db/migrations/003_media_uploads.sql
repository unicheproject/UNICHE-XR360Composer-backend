-- Resumable chunked upload sessions. A session tracks which parts have been
-- received; part bytes live in the OS temp dir until `complete` reassembles
-- them. Expired sessions are swept on the next upload init.

CREATE TABLE media_uploads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub     TEXT NOT NULL REFERENCES users(sub),
  filename      TEXT NOT NULL,
  mime          TEXT NOT NULL,
  -- Client-declared total; checked against MEDIA_MAX_BYTES at init and against
  -- the reassembled size at complete.
  declared_size BIGINT NOT NULL,
  part_size     INT NOT NULL,
  total_parts   INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE media_upload_parts (
  upload_id UUID NOT NULL REFERENCES media_uploads(id) ON DELETE CASCADE,
  part_no   INT  NOT NULL,
  size      INT  NOT NULL,
  PRIMARY KEY (upload_id, part_no)
);

CREATE INDEX idx_media_uploads_expires ON media_uploads(expires_at);
CREATE INDEX idx_media_uploads_owner ON media_uploads(owner_sub);
