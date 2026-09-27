-- Read-only: does this database hold only HexOps objects? Run as a PostgreSQL superuser,
-- connected to the HexOps database. Prints key=value lines.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
SELECT to_regclass('public.alembic_version') IS NOT NULL AS has_alembic \gset
\if :has_alembic
SELECT 'alembic=' || coalesce(max(version_num), '') FROM alembic_version;
\else
SELECT 'alembic=';
\endif
-- Tables, views and sequences-owning tables that HexOps did not create.
SELECT 'foreign_tables=' || coalesce(string_agg(n.nspname || '.' || c.relname, ',' ORDER BY n.nspname, c.relname), '')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'v', 'm', 'p', 'f')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
    AND NOT (n.nspname = 'public' AND c.relname IN (
      'activity_logs', 'alembic_version', 'note_tags', 'notes', 'pdf_jobs',
      'project_scope_items', 'projects', 'report_attachments', 'reports', 'tags',
      'transfer_jobs', 'user_sessions', 'users'));
SELECT 'tables=' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND n.nspname = 'public';
SELECT 'foreign_extensions=' || coalesce(string_agg(extname, ',' ORDER BY extname), '')
  FROM pg_extension WHERE extname NOT IN ('plpgsql', 'pg_trgm');
