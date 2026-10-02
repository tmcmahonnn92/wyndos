-- Staging gets its own database and login. Never copy real customer data into it.
CREATE ROLE wyndos_staging WITH LOGIN PASSWORD 'replace-with-a-different-strong-password';
CREATE DATABASE wyndos_staging OWNER wyndos_staging;
REVOKE ALL ON DATABASE wyndos_staging FROM PUBLIC;
