ALTER TABLE customers ADD COLUMN IF NOT EXISTS legal_name TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS designation TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS alternate_phone TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'India';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pin_code TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gst_paid BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_invoices_gst_paid ON invoices(gst_paid);

CREATE TABLE IF NOT EXISTS customer_contacts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  designation TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer_id ON customer_contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_account_type ON customers(customer_type);
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(active);
