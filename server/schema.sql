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
