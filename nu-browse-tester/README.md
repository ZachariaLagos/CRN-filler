# NU Browse Classes Tester

A separate test build of NU CRN Filler. It runs only on Banner's **Browse Classes**
pages and uses the real extension's search, paging, CRN matching, full-section
detection and choice rules, but **never clicks Add or Submit**.

What it tests:
- Auto-Continue on the term page (Browse Classes lets you continue any time)
- Expanding Advanced Search and picking Subject, College and Campus
- Searching, setting 50 results per page, and paging through results
- Finding each CRN, spotting full sections, and choosing the first N available

Install it next to the real extension (Load unpacked). It keeps its own settings.
