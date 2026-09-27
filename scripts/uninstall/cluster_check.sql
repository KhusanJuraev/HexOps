-- Read-only checks before HexOps drops its database and role (uninstall --purge).
-- Run as a PostgreSQL superuser, connected to the "postgres" database, with
-- psql -v db=<database> -v role=<role>. Prints key=value lines.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
SELECT 'db_exists=' || count(*) FROM pg_database WHERE datname = :'db';
SELECT 'role_exists=' || count(*) FROM pg_roles WHERE rolname = :'role';
SELECT 'db_owner=' || coalesce((SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = :'db'), '');
-- A dedicated HexOps role is a plain login role: no superuser or other powers.
SELECT 'role_privileged=' || count(*) FROM pg_roles WHERE rolname = :'role'
  AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls);
-- Anything the role owns or may use in another database means it is not dedicated.
SELECT 'other_dbs_owned=' || coalesce(string_agg(datname, ',' ORDER BY datname), '')
  FROM pg_database WHERE datdba = (SELECT oid FROM pg_roles WHERE rolname = :'role') AND datname <> :'db';
SELECT 'deps_elsewhere=' || coalesce(string_agg(DISTINCT d.datname, ','), '')
  FROM pg_shdepend s JOIN pg_database d ON d.oid = s.dbid
  WHERE s.refclassid = 'pg_authid'::regclass
    AND s.refobjid = (SELECT oid FROM pg_roles WHERE rolname = :'role') AND d.datname <> :'db';
SELECT 'memberships=' || count(*) FROM pg_auth_members
  WHERE roleid = (SELECT oid FROM pg_roles WHERE rolname = :'role')
     OR member = (SELECT oid FROM pg_roles WHERE rolname = :'role');
SELECT 'sessions_db=' || count(*) FROM pg_stat_activity WHERE datname = :'db' AND pid <> pg_backend_pid();
SELECT 'sessions_elsewhere=' || count(*) FROM pg_stat_activity
  WHERE usename = :'role' AND datname IS DISTINCT FROM :'db' AND pid <> pg_backend_pid();
