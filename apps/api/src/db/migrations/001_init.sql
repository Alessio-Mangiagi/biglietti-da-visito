-- CardVault initial schema
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() is STABLE (depends on search_path); this wrapper pins the dictionary so it can be
-- used in expression indexes.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- normalised text used by every search predicate: lower-case, no accents.
-- Schema-qualified: since PG17 index maintenance runs with search_path = pg_catalog.
CREATE OR REPLACE FUNCTION f_norm(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT lower(public.f_unaccent(coalesce($1, ''))) $$;

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL,
  password_hash       text NOT NULL,
  display_name        text NOT NULL,
  privacy_accepted_at timestamptz NOT NULL,
  failed_logins       integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Opaque refresh tokens, stored hashed. Rotated on every use; reuse of a rotated token
-- revokes the whole family (stolen-token detection).
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  token_hash  bytea NOT NULL UNIQUE,
  user_agent  text,
  expires_at  timestamptz NOT NULL,
  rotated_at  timestamptz, -- superseded by a newer token of the same family
  revoked_at  timestamptz, -- explicitly ended (logout, reset, theft)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE password_resets (
  token_hash  bytea PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id);

CREATE TABLE contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_self      boolean NOT NULL DEFAULT false,
  client_ref   uuid, -- idempotency key from the offline queue
  prefix       text NOT NULL DEFAULT '',
  first_name   text NOT NULL DEFAULT '',
  last_name    text NOT NULL DEFAULT '',
  company      text NOT NULL DEFAULT '',
  job_title    text NOT NULL DEFAULT '',
  emails       text[] NOT NULL DEFAULT '{}',
  phones       jsonb NOT NULL DEFAULT '[]',
  phone_keys   text[] NOT NULL DEFAULT '{}', -- E.164, for duplicate detection
  website      text NOT NULL DEFAULT '',
  street       text NOT NULL DEFAULT '',
  city         text NOT NULL DEFAULT '',
  postal_code  text NOT NULL DEFAULT '',
  province     text NOT NULL DEFAULT '',
  country      text NOT NULL DEFAULT '',
  socials      jsonb NOT NULL DEFAULT '[]',
  notes        text NOT NULL DEFAULT '',
  tags         text[] NOT NULL DEFAULT '{}',
  met_at       text NOT NULL DEFAULT '',
  met_on       date,
  favorite     boolean NOT NULL DEFAULT false,
  ocr_text     text NOT NULL DEFAULT '',
  search_text  text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contacts_user_updated_idx ON contacts (user_id, updated_at DESC);
CREATE UNIQUE INDEX contacts_one_self_per_user ON contacts (user_id) WHERE is_self;
CREATE UNIQUE INDEX contacts_client_ref_key ON contacts (user_id, client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX contacts_search_trgm ON contacts USING gin (search_text gin_trgm_ops);
CREATE INDEX contacts_name_trgm ON contacts USING gin (f_norm(first_name || ' ' || last_name) gin_trgm_ops);
CREATE INDEX contacts_company_trgm ON contacts USING gin (f_norm(company) gin_trgm_ops);
CREATE INDEX contacts_job_trgm ON contacts USING gin (f_norm(job_title) gin_trgm_ops);
CREATE INDEX contacts_city_trgm ON contacts USING gin (f_norm(city) gin_trgm_ops);
CREATE INDEX contacts_met_at_trgm ON contacts USING gin (f_norm(met_at) gin_trgm_ops);
CREATE INDEX contacts_tags_idx ON contacts USING gin (tags);
CREATE INDEX contacts_emails_idx ON contacts USING gin (emails);
CREATE INDEX contacts_phone_keys_idx ON contacts USING gin (phone_keys);
CREATE INDEX contacts_met_on_idx ON contacts (user_id, met_on);

-- search_text: every searchable field, normalised. Kept by trigger because array_to_string
-- and jsonb functions are not IMMUTABLE and cannot back a generated column.
CREATE OR REPLACE FUNCTION contacts_search_text() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := f_norm(concat_ws(' ',
    NEW.prefix, NEW.first_name, NEW.last_name, NEW.company, NEW.job_title,
    array_to_string(NEW.emails, ' '),
    (SELECT string_agg(p->>'value', ' ') FROM jsonb_array_elements(NEW.phones) p),
    NEW.website, NEW.street, NEW.city, NEW.postal_code, NEW.province, NEW.country,
    array_to_string(NEW.tags, ' '), NEW.met_at, NEW.notes));
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER contacts_search_text_trg
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION contacts_search_text();

-- Card photos, AES-256-GCM encrypted by the API (key never reaches the DB server).
CREATE TABLE contact_images (
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  side        text NOT NULL CHECK (side IN ('front', 'back')),
  mime        text NOT NULL,
  key_version smallint NOT NULL DEFAULT 1,
  iv          bytea NOT NULL,
  auth_tag    bytea NOT NULL,
  data        bytea NOT NULL,
  byte_size   integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, side)
);
