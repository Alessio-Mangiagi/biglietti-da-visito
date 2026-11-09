-- Access tokens issued before this instant are rejected (password change/reset).
ALTER TABLE users ADD COLUMN tokens_valid_after timestamptz NOT NULL DEFAULT '-infinity';

-- Fixed-window counters shared by every API instance (serverless rate limiting).
CREATE UNLOGGED TABLE rate_limits (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL
);
