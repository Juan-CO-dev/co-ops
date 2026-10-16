-- Migration 0266_drop_recipe_input_16arg
-- AUTHORED 2026-10-16; FILE ONLY. Apply only after deployment READY and older deployments drain; CC/Juan gate.
-- Compatibility cleanup only: 0262's actor-aware 17-argument overload remains.
drop function public.update_recipe_input_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text,text,boolean,uuid,uuid,uuid,numeric,text,text,boolean);
