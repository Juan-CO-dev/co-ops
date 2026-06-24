-- Migration 0085_units_adjust
-- Applied via Supabase MCP apply_migration on 2026-06-24.
-- Canonical reference: docs/superpowers/specs/2026-06-23-units-registry-design.md

-- Units adjustment (Juan smoke, 2026-06-24): 'Min' is a duration, not a par
-- measurement — deactivate it (append-only, never delete; drops from the
-- dropdown). Add '1/6 Pan' alongside '1/3 Pan'. No ACTIVE item uses 'Min'
-- (only 1 deactivated item + 2 vestigial line prep_meta values, which the
-- resolver doesn't read). New units are added from here as needed (MoO+).

update public.units set active = false, updated_at = now() where label = 'Min';

insert into public.units (label, display_order) values ('1/6 Pan', 2)
on conflict (label) do nothing;

-- Tidy active display order: 1/3 Pan, 1/6 Pan, Quart, Bottle, Piece, Bag, Logs, Bundle.
update public.units set display_order = 1 where label = '1/3 Pan';
update public.units set display_order = 2 where label = '1/6 Pan';
update public.units set display_order = 3 where label = 'Quart';
update public.units set display_order = 4 where label = 'Bottle';
update public.units set display_order = 5 where label = 'Piece';
update public.units set display_order = 6 where label = 'Bag';
update public.units set display_order = 7 where label = 'Logs';
update public.units set display_order = 8 where label = 'Bundle';
