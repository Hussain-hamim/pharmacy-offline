# Validation record — 2026-10-13

The Windows setup EXE has now been built successfully through GitHub Actions, and its embedded offline WebView2 payload has been verified. **Clean-client offline installation, upgrades, physical printers/drives and target-hardware performance still require the checks below.**

## Verified Windows build

- Private repository: [Hussain-hamim/pharmacy-offline](https://github.com/Hussain-hamim/pharmacy-offline).
- Successful [Windows CI run](https://github.com/Hussain-hamim/pharmacy-offline/actions/runs/38449879538), source commit `4fdda7edada13f14bf6f17e0a35d5928b093a2a3`.
- Passed: 11 frontend tests, 22 Rust integration tests, strict Clippy checks, production frontend build and the native Windows desktop smoke test.
- The desktop test signed in, selected stock, saved/reopened a draft, posted a paid invoice, switched English/Dari/Pashto, and navigated the customer, supplier, stock, payment, return, expense, report, user, settings, backup and audit screens.
- Installer: `Radefy Pharmacy_0.1.0_x64-setup.exe`, **220,746,137 bytes**, unsigned, Windows x64.
- Installer inspection found the complete `MicrosoftEdgeWebView2RuntimeInstaller.exe` payload (**214,090,448 bytes**) alongside the pharmacy executable. Configuration uses `offlineInstaller`.
- EXE SHA-256: `01820c7cb14670b7a1fbfc4e0f92d65d0a6b850f67bfc12f47580f2942a5947c`.
- [Download the private Actions artifact](https://github.com/Hussain-hamim/pharmacy-offline/actions/runs/38449879538/artifacts/11840916479); extract the ZIP before running the setup EXE. The artifact also includes its checksum and build manifest, and is retained for 30 days.

CI uses Windows Server 2022 because newer runners encounter an [upstream WebView2 WebDriver startup regression](https://github.com/actions/runner-images/issues/14738). The test runtime was 131.0.2903.86; this runner choice does not pin or downgrade the offline installer bundled for clients. During CI verification, a cross-module table-cache error was found and fixed; two regression tests now cover it. Windows backup copies also use writable handles for durable flushing.

The CI desktop test runs against the debug application with an isolated synthetic database. The optimized release application and NSIS installer are built afterward. This is not a claim that a clean Windows 10/11 PC has already been tested with networking disabled.

## Completed on this Mac

| Check | Evidence / result |
|---|---|
| TypeScript and production frontend | `npm run build` passed |
| Frontend tests | 11 tests passed: decimal/percentage calculations, both calendars, Afghan month names, Persian digits, month-end expiry, draft debounce and serialized autosave/post lifecycle, and paginated module transitions |
| Rust integration tests | 21 tests passed |
| Rust lint | `cargo clippy --all-targets -- -D warnings` passed |
| Native application | Debug Tauri binary and macOS `.app` compiled; native sign-in and database calls verified |
| Native transaction UI | Added two units, applied AFN 5 discount, restored draft, posted AFN 35 paid invoice, viewed original batch allocation |
| Invoice identity | Test confirms later party edits and payment settlement do not alter original print identity/terms |
| RTL layouts | Dari and Pashto dashboard switching verified in browser; screenshots saved; no horizontal overflow in the observed viewport |
| Print templates | A4 and 80 mm previews render; native invoice preview verified. Actual Windows print output remains pending |
| Backup screen | Schedule, destination listing and paginated history render. Snapshot/restore behavior verified in Rust integration tests |
| Large dataset | Actual SQLite database with 100,000 products, 1,000,000 documents and 5,000,000 lines; approximately 962 MB |
| Query plans | Tests assert use of document pagination and FEFO indexes |
| Full CSV export | 126 records exported with a screen limit of 25 and a supplied cursor; the export ignored screen pagination and used AFN decimals. Unauthorized export denied |

Rust tests cover the complete purchase → discounted credit sale → partial payment → customer return → supplier return chain, balances and profit, pack conversion, mixed/expired/quarantined batches, overselling rollback, repeated submission, credit reuse, over-return rejection, immutable print snapshots, counts/quarantine, first-administrator protection, command authorization, persistent drafts, forward/backward cursor pagination, expiry-day cached stock refresh, backup while posting, overdue schedules, restore onto a fresh database, corrupt archives, interrupted-restore recovery, destination failure and owned-file retention.

The browser preview was tested against the same Rust core through the debug-only loopback bridge, not an in-memory UI mock. Development hot reload resets authentication when shared modules change. The installed build does not contain that bridge or hot reload.

## Scale measurements

Debug build, macOS arm64. Fifty repetitions per read case, 25 ordinary single-line postings, warm local cache. Data is synthetic; this is not a worst-case multilingual/fuzzy-search or cold-disk benchmark. The synthetic database was removed after recording results to recover disk space. The reproducible generator and raw JSON remain.

| Operation | p95 |
|---|---:|
| Products, first page | 4.32 ms |
| Products, deep cursor | 1.83 ms |
| FTS product search | 9.44 ms |
| Sales, first page | 2.03 ms |
| Sales, deep cursor | 3.04 ms |
| Sales, date filter | 80.65 ms |
| Ordinary bill posting | 12.21 ms |

[Raw benchmark result](benchmark-macos.json). Dashboard totals are maintained per day; global stock/account summaries still aggregate current balances. The benchmark does not claim sub-300-ms performance for every possible filter, multi-thousand-line bills, exports, or backups.

## Required Windows release checks

These are outstanding acceptance items, not claimed successes:

1. For future code changes, rerun `.github/workflows/windows.yml` and `tests/windows/run.ps1` with the matching Edge driver. The current source commit passed these checks as recorded above.
2. Install the generated NSIS EXE on clean Windows 10/11 x64 with networking disabled and no preinstalled WebView2; confirm the bundled offline runtime installs, first setup works, and all ordinary work remains offline.
3. Test an upgrade over populated data under the same Windows profile, then verify users, drafts, inventory, invoices and backups survive.
4. Print long invoices using A4, an actual 80 mm printer and Windows PDF printing in all three languages. Confirm margins, repeated table headers, page breaks, RTL digits and mixed-direction product names. macOS `window.print()` did not open a dialog during testing; a native Tauri printing fallback was added and compiled, but its system dialog still needs verification.
5. Exercise disconnected, read-only and full removable/fixed drives; confirm copy retry, disk-number grouping and retention. Unit tests simulate failed destinations and interrupted restoration; they do not substitute for physical power-loss and drive-removal tests on Windows.
6. Repeat the supplied scale benchmark on the target Windows machine (8 GB RAM, SSD). Record CPU, SSD, free space, app build/profile, cache conditions and p95 results; validate <300 ms indexed page/search and <1 second ordinary posting.
7. Review Dari/Pashto terminology with the client's speakers and complete keyboard, accessibility, barcode scanner and long-form acceptance with pharmacy staff.
8. Provide a signing certificate if a signed installer is required. Initial build configuration produces unsigned installers.

## Practical limits of this release

- One pharmacy/location and one Windows profile per installation; staff use separate application accounts. No LAN sharing, cloud sync, taxes or multiple currencies.
- Timezone is Asia/Kabul. Date entry supports both calendars; stored business dates are Gregorian.
- Printable report views print the current page. Full-dataset output is CSV, streamed in the background with cancellation.
- Invoice editors accept up to 2,000 rows per document. Product selectors and histories remain paginated.
- Counts use existing batch costs; adding a batch with a different cost uses opening stock or a purchase. Returned stock must be explicitly released before sale when quarantined.
- Backup metadata may report unknown physical independence if Windows cannot supply partition information. The app retries failed recorded destinations while their retained local source is available.
- Operating profit is gross sales margin less recorded expenses. This is not a general ledger with depreciation, payroll, tax or formal financial statements.

## Visual evidence

- [Native dashboard](native-dashboard.png)
- [Posted native invoice](native-invoice.png)
- [Dari dashboard](dari-dashboard.png)
- [Pashto dashboard](pashto-dashboard.png)
