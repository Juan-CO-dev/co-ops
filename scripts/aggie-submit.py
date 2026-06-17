import json, os, urllib.request as U

SK = os.environ["SK"]
URL = "https://bgcvurheqzylyfehqgzh.supabase.co"
EM = "d2cced11-b167-49fa-bab6-86ec9bf4ff09"

def auth(req):
    req.add_header("apikey", SK)
    req.add_header("Authorization", "Bearer " + SK)
    return req

def get(path):
    req = U.Request(f"{URL}/rest/v1/{path}")
    auth(req)
    req.add_header("Accept", "application/json")
    return json.loads(U.urlopen(req).read())

def post_rpc(name, body):
    data = json.dumps(body).encode()
    req = U.Request(f"{URL}/rest/v1/rpc/{name}", data=data, method="POST")
    auth(req)
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "params=single-object")
    return json.loads(U.urlopen(req).read())

actor = get("users?select=id&email=eq.zz_test_kh1@co-ops.test")
actor_id = actor[0]["id"]
print(f"Actor: {actor_id}")

tmpl = get(f"checklist_templates?select=id&type=eq.prep&prep_subtype=eq.am_prep&location_id=eq.{EM}&limit=1")
tmpl_id = tmpl[0]["id"]
print(f"Template: {tmpl_id}")

inst = get(f"checklist_instances?select=id&template_id=eq.{tmpl_id}&business_date=eq.2026-06-14&status=eq.open&limit=1")
inst_id = inst[0]["id"]
print(f"Instance: {inst_id}")

items = get(f"checklist_template_items?select=id&template_id=eq.{tmpl_id}&order=position.asc")
print(f"Items: {len(items)}")

ref = get(f"checklist_template_items?select=id&template_id=(select id from checklist_templates where type=eq.closing and location_id=eq.{EM} and active=eq.true limit 1)&label=ilike.*AM Prep*")
ref_id = ref[0]["id"]
print(f"Ref: {ref_id}")

entries = [{"template_item_id": i["id"], "on_hand": 5, "back_up": 2, "total": 7, "notes": None} for i in items]
payload = {"p_prep_instance_id": inst_id, "p_actor_id": actor_id, "p_entries": entries, "p_closing_report_ref_item_id": ref_id}
result = post_rpc("submit_am_prep_atomic", payload)
print(f"SUBMITTED: {json.dumps(result)[:300]}")
