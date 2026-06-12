-- Migration 013: storage upload constraints (applied via Supabase MCP on 2026-06-12).
-- Server-side enforcement on the documents bucket: 20 MB cap and images/PDFs
-- only. Client checks are advisory; this holds even if someone calls the
-- storage API directly with their JWT.

update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array['image/*', 'application/pdf']
where id = 'documents';
