#!/usr/bin/env python
import requests, json, os

SK = os.popen("grep SUPABASE_SERVICE_ROLE_KEY ~/co-ops/.env.local | cut -d= -f2").read().strip()
URL = "https://bgcvurheqzylyfehqgzh.supabase.co"
EM = "d2cced11-b167-49fa-bab6-86ec9bf4ff09"
HD = {"apikey": SK, "Authorization": f"Bearer ***, "Content-Type": "application/json"}

def get(path, params=None):
    r = requests.get(f"{URL}/rest/v1/{path}", headers=HD, params=params)
    r.raise_for_status()
    return r.json()

def post_rpc(name, body):
    r = requests.post(f"{URL}/rest/v1/rpc/{name}", headers={**HD, "Prefer": "params=single-object"}, json=body)
    print(f"RPC {name}: {r.status_code} - {r.text[:300]}")
    return r

# Actor
actor = get("users?select=id&email=eq.zz_test_kh1@co-ops.test")
actor_id = actor[0]["id"] if isinstance(actor, list) else actor["id"]
print(f"Actor: {actor_id}")

# AM template
am_tmpl = get(f"checklist_templates?select=id&type=eq.prep&prep_subtype=eq.am_prep&location_id=eq.{EM}&limit=1")
am_tmpl_id = am_tmpl[0]["id"] if isinstance(am_tmpl, list) else am_tmpl["id"]
print(f"AM template: {am_tmpl_id}")

# AM instance
inst = get(f"checklist_instances?select=id,status&template_id=eq.{am_tmpl_id}&business_date=eq.2026-06-14&status=eq.open&limit=1")
inst_id = inst[0]["id"] if isinstance(inst, list) else inst["id"]
print(f"Instance: {inst_id}")

# Items
items = get(f"checklist_template_items?select=id,label&template_id=eq.{am_tmpl_id}&order=position.asc")
print(f"Items: {len(items)}")

# Closing ref
ref = get(f"checklist_template_items?select=id&template_id=(select id from checklist_templates where type=eq.closing and location_id=eq.{EM} and active=eq.true limit 1)&label=ilike.*AM Prep*")
ref_id = ref[0]["id"] if isinstance(ref, list) else ref["id"]
print(f"Ref: {ref_id}")

# Submit
entries = [{"template_item_id": i["id"], "on_hand": 5, "back_up": 2, "total": 7, "notes": None} for i in items]
payload = {"p_prep_instance_id": inst_id, "p_actor_id": actor_id, "p_entries": entries, "p_closing_report_ref_item_id": ref_id}
r = post_rpc("submit_am_prep_atomic", payload)
print("DONE - AM Prep submitted")
