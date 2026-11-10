-- Follow-up reminders, Web Push subscriptions and shared team address books

-- "Ricontatta il…": one pending reminder per contact, cleared when done
ALTER TABLE contacts
  ADD COLUMN follow_up_on   date,
  ADD COLUMN follow_up_note text NOT NULL DEFAULT '';
CREATE INDEX contacts_follow_up_idx ON contacts (user_id, follow_up_on) WHERE follow_up_on IS NOT NULL;

-- Browser push endpoints (one per device). Only well-known push services are accepted by the API.
CREATE TABLE push_subscriptions (
  endpoint     text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  user_agent   text,
  last_sent_on date, -- the daily reminder goes out at most once a day
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- Teams: a shared address book (e.g. "Cosedil"). Contacts stay owned by whoever scanned
-- them; sharing exposes the business-card fields (never notes, tags or reminders) to members.
CREATE TABLE teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('admin', 'member')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user_idx ON team_members (user_id);

-- Invite links: random token, only its hash is stored
CREATE TABLE team_invites (
  token_hash  bytea PRIMARY KEY,
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  uses        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_invites_team_idx ON team_invites (team_id);

CREATE TABLE team_contacts (
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  shared_by   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, contact_id)
);
CREATE INDEX team_contacts_contact_idx ON team_contacts (contact_id);
CREATE INDEX team_contacts_team_shared_idx ON team_contacts (team_id, shared_at DESC);

-- Setting or clearing a reminder is not an edit of the card: keep updated_at (used as the
-- "modificato il" date and as the photo cache key) when nothing else changed.
CREATE OR REPLACE FUNCTION contacts_search_text() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'follow_up_on' - 'follow_up_note' - 'updated_at' - 'search_text')
       = (to_jsonb(OLD) - 'follow_up_on' - 'follow_up_note' - 'updated_at' - 'search_text') THEN
    NEW.updated_at := OLD.updated_at;
    RETURN NEW;
  END IF;
  NEW.search_text := f_norm(concat_ws(' ',
    NEW.prefix, NEW.first_name, NEW.last_name, NEW.company, NEW.job_title,
    array_to_string(NEW.emails, ' '),
    (SELECT string_agg(p->>'value', ' ') FROM jsonb_array_elements(NEW.phones) p),
    NEW.website, NEW.street, NEW.city, NEW.postal_code, NEW.province, NEW.country,
    array_to_string(NEW.tags, ' '), NEW.met_at, NEW.notes));
  NEW.updated_at := now();
  RETURN NEW;
END $$;
