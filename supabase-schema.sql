-- Supabase schema for inventory management system
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new)

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Each collection stored as JSONB documents for Firestore-like flexibility
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  document JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  document JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS distribution_trips (
  id TEXT PRIMARY KEY,
  document JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pallet_types (
  id TEXT PRIMARY KEY,
  document JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  document JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config (
  id TEXT PRIMARY KEY,
  document JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_logs (
  id TEXT PRIMARY KEY,
  document JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE distribution_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE pallet_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;

-- Allow public read/write for anon key (adjust for production)
CREATE POLICY "Allow all" ON records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON trips FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON distribution_trips FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON pallet_types FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON system_logs FOR ALL USING (true) WITH CHECK (true);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_records_document ON records USING GIN (document);
CREATE INDEX IF NOT EXISTS idx_trips_document ON trips USING GIN (document);
CREATE INDEX IF NOT EXISTS idx_distribution_trips_document ON distribution_trips USING GIN (document);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER records_updated_at BEFORE UPDATE ON records FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trips_updated_at BEFORE UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER distribution_trips_updated_at BEFORE UPDATE ON distribution_trips FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER pallet_types_updated_at BEFORE UPDATE ON pallet_types FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER config_updated_at BEFORE UPDATE ON config FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER system_logs_updated_at BEFORE UPDATE ON system_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enable real-time for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE records;
ALTER PUBLICATION supabase_realtime ADD TABLE trips;
ALTER PUBLICATION supabase_realtime ADD TABLE distribution_trips;
ALTER PUBLICATION supabase_realtime ADD TABLE pallet_types;
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE config;
ALTER PUBLICATION supabase_realtime ADD TABLE system_logs;
