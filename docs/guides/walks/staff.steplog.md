# Staff walk — step log (Maya Torres, 2026-09-08)

## Step 01 — where-are-you
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Opened http://localhost:3100
- Saw: Heading "Compliments Only" / "Operations", a "Manager login →" button top right, and "Where are you?" with two location tiles: "MEP / Capitol Hill" and "EM / P Street"
- Shot: img/staff/01-where-are-you.png
- Confused:
- Bug?:

## Step 02 — whats-your-role
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Clicked the "EM / P Street" tile
- Saw: "What's your role?" with breadcrumb "EM · P Street" and eight role tiles: "GM / General Manager", "AGM / Assistant General Manager", "CTR / Catering Manager", "SL / Shift Lead", "KH / Key Holder", "TR / Trainer", "EMP / Employee", "TRN / Trainee"; a "← Back" button
- Shot: img/staff/02-whats-your-role.png
- Confused:
- Bug?:

## Step 03 — who-are-you
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Clicked the "EMP / Employee" tile
- Saw: "Who are you?" with breadcrumb "EM · P Street · Employee" and two user tiles: "DC Deshawn Carter" and "MT Maya Torres"; a "← Back" button
- Shot: img/staff/03-who-are-you.png
- Confused:
- Bug?:

## Step 04 — pin-keypad
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Clicked the "MT Maya Torres" tile
- Saw: "Employee" label, heading "Maya Torres", "Enter your 4-digit PIN", a PIN entry indicator reading "PIN entry: 0 of 4 digits entered", a numeric keypad 0-9 plus "Clear", and "← Back" / "Use system keyboard" links
- Shot: img/staff/04-pin-keypad.png
- Confused:
- Bug?:

## Step 05 — dashboard
- URL: /dashboard
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Pressed "1" four times on the PIN keypad — the fourth digit submitted automatically, no separate submit button
- Saw: Header "Compliments Only" / "Operations"; "Dashboard" label and heading "Hi, Maya Torres."; an "Explore" nav list (Reports Hub, Trends, Announcements, Tip Pool, AI Insights, Rollups, Deep Cleaning, Feedback, LTO, Written Reports, Catering, Training, Recipes, Comms, Profile, Settings, My Performance); a badge "Employee" and a "Notifications, 2 unread" bell; "EM · P Street"; "Today's operations at P Street" showing "Closing checklist — Not started" with a "Start closing" link; "Reports" showing "Opening Report — Not started today" with "Open / continue"; "Trends" showing "Under / Over Par 0", "Fridge Temp Flags 0", "Checklist Completion 87%"; a "Maintenance" link; a "Log out" button
- Shot: img/staff/05-dashboard.png
- Confused: The PIN keypad has no visible "submit" — it just fires on the 4th tap, easy to not notice it already logged in
- Bug?:

## Step 06 — dashboard-full
- URL: /dashboard
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: No action — full-page capture of the same dashboard, top to bottom
- Saw: Full stack top to bottom — header, "Hi, Maya Torres." greeting, the 17-item "Explore" nav (Reports Hub, Trends, Announcements, Tip Pool, AI Insights, Rollups, Deep Cleaning, Feedback, LTO, Written Reports, Catering, Training, Recipes, Comms, Profile, Settings, My Performance), "Today's operations at P Street" (closing checklist card), "Reports" (Opening Report card), "Trends" (three stat tiles), "Maintenance" link, "Log out" button at the very bottom
- Shot: img/staff/06-dashboard-full.png
- Confused: As an employee I would only actually tap: Feedback, My Performance, Profile, Settings, Deep Cleaning, Training, Recipes, Comms, Announcements, Tip Pool, and the checklist links under "Today's operations" — Reports Hub, Trends, Rollups, AI Insights, Written Reports, Catering, and LTO read like manager tools mixed into the same list with no visual separation
- Bug?:

## Step 07 — team-profiles
- URL: /profile
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Profile" in the Explore nav
- Saw: Heading "Team Profiles" / "Teammates at your location", a list of six teammate rows: "Deshawn Carter EMP", "Marcus Webb GM", "Maya Torres You EMP", "Priya Shah AGM", "Rosa Delgado KH", "Tommy Nguyen SL"
- Shot: img/staff/07-team-profiles.png
- Confused: "Profile" in the nav did not open MY profile/settings directly — it opened a team directory first, and I had to tap my own row to see anything about me
- Bug?:

