CREATE ROLE app_user WITH LOGIN PASSWORD 'replace-with-strong-password';
CREATE DATABASE window_cleaning_app OWNER app_user;
REVOKE ALL ON DATABASE window_cleaning_app FROM PUBLIC;
GRANT ALL PRIVILEGES ON DATABASE window_cleaning_app TO app_user;
