# NU CRN Filler

A Chrome extension that registers you for classes on Northeastern University's
Banner registration page the moment your registration window opens, with
automatic retries, backup courses, and crash recovery.

> **Not affiliated with Northeastern University.** This is a personal project.
> Review Northeastern's policies on appropriate use of computing resources
> before using it, and use it at your own risk.

## Why

Popular sections fill up within seconds of registration opening. Typing CRNs,
adding them to the summary, and submitting by hand takes long enough to lose a
seat. This extension does those steps for you in a second or two, then handles
what happens if a course fails or Banner falls over under load.

## Features

- **Search by Subject and Campus, add by CRN.** The extension opens Find Classes,
  expands Advanced Search, picks your Subject, College and Campus (for example,
  Computer Science, Khoury Coll of Comp Science and Silicon Valley), searches, then pages through the results to find
  each saved CRN and clicks that section's **Add** button.
- **Auto-Continue.** At your time it clicks **Continue** on the term page, retrying
  briefly if your clock is a second early.
- **Scheduled registration.** Set your time-ticket date and time. At that moment
  the extension fills your main CRNs, adds them to the summary, and clicks Submit.
- **Exactly the number you need.** Your number of main CRNs is the target (for
  example, 2). The extension scans the results first, picks the first 2 that are
  available in order (main CRNs, then backups), adds them, and **submits only when
  all 2 are selected**. It stops as soon as 2 are registered.
- **Missing or full sections are swapped right away.** If a CRN isn't in the
  search results, has no Add button, or shows as full (for example, "FULL: 0 of 30
  seats remain"), the next backup takes its place in the same round. If Banner
  rejects a CRN after Submit because the section is full or closed, it's dropped
  immediately instead of being retried.
- **Limited retries.** A CRN that Banner rejects (closed, error) is retried up to 3
  times total, 5 seconds apart, then a backup takes its place.
- **No partial submits.** If fewer courses can be found than you need, it adds what
  it found, does not submit, and alerts you to decide.
- **Crash recovery.** Progress (registered courses, failures, tries used) is saved
  after every step. If Banner shows an error page, logs you out, or stalls, the
  extension pauses. Reload the page and it first checks whether anything mid-submit
  went through, then continues where it left off.
- **Alerts.** A colored status bar on the page, beeps, and a desktop notification
  tell you when registration succeeds or when it needs you.
- **Manual mode.** A "Search & add now" button finds and adds your CRNs without submitting, for
  testing or for registering by hand.

## Design principles

The extension is deliberately conservative toward a shared university system:

- It **never reloads the page** on its own and never polls Banner for open seats.
- It submits each CRN **at most 3 times**.
- If it **can't confirm** whether a course registered, it stops and asks you to
  finish by hand rather than guessing.
- Only **one browser tab** runs a registration at a time.

## How it works

```
Scheduled time reached
        │
        ▼
Search (Subject + College + Campus) → scan all result pages for your CRNs
        │
        ▼
Pick the first N available (main CRNs, then backups); drop any not found or full
        │
        ├── Fewer than N available ─► add them, DON'T submit, alert you
        ▼
Add the N sections → Submit → read each Status
        │
        ├── Registered ─────────────► counts toward N; stop when N reached
        ├── Rejected as full/closed ► drop it now, next backup moves up
        ├── Failed, tries < 3 ──────► wait 5 s, try the same CRN again
        ├── Failed, tries = 3 ──────► next backup takes its place
        └── Unclear / Banner error ─► pause, save progress, alert you
```

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
3. Open the extension, enter your **Main CRNs** and **Backup CRNs** (in order of
   preference), and click **Save CRNs**.
4. Enter your registration time and click **Schedule**.
5. Set **Subject**, **College** and **Campus** in the popup to match Banner's dropdown options.
6. If possible, do a test run during an add/drop period with **Search & add now**.

### On registration day

1. Set your computer's clock to sync automatically and check it at
   [time.is](https://time.is). The timer uses your local clock.
2. A few minutes before your time, log in through Student Hub, open
   **Course Registration** → **Register for Classes**, and select your term.
3. On **Select a Term**, choose your term but **don't click Continue**. At your
   time the extension clicks Continue for you (up to 3 tries, 2 seconds apart, if
   Banner says your window isn't open yet), then runs on the next page. The
   extension waits up to 10 minutes for that tab, then runs automatically.
4. Keep the tab open and your computer awake until you see the green or red bar.
5. Confirm your schedule in Banner afterward.

## Configuration

Settings live at the top of `content.js`:

| Setting | Default | Purpose |
|---|---|---|
| `SEL` | Banner 9 IDs | CSS selectors for the Find Classes tab, search buttons, Submit, and the Summary panel |
| `BTN_TEXT` | "Add", "Add Course", "Submit" | Button text used when an id isn't found |
| `MAX_PAGES` | `30` | Most result pages to look through for your CRNs |
| `STATUS` | Banner 9 wording | Words that mark a summary row as registered or failed |
| `PAGE_ERRORS` | Common server errors | Text that means Banner itself is down or the session expired |
| `MAX_ATTEMPTS` | `3` | Submits per CRN, including the first |
| `RETRY_DELAY_MS` | `5000` | Pause between retry rounds |
| `RESULT_TIMEOUT_MS` | `60000` | How long to wait for Banner to show results |
| `GRACE_MS` | 10 minutes | How long to wait for Find Classes after the scheduled time |

Buttons are found by their usual Banner id first, then by their text (for
example, "Add", "Add to Summary" or "Add Course" all work). If Banner's markup changes, right-click the element in Chrome, choose
**Inspect**, and update `SEL` or `STATUS`. Then reload the extension in
`chrome://extensions` and refresh the page.

## Project structure

```
nu-crn-filler/
├── manifest.json   # Manifest V3 config, permissions, content script matching
├── popup.html      # Popup UI: CRNs, backups, schedule
├── popup.js        # Saves settings, starts manual fills, shows run status
├── content.js      # Runs on Banner: filling, submitting, retries, backups, recovery
├── background.js   # Service worker for desktop notifications
├── icon48.png
└── icon128.png
```

## Permissions

- `storage`: saves your CRNs, schedule, and run progress locally.
- `activeTab`: lets the popup talk to the open Banner tab.
- `notifications`: shows desktop alerts.
- Host access to `https://nubanner.neu.edu/*` only.

No data leaves your browser. The extension has no server and no analytics.

## Limitations

- The selectors and status wording are based on Banner 9's standard layout and
  may need adjusting for Northeastern's version.
- The timer uses your computer's clock, not Banner's.
- It can't get you past Banner's time-ticket check before your window opens, by design.
- It can't fix registration errors such as holds, missing prerequisites, or time
  conflicts. Check the Summary panel for the reason.
- Your browser tab must stay open and your computer awake.

## License

MIT. See `LICENSE`.
