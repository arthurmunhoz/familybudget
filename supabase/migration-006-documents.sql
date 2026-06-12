-- Migration 006: Document vault — metadata table + private storage bucket.
-- Applied via Supabase MCP on 2026-06-12.

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other'
    check (category in ('ids', 'insurance', 'medical', 'pets', 'home', 'receipts', 'other')),
  file_path text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  added_by text not null references allowed_users(email),
  created_at timestamptz not null default now()
);

alter table documents enable row level security;

drop policy if exists documents_rw on documents;
create policy documents_rw on documents
  for all using (public.is_allowed()) with check (public.is_allowed());

-- Private bucket; files are served via short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists documents_storage_rw on storage.objects;
create policy documents_storage_rw on storage.objects
  for all to authenticated
  using (bucket_id = 'documents' and public.is_allowed())
  with check (bucket_id = 'documents' and public.is_allowed());
