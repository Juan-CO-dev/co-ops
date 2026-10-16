# BOH positions: "Prep" and "Prep/Dishwasher" at every shop (Scheduling Phase 1, R3)

The PM v2 criteria for the back of house hang on two station positions per shop, named exactly
**Prep** and **Prep/Dishwasher** (plan `docs/superpowers/plans/2026-10-15-scheduling-phase1-BUILD.md`,
Task 14b, R3). Skills key on the same rows.

**This is a human act through the existing station admin. It is never a migration and never a seed.**
The station admin already writes and audits positions (`station.position_create` /
`station.position_update`). Do it at each shop **before** PM v2 is switched on there, and before the
PM criteria seed runs for that shop.

## 1. Dry run (read-only)

```bash
npx tsx --env-file=.env.local scripts/check-boh-positions.ts
```

It prints, per active shop, whether each position exists exactly once and is active, which station holds
it, and its Spanish name. It never writes. Exit 0 means every active shop has both positions. Paste the
output into the PR.

States: `ok` (one active position with that exact name) · `missing` · `inactive` (only retired rows) ·
`duplicate` (more than one active row with the name: retire the extra one in the admin).

## 2. The data step (a MoO, or each shop's GM)

1. Open **`/admin/stations`** and pick the shop.
2. Open the station that holds prep work, then **Positions**.
3. Create the two positions, or rename existing ones, with these exact names:

   | Name (en) | Name (es) |
   |---|---|
   | `Prep` | `Prep` |
   | `Prep/Dishwasher` | `Prep/Lavaplatos` |

   Names are matched exactly (case, spaces and the slash). A position at another station of the same
   shop counts too; the report says which station holds it.
4. Repeat for the other shop.

Nothing else changes: no existing position is deleted (positions are retired, never removed), and no
code keys on these names.

## 3. Dry run again

Run the same command. Expect every shop `READY` and **exit 0**. Paste the second output into the PR.