## Step 08 — my-profile
- URL: /profile/42867291-4068-465b-a573-795bbfe3e3c9
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped my own row, "Maya Torres You EMP"
- Saw: "Maya Torres EMP You", "EM · 27 days on the team"; stat tiles "0 MVP wins", "1 longest streak", "10 tasks all-time"; "current streak 0" / "personal best / day 10"; a "Task velocity — recent" chart with caption "Days active over the last 30 days."; "Manager ratings — mostly Great 🌟" with "No ratings yet."; footnotes "Early-clock-in streaks unlock when Toast connects." and "Profiles show positive highlights only — never scores, notes, or areas to improve."
- Shot: img/staff/08-my-profile.png
- Confused: No language switch or account settings live here — this page is stats/highlights only, not what I'd call "my profile" for settings purposes
- Bug?:

## Step 09 — settings-language
- URL: /settings
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Navigated to Settings from the dashboard's Explore nav (the language control is NOT on the profile page — it lives here)
- Saw: Heading "Settings" / "Your app preferences."; a "Language" section reading "The language used across the app." with two radio options "English" (selected) and "Español"; a "Profile" section reading "View your team and update your profile blurb." with a "Go to Profile" link; a "More settings" section reading "Notification preferences are coming in a follow-up."
- Shot: img/staff/09-settings-language.png
- Confused: Did not switch the language, per instructions — just confirmed English is selected
- Bug?:

## Step 10 — opening-list
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Navigated to the "Open / continue" link under the dashboard's "Reports" card (labeled "Opening Report", not "Opening checklist")
- Saw: "Opening Report" / heading "Phase 1 — Verification" with instructions "Verify last night's closing matches reality. Tap each station once you've checked it; add a comment if anything looks off."; a "Phase 1 · Verify" toggle and a disabled "Phase 2 (locked)" button labeled "Phase 2 locked — complete verification first"; a long list of station sections (Crunchy Boi Station, 3rd Party Station, Walk Ins Station, Prep Fridge, Prep Area, Back Line Open, Expo Station, Front of House Open, Manager Open, Walk-Out Verification), each with its own "Mark [Station] as verified" button and a bulleted list of checks, several of which are temperature fields (placeholder "—", target "≤41°F"); below those, five more sections (Veg, Cooks, Sides, Sauces, Slicing) each with a disabled "Verify section" button and the note "Recount items without closer data first" and per-item "Opener recount" number fields; a footer reading "0 of 44 verified · 0 of 8 temp readings entered · 0 of 36 prep entries" / "44 items not yet verified" and a disabled "Submit Opening" button
- Shot: img/staff/10-opening-list.png
- Confused: The dashboard calls this "Opening Report" (under "Reports"), not "checklist" — took a second to realize this is the opening checklist the walk meant. Also, clicking directly on an item's description text does nothing — the only way to mark an item is the whole-station "Verified" toggle
- Bug?:

## Step 11 — opening-temp-filled
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Typed "38" into the "Crunchy Boi Fridge temp (≤41°F)" field
- Saw: The temperature textbox now shows "38"; footer counter not yet re-checked at this point
- Shot: img/staff/11-opening-temp-filled.png
- Confused:
- Bug?:

## Step 12 — opening-station-verified
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Mark Walk Ins Station as verified" (the whole-station yes/no toggle)
- Saw: All four bullets under "Walk Ins Station" flipped from "·" to a checkmark, and the button label changed to "Untick Walk Ins Station" / "Verified" with a checkmark icon
- Shot: img/staff/12-opening-station-verified.png
- Confused: There is no per-line yes/no — verifying is one tap per whole station, which marks every line under it at once
- Bug?:

## Step 13 — opening-comment-open
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Add comment" on the "3rd party tablets on, charged, signed in" line (under 3rd Party Station, left unverified — the "not-done" item)
- Saw: A "Comment" field appeared with placeholder "Note any discrepancy", plus a disabled button "Photo upload coming soon"
- Shot: img/staff/13-opening-comment-open.png
- Confused:
- Bug?:

## Step 14 — opening-comment-filled
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Typed "One tablet was dead overnight, plugged it in to charge before opening." into the comment field
- Saw: The reason text now sits in the comment box under the "3rd party tablets on, charged, signed in" line; that station's "Verified" toggle was NOT tapped, so the item stays unverified with the reason attached
- Shot: img/staff/14-opening-comment-filled.png
- Confused:
- Bug?:

## Step 15 — opening-list-after
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Scrolled to the bottom of the page (no further input)
- Saw: The footer counter updated to "4 of 44 verified · 1 of 8 temp readings entered · 0 of 36 prep entries" / "40 items not yet verified"; "Submit Opening" still disabled
- Shot: img/staff/15-opening-list-after.png
- Confused: "Submit Opening" stays disabled well before all 44 items are done — no visible threshold for when it would enable, so it's unclear how much is actually required before submitting is possible
- Bug?:

## Step 16 — am-prep-blocked
- URL: /operations/am-prep
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tried three ways in: (1) looked for an AM Prep entry point on the dashboard's "Today's operations" and "Reports" cards — none exists there, (2) tapped the "AM Prep List" link inside the Closing checklist's "Closing Manager" section (labeled "Pending — submit from the dashboard"), (3) typed the URL directly, with and without `?location=`
- Saw: All three attempts silently redirected to /dashboard — no error message, no toast, no explanation
- Confused: BLOCKED AM PREP: /operations/am-prep bounces to /dashboard every time for Maya Torres (Employee), even when reached via the closing checklist's own link to it. Could not tell whether AM Prep needs a different role, a different time-of-day/shift phase in the sim, or is simply a dead link right now.
- Bug?: The closing checklist advertises "AM Prep List — tap to submit from the AM Prep page" as a live link, but following it does not work for this persona

## Step 17 — midday-empty
- URL: /operations/mid-day?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Navigated to /operations/mid-day (this route does NOT redirect, unlike AM Prep)
- Saw: Heading "Mid-day Prep" / "Mid-day Prep" / "No mid-day prep template for this location yet."
- Shot: img/staff/16-midday-empty.png
- Confused: BLOCKED MID-DAY PREP: the page itself loads fine, but P Street has no mid-day prep template configured in this sim, so there is nothing to fill in for phase 1 — could not enter amounts for any items
- Bug?:

## Step 18 — closing-list
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Opened the closing checklist ("Continue closing" from the dashboard)
- Saw: Heading "EM · P Street" / "Closing checklist"; a "Progress" bar reading "0/61" ("0 of 61 required items complete"); ten expandable station sections (Crunchy Boi Station, 3rd Party Station, Walk Ins Station, Prep Fridge, Shut Down Back Line, Expo Station, Clean front of house, Prep Area, Closing Manager, Walk-Out Verification), each item its own tap-to-complete row; a footer note "AM Prep had 0 items saved today - check with the opener."
- Shot: img/staff/17-closing-list.png
- Confused: This is a completely different interaction model from the Opening Report — here EVERY line is its own tap target (not a whole-station toggle)
- Bug?:

## Step 19 — closing-item-ticked
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Restock" under Crunchy Boi Station
- Saw: The row now reads "Restock — completed by you at 2:49 AM" with a small "Undo" button, an attribution line "you · 2:49 AM", and a new "Add note" button; the station header updated to "1 of 6 required done"
- Shot: img/staff/18-closing-item-ticked.png
- Confused: "Add note" only appears AFTER an item is marked complete — there's no way to attach a note to a still-open item the way the Opening Report lets you comment on an unverified one
- Bug?:

## Step 20 — closing-two-ticked
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Wipe inside & outside" under Crunchy Boi Station (second item ticked)
- Saw: Both "Restock" and "Wipe inside & outside" now show "completed by you at 2:49 AM" with "Undo" and "Add note"; station header "2 of 6 required done"
- Shot: img/staff/19-closing-two-ticked.png
- Confused:
- Bug?:

## Step 21 — closing-note-open
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Wipe tops of sauce bottles" to complete it (third item), then tapped its "Add note" button
- Saw: A note field opened labeled "Edit note" with a textbox placeholder "Anything noteworthy?" and two buttons, "Save note" and "Cancel"
- Shot: img/staff/20-closing-note-open.png
- Confused:
- Bug?:

## Step 22 — closing-note-saved
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Typed "Ran out of clean rags halfway through — used paper towels to finish, someone should restock the rag bin." and tapped "Save note"
- Saw: The note now displays inline under the "you · 2:50 AM" attribution, and the button changed to "Edit note"
- Shot: img/staff/21-closing-note-saved.png
- Confused:
- Bug?:

## Step 23 — deep-cleaning-stub
- URL: /deep-cleaning?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Deep Cleaning" in the Explore nav
- Saw: Heading "Deep Cleaning Rotation" / "Coming in Module #15 (Deep Cleaning)" / "Frequency-based assignments with verification photos." with a bullet list of planned features: "Tasks with frequency_days and estimated_minutes", "Auto-schedule per location based on last completion", "Verification photo on completion", "Overdue tasks surface as handoff flags"
- Shot: img/staff/22-deep-cleaning-stub.png
- Confused: This is a stub — nothing to actually mark a task done on yet, despite being linked from the main nav as if it were live
- Bug?:

## Step 24 — maintenance-list
- URL: /maintenance?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Maintenance" link from the dashboard
- Saw: Heading "Maintenance Log"; a "Fridge temps" section listing all eight fridges (Walk-In, 3-Door, Sauce, Deli Display, Crunchy Boi, FOH Drinks, Back-Line Drinks, 3rd-Party), each tagged "No reading today"; an "Equipment" section listing "Oven" and "Fryer", each tagged "No issues logged"; below that, a form "Log a maintenance note" with an "Equipment" dropdown (defaulted to "Walk-In Fridge", with options for every fridge plus Oven, Fryer, and "Other…"), a "What's going on?" textbox, and a disabled "Save note" button
- Shot: img/staff/23-maintenance-list.png
- Confused: There is no "Slicer" in the Equipment dropdown — had to use "Other…" to log the slicer issue
- Bug?:

## Step 25 — maintenance-form-other
- URL: /maintenance?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Selected "Other…" in the Equipment dropdown
- Saw: A new "Equipment name" text field appeared above "What's going on?"
- Shot: img/staff/24-maintenance-form-other.png
- Confused:
- Bug?:

## Step 26 — maintenance-form-filled
- URL: /maintenance?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Typed "Slicer" into "Equipment name" and "Slicer guard loose — wobbles when engaged, needs a bolt tightened before next use." into "What's going on?"
- Saw: Both fields hold the typed text; "Save note" is no longer disabled
- Shot: img/staff/25-maintenance-form-filled.png
- Confused:
- Bug?:

## Step 27 — maintenance-after-save
- URL: /maintenance?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Save note"
- Saw: The "What's going on?" field cleared and "Save note" went back to disabled; "Equipment name" still showed "Slicer"; no visible confirmation toast or message, and the Slicer note doesn't appear anywhere in the "Fridge temps" or "Equipment" lists above (since Slicer isn't one of the named equipment tiles)
- Shot: img/staff/26-maintenance-after-save.png
- Confused: No confirmation that the note actually saved — the only signal is the form clearing itself. Since "Slicer" was logged via "Other…", there's no tile anywhere on this page to go check that it registered
- Bug?:

## Step 28 — feedback-stub
- URL: /feedback?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Feedback" in the Explore nav
- Saw: Heading "Customer Feedback" / "Coming in Module #16 (Customer Feedback)" / "1–5 ratings with optional comments and follow-up assignment." with planned-feature bullets: "Star rating + category + free-text comment", "Follow-up flag with assigned-to user", "Tracks response loop close-out", "Surfaces in handoff for negative ratings"
- Shot: img/staff/27-feedback-stub.png
- Confused: BLOCKED SUBMIT ONE LINE ON /feedback: this page is CUSTOMER feedback (a stub, no form at all), not a place for a staff member to submit a line of their own — nothing here to fill in or submit
- Bug?:

