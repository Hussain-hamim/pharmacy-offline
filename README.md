# Radefy Pharmacy

Offline desktop pharmacy management using Tauri 2, React 19, TypeScript and bundled SQLite. All production data access and financial posting run in Rust. There is no cloud account, server dependency, remote font, analytics SDK or online payment integration.

## Run locally

Prerequisites: Node.js 22+, npm, Rust stable, and the native Tauri build prerequisites for your OS. On Windows install Visual Studio Build Tools with **Desktop development with C++** and the Windows SDK. The development machine needs internet for dependencies; the installed application does not.

```sh
npm ci
npm run desktop
```

The first launch asks you to create the administrator and pharmacy name. There are **no default production credentials**. Other staff accounts are created in **Users**. All staff on this installation use application accounts within the same Windows user profile.

Windows data lives in `%APPDATA%\com.radefy.pharmacy\`; macOS uses `~/Library/Application Support/com.radefy.pharmacy/`. The database is outside the installation directory. Do not put this directory on a network share. A single-instance guard prevents two copies of the desktop application opening simultaneously.

## Implemented workflows

- Customer and supplier records, supplier types, opening balances and paginated account histories.
- Product names, generic names, category, strength, form, manufacturer, unique barcode, shelf and reorder levels. Product-specific base, strip and box units.
- Purchases with batch/expiry, discounts, supplier credit, immediate or partial payments, and drafts.
- Invoice-style POS with editable rows, fixed/percentage discounts, applied account credit, payment/change, autosave, FEFO allocation and printing. Anonymous credit sales are rejected.
- Opening stock, counts, damage reductions, quarantine/release and immutable movement history. Positive counts use the batch's existing average cost; replenish an empty batch with an opening-stock entry.
- Customer receipts and supplier payments; allocate to a selected invoice or oldest outstanding invoices. Excess payment becomes account credit.
- Returns linked to original bills with remaining-quantity limits, original net-price/cost snapshots, debt reduction, refunds or credit. Customer returns default to quarantine.
- Expense categories and posted expenses. Posting is immutable; inventory/document corrections use returns or audited stock adjustments.
- Sales, purchases, balances, collections, supplier payments, discounts, daily profit, stock value/movements, expiry, returns and expense reports. CSV exports stream **all matching rows**, independently of screen pagination; **Print page** prints the current report page.
- Per-module read/write permissions and separate cost/profit, return/reversal, user and restore permissions; Argon2id passwords, last-administrator protection and audit history.
- English, Dari and Pashto UI; RTL layouts and local Arabic/Latin fonts. Gregorian and Solar Hijri dates with Afghan month names. Month-only expiry means the last day of the selected calendar month. Business timezone is Asia/Kabul in this release.
- A4 and 80 mm invoice preview with configurable branding, logo, footer and columns. Each paper format retains its columns/footer. Posted invoices retain the pharmacy, party identity and original payment terms for consistent reprints; account statements show subsequent settlement.
- User-owned, revision-checked drafts autosave after one second and on navigation/sign-out/native window close. User passwords are deliberately excluded from draft storage.
- Verified online SQLite backups, persisted 24-hour scheduling, drive-copy history, retry/retention and staged restore. See [recovery instructions](docs/BACKUP-RESTORE.md).

## Data and performance

SQLite uses foreign keys, WAL, durable commits, a bounded busy timeout, serialized transactions and independent read connections. Native requests run outside the UI thread. Quantities are whole base units and money is integer AFN minor units. Proportional discount allocation and cumulative return rounding conserve totals.

Lists use bounded keyset pagination (25/50/100 rows), stable IDs, prefix FTS5 product search and indexed barcode lookup. Invoice rows are virtualized. Schema/index definitions are in `src-tauri/src/schema.sql`. Posting updates stock/account movements, balances and daily summaries in one transaction. Request IDs protect financial mutations from repeated submission; editable masters and drafts have revisions.

The 100k-product / 1m-document / 5m-line Mac benchmark produced p95 reads of **1.8–80.7 ms** and p95 single-line posting of **12.2 ms**. These are warm local debug-build measurements, not Windows hardware acceptance. [Recorded output](docs/benchmark-macos.json) and [validation status](docs/VALIDATION.md).

## Tests

```sh
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo run --manifest-path src-tauri/Cargo.toml --example benchmark -- artifacts/benchmark
```

The scale benchmark creates approximately 1 GB of synthetic data. Use a new disposable path with at least 3 GB free; never point it at application data. The benchmark contains a size guard and retains `results.json`.

For browser development against the real Rust backend, run in separate terminals:

```sh
cargo run --manifest-path src-tauri/Cargo.toml --example dev_server
npm run dev
python3 scripts/seed-demo.py
```

Open `http://127.0.0.1:1420`. Only this isolated `.dev-data` preview uses `admin` / `demo-pharmacy-2026`. The bridge listens on loopback and refuses release-mode execution. It is not included in the desktop installer. In a debug desktop build, `PHARMACY_TEST_DATA_DIR` can select an isolated test directory; release builds ignore this variable.

