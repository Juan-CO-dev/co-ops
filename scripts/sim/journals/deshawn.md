# Deshawn's Sloppy Day — Shift Simulation

## GOAL 1: Log in ✓ DONE
- Selected P STREET location
- Selected Employee role
- Selected name (Deshawn Carter)
- Entered PIN 2222 via system keyboard
- Successfully logged in to dashboard

---

## GOAL 2: MID-DAY PREP at P Street ⚠ BLOCKED
**Status:** BLOCKED/NOT FOUND
- Could not locate "MID-DAY PREP" section on dashboard
- Checked "Today's operations": only saw "Closing checklist" (Not started)
- Checked "Reports": saw "Opening Report" (In progress)
- Tried "Maintenance" link: only showed fridge temps and equipment, not prep work
- Hypothesis: MID-DAY PREP unavailable at this time or goes by different name

---

## GOAL 3: Opening Checklist — Explored (Phase 1 & Phase 2)

### Sloppy Behavior #1: Try to submit without authority ✓
- Clicked "Finalize Phase 2" without filling data
- Result: Alert "Your role can't submit Opening — contact a manager"
- **App Handling:** GOOD — Enforces role-based access control correctly

### Sloppy Behavior #2: Wander to dashboard and come back ⚠ FAILED
- Pressed browser BACK while viewing opening checklist
- **CRITICAL SESSION BUG**: Session switched unexpectedly
  - Before: Deshawn Carter at P Street (EM)
  - After: Luis Herrera at Capitol Hill (MEP)
  - Interface switched to Spanish
  - User/location changed without logout
- **App Handling:** WORST — Silent session corruption, no warning

### Sloppy Behavior #3: Explored Phase 1 (Verification)
- Viewed 14 station sections (Crunchy Boi, 3rd Party, Walk Ins, Prep Fridge, etc.)
- All section buttons showed [disabled] and [pressed]
- Status: "44 of 44 verified · 8 of 8 temp readings entered · 36 of 36 prep entries"
- Submit button disabled with "Submit disabled" message
- **Finding:** Opening checklist form appears fully locked/read-only for employees

### Sloppy Behavior #4: Multiple BACK button presses
- Attempt 1: BACK mid-form → triggered session switch bug (see above)
- Attempt 2: Navigated to root URL → resulted in logout (intended)

### Unable to Complete:
- Could not find editable temperature input fields
- Could not find enabled form fields to fill halfway then abandon
- Could not double-tap submit buttons (all disabled)

---

## GOAL 4: Log out ✓ DONE
- Clicked "Cerrar sesión" (Log out) button (no effect)
- Navigated to root URL / which redirected to login screen
- Successfully logged out and returned to "Where are you?" location selection page

---

## BEST SAVE (what the app handled well):
1. **Permission enforcement**: Role-based access control properly blocked unauthorized form submission
2. **Alert messaging**: Clear error message explaining role restrictions
3. **Form state persistence**: Opening checklist maintained state across multiple page navigations (44 verified, 8 temps, 36 prep entries)

## WORST MISS (what went silently wrong):
1. **CRITICAL**: Browser BACK button caused session to switch to different user (Deshawn→Luis) at different location (P Street→Capitol Hill) with NO WARNING, NO LOGOUT, NO CONFIRMATION
   - This is a silent session management failure
   - Could cause serious confusion/errors if employee thought they were working on their location
   - No error message, no interstitial, no session validation

2. **MINOR**: Temperature reading fields mentioned in form ("8 of 8 entered") but not visible in UI snapshot - unclear where users enter these or if they're hidden

3. **MINOR**: No obviously editable fields in opening checklist form - form appears fully locked, unclear if by design or rendering issue

---

## SUSPECTED BUGS:
1. **CRITICAL**: Browser BACK switching active sessions unexpectedly (Deshawn/P-Street → Luis/Capitol-Hill with language change)
2. **MEDIUM**: Temperature input fields missing from UI despite form referencing them
3. **MINOR**: Logout button appears to require navigation to root URL rather than direct action
4. **MINOR**: Form appears fully locked/read-only for employee role - unclear if intentional

---

## SESSION TIMELINE:
- 16:01 - Logged in as Deshawn Carter at P Street ✓
- 16:02 - Navigated to Opening Report
- 16:02 - Tried to finalize Phase 2 (got permission error) ✓
- 16:04 - Pressed BACK → session switched to Luis at Capitol Hill (BUG)
- 16:05 - Navigated to root → logout successful ✓
