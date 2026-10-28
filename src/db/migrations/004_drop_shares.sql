-- Drops tool-local experience sharing; collaboration is a Catalogue project
-- membership. Destructive: existing share rows are not migrated.

DROP INDEX IF EXISTS idx_shares_email;
DROP TABLE IF EXISTS experience_shares;
