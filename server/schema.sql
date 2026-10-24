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


-- All customer accounts participate; unconverted leads remain leads only.
CREATE TABLE IF NOT EXISTS portal_customer_sync (
 customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 1, sent_revision bigint NOT NULL DEFAULT 0,
 payload jsonb NOT NULL, portal_customer_id text, attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text,
 synced_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE portal_customer_sync ADD COLUMN IF NOT EXISTS modified_at timestamptz(3);
UPDATE portal_customer_sync q SET modified_at=date_trunc('milliseconds',c.updated_at) FROM customers c WHERE c.id=q.customer_id AND q.modified_at IS NULL;
ALTER TABLE portal_customer_sync ALTER COLUMN modified_at SET DEFAULT date_trunc('milliseconds',clock_timestamp());
ALTER TABLE portal_customer_sync ALTER COLUMN modified_at SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS portal_customer_sync_remote ON portal_customer_sync(portal_customer_id) WHERE portal_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS portal_customer_sync_due ON portal_customer_sync(next_attempt_at) WHERE revision>sent_revision;
CREATE TABLE IF NOT EXISTS portal_import_conflicts(portal_id text PRIMARY KEY, name text NOT NULL, reason text NOT NULL, seen_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS portal_sync_health(id integer PRIMARY KEY CHECK(id=1), last_pull_at timestamptz, last_error text);
INSERT INTO portal_sync_health(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION enqueue_portal_customer(cid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE snapshot jsonb;
BEGIN
 SELECT data INTO snapshot FROM customers WHERE id=cid FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 INSERT INTO portal_customer_sync(customer_id,payload,modified_at) VALUES(cid,snapshot,date_trunc('milliseconds',clock_timestamp()))
 ON CONFLICT(customer_id) DO UPDATE SET payload=EXCLUDED.payload,
 modified_at=GREATEST(EXCLUDED.modified_at,portal_customer_sync.modified_at+interval '1 millisecond'),
 revision=portal_customer_sync.revision+1,attempts=0,next_attempt_at=now(),last_error=NULL,updated_at=now();
END $$;
CREATE OR REPLACE FUNCTION portal_customer_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('crm.portal_inbound',true)='1' THEN RETURN NEW; END IF;
 PERFORM enqueue_portal_customer(NEW.id);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS portal_customer_changed ON customers;
CREATE TRIGGER portal_customer_changed AFTER INSERT OR UPDATE OF data ON customers FOR EACH ROW EXECUTE FUNCTION portal_customer_changed();
DROP TRIGGER IF EXISTS portal_lead_converted ON leads;
INSERT INTO portal_customer_sync(customer_id,payload,modified_at)
SELECT id,data,date_trunc('milliseconds',updated_at) FROM customers ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS deleted_crm_records (
 entity text NOT NULL CHECK(entity IN ('leads','customers')),record_id uuid NOT NULL,
 snapshot jsonb NOT NULL,portal_customer_id text,deleted_by uuid NOT NULL,
 deleted_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(entity,record_id)
);
CREATE INDEX IF NOT EXISTS deleted_crm_records_portal ON deleted_crm_records(portal_customer_id) WHERE entity='customers';
