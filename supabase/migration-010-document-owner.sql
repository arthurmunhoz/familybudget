-- Migration 010: document owner (applied via Supabase MCP on 2026-06-12).
-- Documents get an explicit owner (who the document belongs to), separate
-- from added_by (who uploaded it). Existing docs: owner = uploader.

alter table documents add column if not exists owner_email text;
update documents set owner_email = added_by where owner_email is null;
alter table documents alter column owner_email set not null;
