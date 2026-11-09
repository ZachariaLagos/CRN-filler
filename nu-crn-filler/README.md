# NU CRN Filler

A Chrome extension that registers you for classes on Northeastern University's
Banner registration page the moment your registration window opens. It clicks
Continue for you, searches for your sections, picks the ones that are still
open (falling back to backups), submits only a complete set, and recovers if
Banner stalls or crashes.

> **Not affiliated with Northeastern University.** This is a personal project.
> Review Northeastern's policies on appropriate use of computing resources
> before using it, and use it at your own risk.

## Why

Popular sections fill up within seconds of registration opening. Clicking
Continue, searching, finding the right sections, adding them, and submitting by
hand takes long enough to lose a seat. This extension does those steps in
seconds, then handles what happens when a section is full or Banner falls over
under load.

## Features

- **Auto-Continue.** At your registration time it clicks **Continue** on the
  "Select a Term" page. If Banner says your time ticket isn't open yet (your
  clock is a second early), it closes the message and tries again, up to 3 times.
- **Enter CRNs first when possible.** Banner's registration page has tabs: Find
  Classes | Enter CRNs | Plans | Schedule and Options. If the **Enter CRNs** tab is
  there, it types your **first main CRN**, clicks **Add to Summary**, and submits it
  alone, so your most important course is secured first. Then it tries your
  saved plan, and fills any remaining spots by search.
- **Register from your plan.** Next, if there's a **Plans** tab with a saved plan,
  it opens it, clicks **Add All** on Plan 1, and submits. Courses that register
  count toward your target. Skipped if there's no Plans tab or no plan.
- **Advanced Search by Subject, College and Campus.** Without an Enter CRNs tab
  (and for the remaining CRNs), it picks your filters, for example Computer Science,
  Khoury Coll of Comp Science and Silicon Valley, and sets 50 results per page.
- **Find sections by CRN.** It pages through every result page and locates each
  of your CRNs before clicking anything.
- **Main and backup CRNs, in order.** Your number of main CRNs is the target
  (for example, 2). It takes the first 2 available in order: main 1, main 2,
  backup 1, backup 2.
