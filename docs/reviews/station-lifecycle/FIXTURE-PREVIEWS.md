# Station lifecycle fixture previews

These screenshots are **offline fixture previews, not sim screenshots**. They render the actual `ShiftBoardClient` and `StationsAdmin` components with the actual compiled `app/globals.css`. Fictional people and stations are supplied directly; no database, app server, environment file, or production connection is used. Router and step-up hooks are mocked. Controls are static, and collapsible sections are expanded for inspection. The unavailable Next Google font uses the app's Segoe UI fallback.

| Preview | Scope |
| --- | --- |
| [English crew board, 360 px](board-crew-en-360.png) | Read-only team assignments plus the viewer's own break control; closed station, cover vacancy, clock-out vacancies |
| [Spanish crew board, 360 px](board-crew-es-360.png) | Same lifecycle state in Spanish |
| [English KH board, 1280 px](board-kh-en-1280.png) | Manager controls and lifecycle status |
| [Spanish KH timing, 360 px](timing-kh-es-360.png) | Timing-only station administration, translated names and duties, no first-position trim field |

Each PNG has a standalone HTML counterpart for inspection. `fixture-results.json` records the viewport and document width checks; each is equal, so none of these fixtures has horizontal page overflow.

Reproduce from the repository root using the installed Playwright Chromium:

```powershell
npx.cmd vitest run --config docs/reviews/station-lifecycle/fixture.vitest.config.ts
```

CC still needs sim screenshots and interaction checks after migration 0230 is applied to the sim. These fixture previews do not prove database transitions, auth gates, or live Toast behavior.
