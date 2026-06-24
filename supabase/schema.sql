-- ════════════════════════════════════════════════════════════════════
--  SAZIN BILLING — Supabase (PostgreSQL) Schema
--  Run this in the Supabase SQL Editor (Project → SQL Editor → New query)
-- ════════════════════════════════════════════════════════════════════

-- ── Users ──
CREATE TABLE IF NOT EXISTS users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  permissions jsonb DEFAULT NULL,
  must_change_password boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ── Company Settings (single-row, stored as JSONB) ──
CREATE TABLE IF NOT EXISTS settings (
  id integer PRIMARY KEY DEFAULT 1,
  data jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO settings (id, data) VALUES (1, '{}') ON CONFLICT DO NOTHING;

-- ── Invoice / Document Number Counters ──
CREATE TABLE IF NOT EXISTS counters (
  name text PRIMARY KEY,
  fy_label text NOT NULL DEFAULT '',
  last_seq integer NOT NULL DEFAULT 0
);
INSERT INTO counters (name) VALUES
  ('invoice'), ('quote'), ('proforma'), ('credit_note'), ('debit_note')
ON CONFLICT DO NOTHING;

-- ── Documents (Tax Invoices, Proformas, Credit/Debit Notes) ──
CREATE TABLE IF NOT EXISTS documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number text UNIQUE NOT NULL,
  doc_type text NOT NULL DEFAULT 'invoice',
  date timestamptz NOT NULL DEFAULT now(),
  date_str text DEFAULT '',
  name text NOT NULL,
  mobile text NOT NULL,
  address text NOT NULL,
  ship_to text DEFAULT '',
  recipient_gstin text DEFAULT '',
  place_of_supply_state text DEFAULT '',
  place_of_supply_state_code text DEFAULT '',
  original_invoice text DEFAULT '',
  lines jsonb NOT NULL DEFAULT '[]',
  payment_status text DEFAULT 'unpaid',
  amount_paid numeric(12,2) DEFAULT 0,
  payments jsonb DEFAULT '[]',
  notes jsonb DEFAULT '[]',
  converted_from_quote text DEFAULT '',
  created_by text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_mobile ON documents(mobile);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_payment_status ON documents(payment_status);
CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(date);

-- ── Product Catalog (price list) ──
CREATE TABLE IF NOT EXISTS catalog (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  cost numeric(12,2) NOT NULL DEFAULT 0,
  hsn text DEFAULT '',
  unit text DEFAULT 'Sq.Ft',
  created_at timestamptz DEFAULT now()
);

-- ── Inventory ──
CREATE TABLE IF NOT EXISTS inventory (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  category text DEFAULT 'General',
  unit text DEFAULT 'Piece',
  cost_price numeric(12,2) DEFAULT 0,
  selling_price numeric(12,2) DEFAULT 0,
  stock_qty numeric(12,3) DEFAULT 0,
  hsn text DEFAULT '',
  low_stock_alert numeric(12,3) DEFAULT 5,
  created_at timestamptz DEFAULT now()
);

-- ── Purchases ──
CREATE TABLE IF NOT EXISTS purchases (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier text NOT NULL,
  supplier_bill_no text DEFAULT '',
  supplier_state text DEFAULT '',
  is_intra_state boolean DEFAULT true,
  items jsonb NOT NULL DEFAULT '[]',
  total_amount numeric(12,2) DEFAULT 0,
  total_taxable numeric(12,2) DEFAULT 0,
  total_cgst numeric(12,2) DEFAULT 0,
  total_sgst numeric(12,2) DEFAULT 0,
  total_igst numeric(12,2) DEFAULT 0,
  total_gst numeric(12,2) DEFAULT 0,
  payment_status text DEFAULT 'paid',
  amount_paid numeric(12,2) DEFAULT 0,
  payments jsonb DEFAULT '[]',
  notes text DEFAULT '',
  date timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date);

-- ── Expenses ──
CREATE TABLE IF NOT EXISTS expenses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category text DEFAULT 'Other',
  description text NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  notes text DEFAULT '',
  date timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

-- ── Quotations ──
CREATE TABLE IF NOT EXISTS quotes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_number text UNIQUE NOT NULL,
  date timestamptz DEFAULT now(),
  status text DEFAULT 'open',
  name text NOT NULL,
  mobile text NOT NULL,
  address text NOT NULL,
  recipient_gstin text DEFAULT '',
  place_of_supply_state text DEFAULT '',
  place_of_supply_state_code text DEFAULT '',
  lines jsonb DEFAULT '[]',
  converted_to_invoice text DEFAULT '',
  notes text DEFAULT ''
);

-- ── Invoice Templates ──
CREATE TABLE IF NOT EXISTS templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  lines jsonb DEFAULT '[]',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════
--  Atomic counter function — increments and returns next doc number.
--  Uses FOR UPDATE to prevent race conditions under concurrent saves.
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION next_doc_number(counter_name text, prefix text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  now_ts timestamptz := now();
  m integer;
  fy_start integer;
  new_fy text;
  curr_fy text;
  new_seq integer;
BEGIN
  m := EXTRACT(month FROM now_ts)::integer;
  fy_start := CASE WHEN m >= 4
    THEN EXTRACT(year FROM now_ts)::integer
    ELSE EXTRACT(year FROM now_ts)::integer - 1
  END;
  new_fy := LPAD((fy_start % 100)::text, 2, '0') || '-' || LPAD(((fy_start + 1) % 100)::text, 2, '0');

  SELECT fy_label INTO curr_fy FROM counters WHERE name = counter_name FOR UPDATE;

  IF curr_fy = new_fy THEN
    UPDATE counters SET last_seq = last_seq + 1 WHERE name = counter_name RETURNING last_seq INTO new_seq;
  ELSE
    new_seq := 1;
    UPDATE counters SET last_seq = 1, fy_label = new_fy WHERE name = counter_name;
  END IF;

  RETURN prefix || '/' || new_fy || '/' || LPAD(new_seq::text, 3, '0');
END;
$$;

-- ════════════════════════════════════════════════════════════════════
--  Seed default admin user (password: admin123 — change on first login)
--  bcrypt hash of "admin123" with cost 10:
-- ════════════════════════════════════════════════════════════════════
-- NOTE: Run this separately after setting up, replacing the hash with
-- a freshly generated one via: node -e "console.log(require('bcryptjs').hashSync('admin123',10))"
-- Example (hash will differ each run — this is expected):
INSERT INTO users (username, password_hash, role, must_change_password)
VALUES
  ('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'admin', true),
  ('staff', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'staff', true)
ON CONFLICT (username) DO NOTHING;
-- Default password for both accounts above is "admin123" — CHANGE IMMEDIATELY after first login.
-- The staff account password is also "admin123" until changed.