## Step 29 — my-performance
- URL: /my-feedback
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "My Performance" in the Explore nav
- Saw: Heading "My Performance"; a Day/Week/Month grouping toggle and a "Compare to previous" link; "Steady work this period. Every shift counts." with a big "14" labeled "your score · counts the work your role is here to do"; "1-day streak" / "best day: 10"; charts "Your contribution — tasks completed" and "On-time completion" (caption "Task-window timeliness (not clock-in)"); a heading "How managers have rated you" (empty); a "Streaks" panel showing "1 active days", "0 on-time in a row", "10 personal best", "0 MVP wins" with footnote "Early-clock-in streaks unlock when Toast connects."; "Feedback from shifts" section reading "No activity recorded for this location yet."
- Shot: img/staff/28-my-performance.png
- Confused: This page (My Performance / /my-feedback) appears to BE the profile performance view the walk also asked about — it shows the same kind of stats (streaks, tasks, MVP wins) as my own /profile/[id] page from Step 08, just with more detail and a time-range picker. Did not find a separate, different "performance view" inside the profile page itself
- Bug?:

## Step 30 — tips-stub
- URL: /tips?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Tip Pool" in the Explore nav
- Saw: Heading "Tip Pool" / "Coming in Module #11 (Tip Pool)" / "Period-based tip pool calculation and distribution log." with bullets: "Hours from 7shifts adapter (when activated) or manual entry", "Rate-per-hour computed from pool ÷ total hours", "Per-employee distribution rows", "Status: draft / calculated / distributed"
- Shot: img/staff/29-tips-stub.png
- Confused:
- Bug?:

## Step 31 — training-stub
- URL: /training
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Training" in the Explore nav
- Saw: Heading "Training" / "Coming in Module #14 (Training)" / "Position-based training matrix with module sign-offs and trainee progress." with bullets: "Positions and module assignments", "Status: not_started / in_progress / completed / signed_off", "Sign-off requires GM+ attestation", "Trainer reports + observational reports from non-trainers"
- Shot: img/staff/30-training-stub.png
- Confused:
- Bug?:

## Step 32 — announcements-stub
- URL: /announcements?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Announcements" in the Explore nav
- Saw: Heading "Announcements" / "Coming in Module #3 (Announcements)" / "Top-down directives with acknowledgement tracking. AGM+ can post." with bullets: "Priority: info / standard / urgent / critical", "Per-recipient acknowledgement tracking", "Role-band targeting — min and optional max level", "Location-scoped or org-wide", "Banner on dashboard until acknowledged"
- Shot: img/staff/31-announcements-stub.png
- Confused:
- Bug?:

## Step 33 — comms-stub
- URL: /comms
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Comms" in the Explore nav
- Saw: Heading "Internal Comms" / "Coming in Module #8 (Internal Comms)" / "Threaded discussion attached to artifacts and announcements." with bullets: "Thread per artifact or announcement", "@-mentions trigger notifications", "Read receipts", "Attach photos via report_photos"
- Shot: img/staff/32-comms-stub.png
- Confused:
- Bug?:

## Step 34 — logged-out
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Log out" on the dashboard
- Saw: Back at the tile login's "Where are you?" screen with the two location tiles ("MEP / Capitol Hill", "EM / P Street") and the "Manager login →" button — same as Step 01
- Shot: img/staff/33-logged-out.png
- Confused:
- Bug?:

## Notes and comment fields encountered (Goal 11 roundup)
- Opening Report (/operations/opening), per verification item: "Add comment" button reveals a "Comment" textbox with placeholder "Note any discrepancy", plus a disabled "Photo upload coming soon" button. Available on EVERY line item, whether or not the item (or its station) is verified — this is how you flag something wrong on an item you are NOT marking done.
- Closing checklist (/operations/closing), per checklist item: "Add note" button appears ONLY after an item is marked complete; it opens a region labeled "Edit note" with a textbox placeholder "Anything noteworthy?" and "Save note" / "Cancel" buttons. There is no way to attach a note to a still-incomplete item here — notes are for flagging something about a task you DID finish, not for explaining one you skipped.
- Maintenance Log (/maintenance): the "Log a maintenance note" form's second field is a plain textbox labeled "What's going on?" with NO placeholder text inside it (empty until typed). Selecting "Other…" in the Equipment dropdown reveals a preceding "Equipment name" textbox, also with no placeholder.
- Net takeaway for the writer: two different note vocabularies exist side by side — "comment" on the Opening Report (attached to any item, done or not) versus "note" on the Closing checklist (attached only to completed items) versus a free-standing "What's going on?" field on Maintenance (not attached to a checklist item at all, its own log).
