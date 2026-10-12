ALTER TABLE customers ADD COLUMN IF NOT EXISTS crm_customer_id uuid;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS crm_revision bigint NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS customers_crm_customer_id ON customers(crm_customer_id) WHERE crm_customer_id IS NOT NULL;
