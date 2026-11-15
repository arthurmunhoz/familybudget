-- Migration 112: hand-drawn notes (owner, 2026-11-15). A nudge can carry a
-- drawing: the phone turns into a sheet of paper, the member writes or draws
-- with a finger, and it goes to the family like any nudge (same recipients,
-- push, "seen by"). The picture is a PNG in the private documents bucket under
-- "<household>/notes/<uuid>.png"; the row points at it.
--
-- Older apps simply show the row's text ("drew you a note"), so nothing breaks.

alter table public.pings add column if not exists image_path text;

alter table public.pings drop constraint if exists pings_image_path_prefix;
alter table public.pings add constraint pings_image_path_prefix
  check (image_path is null or position((household_id::text || '/notes/') in image_path) = 1);

-- Modo Casa sessions may read notes too (avatars/backdrop/pets/frame + notes),
-- so a drawing can be shown on the home device later. Same restrictive policy
-- as migration 111, with 'notes' added.
drop policy if exists documents_storage_no_casa on storage.objects;
create policy documents_storage_no_casa on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'documents' or not (select public.is_casa_session())
         or (storage.foldername(name))[2] = any (array['avatars', 'backdrop', 'pets', 'frame', 'notes']))
  with check (bucket_id <> 'documents' or not (select public.is_casa_session())
         or (storage.foldername(name))[2] = any (array['avatars', 'backdrop', 'pets', 'frame', 'notes']));
