#!/usr/bin/env python3
"""
Review-escape log tool — v5.3 erratum.
Aggie-owned durable state for tracking post-commit defects that escaped CC review.

Usage:
  python scripts/escape-log.py log '<category>' '<commit_ref>' '<description>'
    — Append a new escape entry, reports category count. If count >= 2 → escalate.

  python scripts/escape-log.py query [category]
    — Query all escapes, optionally filtered by category.

  python scripts/escape-log.py categories
    — List available defect categories.
"""
import sys, os, json
from datetime import datetime

LOGFILE = os.path.expanduser("~/aggie-projects/dashboard/review-escape-log.json")


def load():
    with open(LOGFILE) as f:
        return json.load(f)


def save(data):
    with open(LOGFILE, "w") as f:
        json.dump(data, f, indent=2)


def cmd_log(category, commit_ref, description):
    data = load()
    valid = list(data["defect_categories"].keys())
    if category not in valid:
        print(f"ERROR: unknown category '{category}'. Valid: {', '.join(valid)}")
        sys.exit(1)

    entry = {
        "date": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "defect_category": category,
        "commit_ref": commit_ref,
        "description": description
    }
    data["escapes"].append(entry)
    save(data)

    count = sum(1 for e in data["escapes"] if e["defect_category"] == category)
    total = len(data["escapes"])
    print(json.dumps({
        "status": "logged",
        "category": category,
        "category_count": count,
        "total_escapes": total,
        "escalate": count >= 2
    }, indent=2))

    if count >= 2:
        print("\n*** TRIAD A ESCALATION: category '%s' now has %d escapes ***" % (category, count),
              file=sys.stderr)


def cmd_query(category=None):
    data = load()
    escapes = data["escapes"]
    if category:
        escapes = [e for e in escapes if e["defect_category"] == category]
    print(json.dumps(escapes, indent=2))


def cmd_categories():
    data = load()
    for cat, desc in data["defect_categories"].items():
        count = sum(1 for e in data["escapes"] if e["defect_category"] == cat)
        print(f"  {cat}: {count} ({desc})")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: escape-log.py <log|query|categories> [...]")
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "log":
        if len(sys.argv) < 5:
            print("Usage: escape-log.py log <category> <commit_ref> <description>")
            sys.exit(1)
        cmd_log(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "query":
        cmd_query(sys.argv[2] if len(sys.argv) > 2 else None)
    elif cmd == "categories":
        cmd_categories()
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
