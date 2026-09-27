-- Drop the HexOps database and/or role after the checks passed. Run as a PostgreSQL
-- superuser, connected to "postgres", with -v db=... -v role=... -v drop_db=yes|no
-- -v drop_role=yes|no. PostgreSQL itself refuses to drop a database that anything is
-- connected to, or a role that still owns or may use objects anywhere.
\set ON_ERROR_STOP on
SELECT format('DROP DATABASE %I', :'db') WHERE :'drop_db' = 'yes' \gexec
SELECT format('DROP ROLE %I', :'role') WHERE :'drop_role' = 'yes' \gexec
