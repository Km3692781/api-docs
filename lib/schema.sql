CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS api_docs.brands (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  logo_base64 TEXT,
  theme       JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_docs.services (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID NOT NULL REFERENCES api_docs.brands(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL,
  name              TEXT NOT NULL,
  openapi_spec      JSONB NOT NULL,
  source_collection JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id, slug)
);

CREATE TABLE IF NOT EXISTS api_docs.service_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES api_docs.services(id) ON DELETE CASCADE,
  openapi_spec  JSONB NOT NULL,
  diff_summary  JSONB NOT NULL DEFAULT '{}',
  is_initial    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS service_versions_service_created_idx
  ON api_docs.service_versions (service_id, created_at DESC);

CREATE OR REPLACE FUNCTION api_docs.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER services_updated_at
BEFORE UPDATE ON api_docs.services
FOR EACH ROW EXECUTE FUNCTION api_docs.update_updated_at();