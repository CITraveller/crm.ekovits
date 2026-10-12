CREATE TABLE IF NOT EXISTS company_settings (
  id TEXT PRIMARY KEY DEFAULT 'company',
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  contact TEXT,
  email TEXT,
  website TEXT,
  gstin TEXT,
  state TEXT NOT NULL DEFAULT 'Maharashtra',
  state_code TEXT NOT NULL DEFAULT '27',
  bank_name TEXT,
  account_no TEXT,
  ifsc TEXT,
  branch TEXT,
  signatory TEXT,
  invoice_prefix TEXT NOT NULL DEFAULT '',
  next_invoice_number BIGINT NOT NULL DEFAULT 202621,
  logo_path TEXT,
  stamp_path TEXT,
  signature_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_number_sequences (
  id TEXT PRIMARY KEY DEFAULT 'default',
  prefix TEXT NOT NULL DEFAULT '',
  next_number BIGINT NOT NULL DEFAULT 202621 CHECK (next_number > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Employee',
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  billing_address TEXT NOT NULL,
  shipping_address TEXT DEFAULT '',
  contact_person TEXT DEFAULT '',
  contact_number TEXT DEFAULT '',
  email TEXT DEFAULT '',
  gstin TEXT DEFAULT '',
  state TEXT NOT NULL DEFAULT 'Maharashtra',
  state_code TEXT NOT NULL DEFAULT '27',
  pan TEXT DEFAULT '',
  customer_type TEXT DEFAULT 'Business',
  legal_name TEXT DEFAULT '',
  designation TEXT DEFAULT '',
  alternate_phone TEXT DEFAULT '',
  country TEXT DEFAULT 'India',
  pin_code TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hsn_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  gst_rate NUMERIC(6,2) NOT NULL DEFAULT 18 CHECK (gst_rate >= 0),
  cgst_rate NUMERIC(6,2) NOT NULL DEFAULT 9 CHECK (cgst_rate >= 0),
  sgst_rate NUMERIC(6,2) NOT NULL DEFAULT 9 CHECK (sgst_rate >= 0),
  igst_rate NUMERIC(6,2) NOT NULL DEFAULT 18 CHECK (igst_rate >= 0),
  unit TEXT DEFAULT 'No.',
  notes TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  invoice_date DATE NOT NULL,
  due_date DATE,
  place_of_supply TEXT,
  reverse_charge TEXT NOT NULL DEFAULT 'No',
  gst_type TEXT NOT NULL CHECK (gst_type IN ('intra', 'inter')),
  gst_override BOOLEAN NOT NULL DEFAULT false,
  payment_terms TEXT DEFAULT '',
  reference_no TEXT DEFAULT '',
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  client_address TEXT NOT NULL,
  shipping_address TEXT DEFAULT '',
  contact_person TEXT DEFAULT '',
  client_contact TEXT DEFAULT '',
  client_email TEXT DEFAULT '',
  client_gstin TEXT DEFAULT '',
  client_state TEXT DEFAULT '',
  client_state_code TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  company_snapshot JSONB NOT NULL,
  taxable_cents BIGINT NOT NULL DEFAULT 0,
  cgst_cents BIGINT NOT NULL DEFAULT 0,
  sgst_cents BIGINT NOT NULL DEFAULT 0,
  igst_cents BIGINT NOT NULL DEFAULT 0,
  total_gst_cents BIGINT NOT NULL DEFAULT 0,
  round_off_cents BIGINT NOT NULL DEFAULT 0,
  grand_total_cents BIGINT NOT NULL DEFAULT 0,
  invoice_status TEXT NOT NULL CHECK (invoice_status IN ('Draft', 'Final', 'Cancelled')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('Unpaid', 'Partially Paid', 'Paid')) DEFAULT 'Unpaid',
  gst_paid BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'system' CHECK (source IN ('system', 'imported')),
  imported BOOLEAN NOT NULL DEFAULT false,
  imported_at TIMESTAMPTZ,
  imported_by TEXT REFERENCES employees(id) ON DELETE SET NULL,
  original_document_path TEXT DEFAULT '',
  original_document_name TEXT DEFAULT '',
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT REFERENCES employees(id) ON DELETE SET NULL,
  deleted_reason TEXT DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  cancellation_reason TEXT DEFAULT '',
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT REFERENCES employees(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT REFERENCES employees(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_account_type ON customers(customer_type);
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(active);

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

CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_search ON invoices(invoice_no, client_name, client_gstin, payment_status, invoice_status);
CREATE INDEX IF NOT EXISTS idx_invoices_source ON invoices(source, imported);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(invoice_status, payment_status);
CREATE INDEX IF NOT EXISTS idx_invoices_gst_paid ON invoices(gst_paid);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sr_no INTEGER NOT NULL CHECK (sr_no > 0),
  description TEXT NOT NULL,
  hsn TEXT NOT NULL,
  gst_rate NUMERIC(6,2) NOT NULL CHECK (gst_rate >= 0),
  qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  rate_cents BIGINT NOT NULL CHECK (rate_cents >= 0),
  taxable_cents BIGINT NOT NULL CHECK (taxable_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_hsn ON invoice_items(hsn);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  payment_date DATE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  payment_mode TEXT DEFAULT '',
  reference TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  invoice_no TEXT,
  description TEXT DEFAULT '',
  old_value JSONB,
  new_value JSONB,
  reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS quotation_number_sequences (
  id TEXT PRIMARY KEY DEFAULT 'default',
  prefix TEXT NOT NULL DEFAULT 'EKV-',
  next_number BIGINT NOT NULL DEFAULT 20261 CHECK (next_number > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotations (
  id TEXT PRIMARY KEY,
  quotation_no TEXT NOT NULL UNIQUE,
  quotation_date DATE NOT NULL,
  valid_until DATE,
  gst_type TEXT NOT NULL CHECK (gst_type IN ('intra', 'inter')),
  gst_override BOOLEAN NOT NULL DEFAULT false,
  reference_no TEXT DEFAULT '',
  subject TEXT DEFAULT '',
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  client_address TEXT NOT NULL,
  client_contact TEXT DEFAULT '',
  client_email TEXT DEFAULT '',
  client_gstin TEXT DEFAULT '',
  client_state TEXT DEFAULT '',
  client_state_code TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  terms TEXT DEFAULT '',
  company_snapshot JSONB NOT NULL,
  taxable_cents BIGINT NOT NULL DEFAULT 0,
  cgst_cents BIGINT NOT NULL DEFAULT 0,
  sgst_cents BIGINT NOT NULL DEFAULT 0,
  igst_cents BIGINT NOT NULL DEFAULT 0,
  total_gst_cents BIGINT NOT NULL DEFAULT 0,
  round_off_cents BIGINT NOT NULL DEFAULT 0,
  grand_total_cents BIGINT NOT NULL DEFAULT 0,
  quotation_status TEXT NOT NULL CHECK (quotation_status IN ('Draft', 'Sent', 'Accepted', 'Rejected', 'Expired', 'Cancelled')) DEFAULT 'Draft',
  revision INTEGER NOT NULL DEFAULT 0,
  cancellation_reason TEXT DEFAULT '',
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT REFERENCES employees(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT REFERENCES employees(id) ON DELETE SET NULL,
  deleted_reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT REFERENCES employees(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT REFERENCES employees(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_quotations_customer_id ON quotations(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotations_quotation_date ON quotations(quotation_date);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(quotation_status);
CREATE INDEX IF NOT EXISTS idx_quotations_search ON quotations(quotation_no, client_name, client_gstin, quotation_status);

CREATE TABLE IF NOT EXISTS quotation_items (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  sr_no INTEGER NOT NULL CHECK (sr_no > 0),
  description TEXT NOT NULL,
  hsn TEXT NOT NULL,
  gst_rate NUMERIC(6,2) NOT NULL CHECK (gst_rate >= 0),
  qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  rate_cents BIGINT NOT NULL CHECK (rate_cents >= 0),
  taxable_cents BIGINT NOT NULL CHECK (taxable_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation_id ON quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_hsn ON quotation_items(hsn);
