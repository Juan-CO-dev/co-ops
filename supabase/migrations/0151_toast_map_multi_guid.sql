-- Migration 0151_toast_map_multi_guid
-- STAGED in PR; prod apply deferred to Juan's go.
--
-- First-light finding A (2026-07-24, real Capitol Hill data): Toast represents
-- CHANNEL-PRICED VARIANTS as distinct menu items — the same food exists under
-- multiple guids (mainline $15.79 / Grubhub $16.50 / specials $12 "Hot Pants"),
-- 84 of 148 names at CH. One CO entity must therefore map to MANY Toast guids;
-- each guid still maps to exactly ONE entity (toast_map_uq_guid stays).

drop index if exists toast_map_uq_menu_item;
drop index if exists toast_map_uq_item;
