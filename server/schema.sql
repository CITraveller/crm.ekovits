CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL,
 password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('Admin','Sales Manager','Sales Executive','Viewer')),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(lower(email));
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS customers (id uuid PRIMARY KEY, data jsonb NOT NULL, assignee_id uuid REFERENCES users(id), version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS leads (id uuid PRIMARY KEY, data jsonb NOT NULL, assignee_id uuid REFERENCES users(id), customer_id uuid REFERENCES customers(id), version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS leads_email ON leads(lower(data->>'email')) WHERE data->>'email' <> '';
CREATE INDEX IF NOT EXISTS leads_stage ON leads((data->>'stage'));
CREATE TABLE IF NOT EXISTS deals (id uuid PRIMARY KEY, data jsonb NOT NULL, assignee_id uuid REFERENCES users(id), customer_id uuid NOT NULL REFERENCES customers(id), version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS activities (id uuid PRIMARY KEY, data jsonb NOT NULL, assignee_id uuid REFERENCES users(id), customer_id uuid REFERENCES customers(id), lead_id uuid REFERENCES leads(id), version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS events (id bigserial PRIMARY KEY, entity text NOT NULL, record_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('comment','history')), body text NOT NULL, author_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS events_record ON events(entity,record_id,created_at);
CREATE INDEX IF NOT EXISTS activities_lead ON activities(lead_id);
CREATE INDEX IF NOT EXISTS activities_customer ON activities(customer_id);
CREATE TABLE IF NOT EXISTS settings (id integer PRIMARY KEY CHECK(id=1), data jsonb NOT NULL);
INSERT INTO settings(id,data) VALUES(1,'{"company_name":"Orbit CRM","lead_stages":["New","Contacted","Converted"]}') ON CONFLICT DO NOTHING;


-- A durable latest-state outbox. Conversion and queue writes commit together.
CREATE TABLE IF NOT EXISTS portal_customer_sync (
 customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 1,
 sent_revision bigint NOT NULL DEFAULT 0,
 payload jsonb NOT NULL,
 portal_customer_id text,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text,
 synced_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_customer_sync_due ON portal_customer_sync(next_attempt_at) WHERE revision>sent_revision;
CREATE OR REPLACE FUNCTION enqueue_portal_customer(cid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE snapshot jsonb;
BEGIN
 -- Serialize enqueuers with customer edits, so a concurrent conversion cannot
 -- enqueue an old customer snapshot after a newer edit has committed.
 SELECT data INTO snapshot FROM customers WHERE id=cid FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 INSERT INTO portal_customer_sync(customer_id,payload) VALUES(cid,snapshot)
 ON CONFLICT(customer_id) DO UPDATE SET payload=EXCLUDED.payload,
 revision=portal_customer_sync.revision+1, attempts=0, next_attempt_at=now(),last_error=NULL,updated_at=now();
END $$;
CREATE OR REPLACE FUNCTION portal_customer_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM leads WHERE customer_id=NEW.id AND data->>'stage'='Converted') THEN
  PERFORM enqueue_portal_customer(NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION portal_lead_converted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.customer_id IS NOT NULL AND NEW.data->>'stage'='Converted' THEN
  IF TG_OP='INSERT' THEN
   PERFORM enqueue_portal_customer(NEW.customer_id);
  ELSIF OLD.customer_id IS DISTINCT FROM NEW.customer_id OR OLD.data->>'stage' IS DISTINCT FROM 'Converted' THEN
   PERFORM enqueue_portal_customer(NEW.customer_id);
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS portal_customer_changed ON customers;
CREATE TRIGGER portal_customer_changed AFTER UPDATE OF data ON customers FOR EACH ROW EXECUTE FUNCTION portal_customer_changed();
DROP TRIGGER IF EXISTS portal_lead_converted ON leads;
CREATE TRIGGER portal_lead_converted AFTER INSERT OR UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION portal_lead_converted();
-- Existing conversions are queued once; subsequent migrations do not resync them.
INSERT INTO portal_customer_sync(customer_id,payload)
SELECT c.id,c.data FROM customers c WHERE EXISTS(SELECT 1 FROM leads l WHERE l.customer_id=c.id AND l.data->>'stage'='Converted')
ON CONFLICT DO NOTHING;