- **Missing or full sections are skipped right away.** A CRN that isn't in the
  results, has no Add button, or shows as full (for example, "FULL: 0 of 30
  seats remain") is dropped and the next candidate moves up.
- **Submits only a complete set.** It clicks **Add** / **Add Course** for exactly
  the number you need and clicks **Submit** only when all of them are selected.
  If fewer are available, it adds what it found, doesn't submit, and alerts you.
- **Stops when you're done.** As soon as the target number is registered, it stops.
- **Smart retries.** A section rejected as full or closed after Submit is dropped
  immediately for the next backup. Other rejections are retried up to 3 times,
  5 seconds apart, before a backup takes over.
- **Crash recovery.** Progress is saved after every step. If Banner shows an error
  page, logs you out, or stalls, the extension pauses. Reload the page and it
  checks whether anything mid-submit went through, then continues.
- **Alerts.** A colored bar on the page, beeps, and a desktop notification tell you
  when registration succeeds or when it needs you.
- **Stays on registration pages.** It never runs on Browse Classes or Plan Ahead,
  and it refuses to click a button labeled "Save Plan".

## How it works

```
Scheduled time reached (on "Select a Term")
        │
        ▼
Click Continue (up to 3 tries if the window isn't open yet)
        │
        ▼
Phase 1 ─ "Enter CRNs" tab?
        ├── YES ─► type main CRN #1 → Add to Summary → Submit it alone
        │            (full / rejected → move on; other errors → up to 3 tries)
        └── NO ──► skip
        │
        ▼
Phase 2 ─ "Plans" tab with a plan?
        ├── YES ─► Plan 1 → Add All → Submit (once)
        └── NO ──► skip
        │
        ▼  (only if you still need more courses)
Phase 3 ─ Find Classes → Advanced Search → Subject + College + Campus
        → scan all pages → pick the first N still needed (in order),
          skipping any not found, full, or already tried
        │
        ├── Fewer available than needed ─► add them, DON'T submit, alert you
        ▼
Add → Submit → read each Status
        ├── Registered ──────────────► stop once you have enough
        ├── Rejected as full/closed ─► drop it now, next backup moves up
        ├── Other failure, tries < 3 ► wait 5 s, try the same CRN again
        ├── Other failure, tries = 3 ► next backup takes its place
        └── Unclear / Banner error ──► pause, save progress, alert you
```

## Design principles

The extension is deliberately conservative toward a shared university system:

- It **never reloads the page** on its own and never polls Banner for open seats.
- It submits each CRN **at most 3 times**, and full sections **not at all again**.
- It **never submits a partial set** of courses.
- If it **can't confirm** whether a course registered, it stops and asks you to
  finish by hand rather than guessing, so you never go over your course limit.
- Only **one browser tab** runs a registration at a time.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder.
5. Pin the extension from the puzzle-piece menu in the toolbar.
6. Allow Chrome to show notifications in your operating system's settings.

## Usage

### Before registration day

1. Find your section CRNs in Banner's **Browse Classes**.
2. Find your time ticket under **Prepare for Registration**.
3. Open the extension and fill in:
   - **Main CRNs**: the sections you want (this count is your target)
   - **Backup CRNs**: in order of preference
   - **Subject**, **College**, **Campus**: worded exactly as in Banner's Advanced
     Search dropdowns. Leave College or Campus blank to skip that filter.
4. Click **Save CRNs**, enter your registration time, and click **Schedule**.

### On registration day

1. Set your computer's clock to sync automatically and check it at
   [time.is](https://time.is). The timer uses your local clock.
2. A few minutes before your time, log in through Student Hub, open
   **Course Registration** → **Register for Classes**, and **select your term but
   don't click Continue**.
3. Keep the tab open and your computer awake. At your time the extension clicks
   Continue and does the rest.
4. Wait for the green bar (success) or red bar (it needs you), then confirm your
   schedule in Banner.

## Testing

Registration pages only work during your window, so two separate test builds
cover the rest ahead of time. Install them next to the real extension; each
keeps its own settings.

- **NU Browse Classes Tester** runs the real extension's code on
  Browse Classes (`termSelection?mode=search`): auto-Continue, Advanced Search,
  paging, finding CRNs, spotting full sections, and choosing sections. It never
  clicks Add or Submit; it produces a report of what the real extension would do.
- **测试工具 (Plan Ahead test kit)** runs on Plan Ahead (`/ssb/plan/plan`), where
  results list courses rather than sections. It finds courses by name in order,
  clicks **Add Course**, checks the Summary panel, and clicks **Save Plan**. It also
  scans the page structure and tests the alert bar, sound, and notifications.

## Configuration

Settings live at the top of `content.js`:

| Setting | Default | Purpose |
|---|---|---|
| `SEL` | Banner 9 IDs | Selectors for Find Classes, Search, Search Again, Submit, and the Summary panel |
| `BTN_TEXT` | "Add", "Add Course", "Submit" | Button text used when an id isn't found |
| `STATUS` | Banner 9 wording | Words that mark a Summary row as registered or failed |
| `FULL_IN_RESULTS` | "FULL", "Closed", "0 of N seats remain" | Marks a search result as full |
| `FULL_AFTER_SUBMIT` | "closed", "full", "no seats", "capacity" | Marks a rejection as a full section |
| `PAGE_ERRORS` | Common server errors | Text that means Banner itself is down or the session expired |
| `MAX_ATTEMPTS` | `3` | Submits per CRN for non-full failures |
| `RETRY_DELAY_MS` | `5000` | Pause between retry rounds |
| `RESULT_TIMEOUT_MS` | `60000` | How long to wait for Banner to show results |
| `GRACE_MS` | 10 minutes | How long to wait for Find Classes after the scheduled time |
| `MAX_PAGES` | `30` | Most result pages to look through |
| `CONTINUE_TRIES` | `3` | Continue clicks if the window isn't open yet |
| `CONTINUE_RETRY_MS` | `2000` | Pause between Continue clicks |

If Banner's markup or wording changes, right-click the element in Chrome, choose
**Inspect**, and update the matching setting. Then reload the extension in
`chrome://extensions` and refresh the page.

## Project structure

```
nu-crn-filler/
├── manifest.json   # Manifest V3 config, permissions, content script matching
├── popup.html      # Popup UI: CRNs, backups, search filters, schedule
├── popup.js        # Saves settings, manual "Search & add now", run status
├── content.js      # Runs on Banner: Continue, search, choose, add, submit, retry, recover
├── background.js   # Service worker for desktop notifications
├── icon48.png
└── icon128.png
```

## Permissions

- `storage`: saves your CRNs, filters, schedule, and run progress locally.
- `activeTab`: lets the popup talk to the open Banner tab.
- `notifications`: shows desktop alerts.
- Host access to `https://nubanner.neu.edu/*` only.

No data leaves your browser. The extension has no server and no analytics.

## Limitations

- Selectors and wording are based on Banner 9 and checked against Northeastern's
  Plan Ahead and Browse Classes pages; the registration page itself can only be
  verified during an open registration window.
- The timer uses your computer's clock, not Banner's.
- It can't get you past Banner's time-ticket check before your window opens, by design.
- It can't fix registration errors such as holds, missing prerequisites, or time
  conflicts. Check the Summary panel for the reason.
- Your browser tab must stay open and your computer awake.

## License

MIT. See `LICENSE`.
