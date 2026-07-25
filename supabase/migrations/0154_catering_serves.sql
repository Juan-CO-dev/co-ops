-- Migration 0154_catering_serves
-- STAGED in PR; prod apply deferred to Juan's go.
--
-- Juan 2026-07-25: "all catering items should have a headcount attached to
-- them, so the at-a-glance feature can appropriately calculate the head
-- counts." The coverage guide counted QUANTITY as people for anything
-- unsized — a Case of Chips (24) covered 1 person. serves = people covered
-- per ONE unit (sized items already carry item_sizes.serves).

alter table public.menu_items add column serves numeric;
alter table public.items add column serves numeric;
alter table public.catering_packages add column serves numeric;
