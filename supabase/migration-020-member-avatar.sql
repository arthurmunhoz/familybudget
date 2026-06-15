-- Migration 020: member profile photo (applied via Supabase MCP on 2026-06-14).
-- Avatar lives in the private 'documents' bucket under <household_id>/avatars/,
-- served via short-lived signed URLs; the household can view, owner can change.

alter table member_profiles add column if not exists avatar_path text;
