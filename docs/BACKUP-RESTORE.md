# Backup and restore

Backups contain personal and business data and are **unencrypted**, as requested. The portable `.pharmbackup` file is a ZIP containing a SQLite snapshot and a versioned manifest with SHA-256 checksum. Logos are stored in database settings, so they are included in snapshots and invoice branding history.

## Automatic backups

The app checks at launch and every minute while running. It takes an overdue backup when the last successful local automatic snapshot is at least 24 hours old. A powered-off PC or a closed app cannot back up. The persisted timestamp is advanced only after a local snapshot succeeds; overlapping backup jobs are prevented.

The verified local copy is placed under the application data directory's `backups` folder. The app then copies it to each detected volume in `RadefyPharmacyBackups/<installation-id>`. Volume access and copy errors appear in **Backup & restore → History**; failed copies are retried while the app remains open. Windows physical disk numbers are displayed when the OS supplies them, allowing partitions on the same disk to be recognized. Unknown physical independence is explicitly marked. A destination on the same physical disk does not protect against failure of that disk.

Each destination retains its latest 30 automatic archives for this installation. Pruning occurs only after a successful copy and touches only application-owned automatic filenames. Manual archives and unrelated files are never pruned. Disconnected drives receive new scheduled copies when accessible; previously failed copies are retried if their source remains in local retention.

## Manual backup

1. Open **Backup & restore** with backup write permission.
2. Select **Back up now**, choose a `.pharmbackup` destination and wait for completion.
3. Check the per-destination history. A successful local snapshot does not imply every external copy succeeded.
4. Keep a copy on a physically separate removable drive. Disconnect it when stored.

## Restore

1. Sign in as an administrator or a user explicitly allowed to restore. On a fresh installation, create a temporary administrator first.
2. Open **Backup & restore → Restore backup** and select the archive.
3. Review the pharmacy, backup date and schema version shown before confirmation.
4. Confirm replacement. The app extracts to staging, checks the checksum, SQLite integrity, foreign keys and version, then makes a pre-restore backup before replacing the database.
5. Sign in again with an account from the restored backup. Restoration replaces accounts/passwords/settings along with inventory and finances.

Keep the app open until completion. The operation blocks writes and clears sessions after success. Unsupported newer schemas and damaged archives are rejected. The previous database remains in `pharmacy.pre-restore.db`; a persisted restore journal allows the original database to be recovered on the next launch if replacement was interrupted.

If a storage failure prevents launch, close the app and preserve the **entire** data directory, including any `pharmacy.db-wal`, `pharmacy.db-shm`, restore journal and pre-restore database, before repair. Do not replace or delete a live SQLite database or its WAL files manually. Start with a known verified portable backup and the normal restore workflow.

## Upgrade

Take a manual backup first. Install the newer setup over the same installation/user profile. The stable application identifier keeps data outside the executable folder, and migrations reject a database newer than the app understands. Do not downgrade an installation without restoring a compatible backup. Test the upgrade with a copy of actual client data on a separate PC before deployment.
