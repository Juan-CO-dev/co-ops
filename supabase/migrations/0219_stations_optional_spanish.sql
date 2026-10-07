-- AUTHORED ONLY 2026-10-07. NOT APPLIED. CC sim first, then Juan's production gate.
-- A closing section without an es.station translation has no Spanish station name.
alter table public.stations alter column name_es drop not null;
-- The sync may run from concurrent admin page loads; one name per shop is the
-- stable key that lets repeated runs reuse assignment-referenced station IDs.
create unique index stations_location_name on public.stations(location_id, name);
