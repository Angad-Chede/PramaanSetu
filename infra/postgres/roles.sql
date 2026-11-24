-- Database roles and grants for PramaanSetu (PRD 11.4).
--
-- The property this file exists for: the application role can insert into and read the
-- audit log, and nothing else. It cannot update or delete a single row. An application
-- bug, or an attacker who reaches the application, therefore cannot rewrite history; the
-- worst they can do is append, and an appended row breaks the hash chain on the next
-- verification.
--
-- Run automatically by the Docker Compose PostgreSQL service on first start. In a
-- deployment this belongs in the database provisioning step, before the first migration.

-- The role the application connects as. Owns no tables.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pramaansetu_app') THEN
    CREATE ROLE pramaansetu_app LOGIN PASSWORD 'change-me-in-every-deployed-environment';
  END IF;
END
$$;

-- The migration role. Owns the schema and is used only by Alembic.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pramaansetu_migrate') THEN
    CREATE ROLE pramaansetu_migrate LOGIN PASSWORD 'change-me-in-every-deployed-environment';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE pramaansetu TO pramaansetu_app, pramaansetu_migrate;
GRANT USAGE ON SCHEMA public TO pramaansetu_app, pramaansetu_migrate;
GRANT CREATE ON SCHEMA public TO pramaansetu_migrate;

-- Apply after the first migration has created the tables.
--
--   psql -d pramaansetu -f infra/postgres/roles.sql
--
-- Everything except the audit log: the application reads and writes normally.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> 'audit_log'
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO pramaansetu_app', t.tablename
    );
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_log') THEN
    -- Append-only. No UPDATE. No DELETE. No exceptions.
    EXECUTE 'REVOKE ALL ON public.audit_log FROM pramaansetu_app';
    EXECUTE 'GRANT SELECT, INSERT ON public.audit_log TO pramaansetu_app';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.audit_log_seq_seq TO pramaansetu_app';
  END IF;
END
$$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pramaansetu_app;

ALTER DEFAULT PRIVILEGES FOR ROLE pramaansetu_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pramaansetu_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pramaansetu_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO pramaansetu_app;

-- The extension the matching engine uses in a PostgreSQL deployment. The embedding
-- vectors are stored as JSON when it is absent, so the platform runs either way.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