## Windows installer

On a Windows 10/11 x64 build machine:

```powershell
npm ci
npm run check
npm run tauri build
```

The unsigned setup file is generated in `src-tauri/target/release/bundle/nsis/*-setup.exe`. Configuration uses Tauri's `offlineInstaller` WebView2 mode: the WebView2 installer is bundled so client installation does not download it. Building the setup file requires network access to obtain that runtime initially. [Tauri packaging reference](https://v2.tauri.app/distribute/windows-installer/).

The private source repository is [Hussain-hamim/pharmacy-offline](https://github.com/Hussain-hamim/pharmacy-offline). The [Windows offline installer workflow](https://github.com/Hussain-hamim/pharmacy-offline/actions/workflows/windows.yml) runs checks, native desktop smoke tests, and the release build. It inspects the finished EXE to verify the full WebView2 payload is bundled, then uploads the installer, SHA-256 checksum and build manifest as the **Radefy-Pharmacy-Windows-x64-offline** artifact (retained for 30 days). Repository access is required to download it. Signing is not configured; a signing certificate is needed for a signed release.

The first verified Windows build is [run 38449879538](https://github.com/Hussain-hamim/pharmacy-offline/actions/runs/38449879538). **[Download the setup EXE from the private v0.1.0 release](https://github.com/Hussain-hamim/pharmacy-offline/releases/tag/v0.1.0)**; release assets persist beyond Actions artifact retention. It passed 11 frontend tests, 22 Rust tests and the native desktop smoke test; the installer contains the full offline WebView2 payload. GitHub names the release asset `Radefy.Pharmacy_0.1.0_x64-setup.exe`.

To start another build from this checkout:

```sh
gh workflow run windows.yml --ref main
gh run list --workflow windows.yml --limit 5
```

Download the artifact from a successful run's page, or use `gh run download RUN_ID --name Radefy-Pharmacy-Windows-x64-offline --dir artifacts/windows-installer`. Extract the artifact ZIP before copying the setup EXE to a client's PC. The EXE itself includes WebView2; the client does not need Node, Rust or an internet connection. Compare its SHA-256 hash with `SHA256SUMS.txt` after copying it.

Windows desktop smoke tests live in `tests/windows`. Build with `npm run tauri build -- --debug --no-bundle`, install Python `selenium`, `tauri-driver`, and the matching Microsoft Edge Driver, then run `./tests/windows/run.ps1`. The harness creates a fresh test database and exercises native sign-in, a bill/draft/post workflow, RTL switching and module navigation. See the [official driver prerequisites](https://v2.tauri.app/develop/tests/webdriver/manual-setup/).

Before client rollout, complete the Windows offline-install, upgrade, printer, drive-failure and target-hardware checks in [VALIDATION.md](docs/VALIDATION.md). The Mac app bundle is a local development verification artifact, not the requested Windows installer.

## Source map

`src/pages` contains operational screens; `src/components/ui.tsx` shared forms/tables/dialogs; `src/hooks/useDraft.ts` durable-draft lifecycle; `src/i18n*.ts` translations. `src-tauri/src/lib.rs` is the authenticated native command boundary; `trading.rs` handles posting and returns; `master.rs` master data/drafts; `queries.rs` lists/reports; `backup.rs` backup and restore; `tests.rs` transactional integration coverage.
