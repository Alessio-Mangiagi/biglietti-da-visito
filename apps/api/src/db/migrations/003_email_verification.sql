-- Accounts must prove they own their e-mail (when the app can send mail).
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
-- accounts created before this feature are trusted as they are
UPDATE users SET email_verified_at = created_at;

CREATE TABLE email_verifications (
  token_hash  bytea PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verifications_user_idx ON email_verifications (user_id);
