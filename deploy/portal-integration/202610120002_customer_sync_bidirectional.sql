ALTER TABLE customers ADD COLUMN IF NOT EXISTS sync_modified_at timestamptz(3);
UPDATE customers SET sync_modified_at=date_trunc('milliseconds',updated_at) WHERE sync_modified_at IS NULL;
ALTER TABLE customers ALTER COLUMN sync_modified_at SET DEFAULT date_trunc('milliseconds',clock_timestamp());
ALTER TABLE customers ALTER COLUMN sync_modified_at SET NOT NULL;
CREATE OR REPLACE FUNCTION stamp_customer_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('crm.sync_inbound',true)='1' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  NEW.sync_modified_at=date_trunc('milliseconds',clock_timestamp());
 ELSIF ROW(NEW.name,NEW.billing_address,NEW.contact_person,NEW.contact_number,NEW.email,NEW.gstin,NEW.designation,NEW.alternate_phone,NEW.notes,NEW.active)
   IS DISTINCT FROM ROW(OLD.name,OLD.billing_address,OLD.contact_person,OLD.contact_number,OLD.email,OLD.gstin,OLD.designation,OLD.alternate_phone,OLD.notes,OLD.active) THEN
  NEW.sync_modified_at=GREATEST(date_trunc('milliseconds',clock_timestamp()),OLD.sync_modified_at+interval '1 millisecond');
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stamp_customer_sync ON customers;
CREATE TRIGGER stamp_customer_sync BEFORE INSERT OR UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION stamp_customer_sync();
