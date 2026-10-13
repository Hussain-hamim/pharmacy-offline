use crate::db::*;
use rusqlite::{backup::Backup, params};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

fn zip_error(e: impl std::fmt::Display) -> AppError {
    AppError {
        code: "BACKUP".into(),
        message: e.to_string(),
    }
}
fn digest(path: &Path) -> Result<String> {
    let mut f = fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut b = [0u8; 65536];
    loop {
        let n = f.read(&mut b)?;
        if n == 0 {
            break;
        }
        h.update(&b[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
pub fn identity(root: &Path) -> Result<String> {
    let p = root.join("installation-id");
    if p.exists() {
        return Ok(fs::read_to_string(p)?.trim().into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    fs::write(p, &id)?;
    Ok(id)
}
#[cfg(target_os = "windows")]
fn physical_disks() -> std::collections::HashMap<String, String> {
    use std::os::windows::process::CommandExt;
    let mut result = std::collections::HashMap::new();
    if let Ok(output) = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-Partition | Select-Object DriveLetter,DiskNumber | ConvertTo-Json -Compress",
        ])
        .creation_flags(0x08000000)
        .output()
    {
        if let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) {
            let rows = if let Some(rows) = value.as_array() {
                rows.clone()
            } else {
                vec![value]
            };
            for row in rows {
                if let (Some(drive), Some(number)) =
                    (row["DriveLetter"].as_str(), row["DiskNumber"].as_u64())
                {
                    if !drive.is_empty() {
                        result.insert(drive.to_uppercase(), format!("Disk {number}"));
                    }
                }
            }
        }
    }
    result
}
pub fn destinations(root: &Path) -> Result<Vec<Value>> {
    let id = identity(root)?;
    let mut out = vec![
        json!({"path":root.join("backups"),"name":"Local application backup","device":"Application data volume","local":true}),
    ];
    if cfg!(test) {
        return Ok(out);
    }
    #[cfg(target_os = "windows")]
    let physical = physical_disks();
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut seen = std::collections::HashSet::new();
    for disk in disks.list() {
        let mount = disk.mount_point();
        let canonical = mount.to_string_lossy().to_string();
        if !seen.insert(canonical.clone()) {
            continue;
        }
        #[cfg(not(target_os = "windows"))]
        if canonical != "/" && !canonical.starts_with("/Volumes/") {
            continue;
        }
        let folder = mount.join("RadefyPharmacyBackups").join(&id);
        out.push(json!({"path":folder,"name":canonical,"device":disk.name().to_string_lossy(),"available_bytes":disk.available_space(),"removable":disk.is_removable(),"local":false}));
    }
    #[cfg(target_os = "windows")]
    for destination in &mut out {
        let path = destination["path"].as_str().unwrap_or("");
        let drive = path
            .chars()
            .next()
            .map(|c| c.to_ascii_uppercase().to_string())
            .unwrap_or_default();
        if let Some(disk) = physical.get(&drive) {
            destination["physical_disk"] = json!(disk);
        }
    }
    Ok(out)
}
#[allow(clippy::too_many_arguments)]
fn history(
    root: &Path,
    backup_id: &str,
    destination: &Path,
    path: &Path,
    automatic: bool,
    status: &str,
    error: &str,
    bytes: u64,
) -> Result<()> {
    let c = open(&root.join("pharmacy.db"))?;
    c.execute("INSERT INTO backups(backup_id,destination,path,automatic,status,error,bytes) VALUES(?,?,?,?,?,?,?) ON CONFLICT(backup_id,destination) DO UPDATE SET status=excluded.status,error=excluded.error,bytes=excluded.bytes",params![backup_id,destination.to_string_lossy(),path.to_string_lossy(),automatic,status,error,bytes as i64])?;
    Ok(())
}
fn copy_atomic(source: &Path, destination: &Path, expected: &str) -> Result<u64> {
    let parent = destination.parent().ok_or(AppError {
        code: "BACKUP".into(),
        message: "Invalid backup destination".into(),
    })?;
    fs::create_dir_all(parent)?;
    let partial = destination.with_extension("partial");
    let bytes = fs::copy(source, &partial)?;
    // FlushFileBuffers requires a writable handle on Windows.
    fs::OpenOptions::new()
        .write(true)
        .open(&partial)?
        .sync_all()?;
    require(
        digest(&partial)? == expected,
        "Backup copy checksum mismatch",
    )?;
    fs::rename(partial, destination)?;
    Ok(bytes)
}
fn prune(root: &Path, directory: &Path) -> Result<()> {
    let id = identity(root)?;
    let prefix = format!("auto-{id}-");
    let mut paths: Vec<PathBuf> = fs::read_dir(directory)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with(&prefix))
                && p.extension().is_some_and(|e| e == "pharmbackup")
        })
        .collect();
    paths.sort();
    if paths.len() > 30 {
        for old in paths.iter().take(paths.len() - 30) {
            fs::remove_file(old)?;
        }
    }
    Ok(())
}
pub fn run(
    root: &Path,
    automatic: bool,
    manual: Option<&Path>,
    progress: &dyn Fn(Value),
) -> Result<Value> {
    let c = open(&root.join("pharmacy.db"))?;
    let id = uuid::Uuid::new_v4().to_string();
    let local = root.join("backups");
    fs::create_dir_all(&local)?;
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%3f").to_string();
    let name = format!(
        "{}-{}-{stamp}.pharmbackup",
        if automatic { "auto" } else { "manual" },
        identity(root)?
    );
    let target = local.join(&name);
    let staging = root.join(format!("snapshot-{id}.db"));
    progress(json!({"stage":"snapshot","percent":5}));
    let mut dest = open(&staging)?;
    {
        let snapshot = Backup::new(&c, &mut dest)?;
        snapshot.run_to_completion(128, Duration::from_millis(5), None)?;
    }
    let integrity: String = dest.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    require(integrity == "ok", "Snapshot integrity check failed")?;
    drop(dest);
    let manifest = json!({"format":1,"schema_version":1,"app_version":env!("CARGO_PKG_VERSION"),"created_at":now(),"pharmacy":settings(&c)?["name"],"backup_id":id,"database_sha256":digest(&staging)?,"database_bytes":fs::metadata(&staging)?.len()});
    progress(json!({"stage":"archive","percent":30}));
    let partial = target.with_extension("partial");
    let f = fs::File::create(&partial)?;
    let mut zip = ZipWriter::new(f);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("manifest.json", options)
        .map_err(zip_error)?;
    zip.write_all(manifest.to_string().as_bytes())?;
    zip.start_file("pharmacy.db", options).map_err(zip_error)?;
    std::io::copy(&mut fs::File::open(&staging)?, &mut zip)?;
    zip.finish().map_err(zip_error)?.sync_all()?;
    fs::rename(&partial, &target)?;
    let _ = fs::remove_file(&staging);
    let hash = digest(&target)?;
    history(
        root,
        &id,
        &local,
        &target,
        automatic,
        "success",
        "",
        fs::metadata(&target)?.len(),
    )?;
    if automatic {
        c.execute("INSERT INTO settings(key,value) VALUES('last_auto_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[now()])?;
        prune(root, &local)?;
    }
    let mut statuses = vec![json!({"path":target,"status":"success"})];
    let mut dirs = destinations(root)?;
    if let Some(path) = manual {
        dirs.push(json!({"file":path,"path":path.parent(),"local":false}));
    }
    let total = dirs.len();
    for (i, d) in dirs.into_iter().enumerate() {
        if d["local"] == true {
            continue;
        }
        let Some(dir) = d["path"].as_str().map(PathBuf::from) else {
            continue;
        };
        let file = d["file"]
            .as_str()
            .map(PathBuf::from)
            .unwrap_or_else(|| dir.join(&name));
        progress(json!({"stage":"copy","destination":dir,"percent":40+50*i/total.max(1)}));
        match copy_atomic(&target, &file, &hash) {
            Ok(bytes) => {
                history(root, &id, &dir, &file, automatic, "success", "", bytes)?;
                if automatic {
                    let _ = prune(root, &dir);
                }
                statuses.push(json!({"path":file,"status":"success"}));
            }
            Err(e) => {
                history(root, &id, &dir, &file, automatic, "failed", &e.message, 0)?;
                statuses.push(json!({"path":file,"status":"failed","error":e.message}));
            }
        }
    }
    progress(json!({"stage":"complete","percent":100}));
    Ok(json!({"path":target,"manifest":manifest,"destinations":statuses}))
}
pub fn due(root: &Path) -> Result<bool> {
    let c = open(&root.join("pharmacy.db"))?;
    use rusqlite::OptionalExtension;
    let last: Option<String> = c
        .query_row(
            "SELECT value FROM settings WHERE key='last_auto_backup'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let count: i64 = c.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
    Ok(count > 0
        && last
            .and_then(|v| chrono::DateTime::parse_from_rfc3339(&v).ok())
            .map(|d| chrono::Utc::now().signed_duration_since(d).num_hours() >= 24)
            .unwrap_or(true))
}
pub fn retry(root: &Path) -> Result<()> {
    let c = open(&root.join("pharmacy.db"))?;
    let rows = json_rows(
        &c,
        "SELECT * FROM backups WHERE status='failed' ORDER BY id DESC LIMIT 100",
        &[],
    )?;
    let local = root.join("backups");
    for row in rows {
        let path = PathBuf::from(row["path"].as_str().unwrap_or(""));
        let Some(name) = path.file_name() else {
            continue;
        };
        let source = local.join(name);
        if !source.exists() {
            continue;
        }
        let directory = PathBuf::from(row["destination"].as_str().unwrap_or(""));
        if let Ok(bytes) = copy_atomic(&source, &path, &digest(&source)?) {
            history(
                root,
                row["backup_id"].as_str().unwrap(),
                &directory,
                &path,
                row["automatic"] == 1,
                "success",
                "",
                bytes,
            )?;
            if row["automatic"] == 1 {
                let _ = prune(root, &directory);
            }
        }
    }
    Ok(())
}
pub fn inspect(path: &Path) -> Result<Value> {
    let mut z = ZipArchive::new(fs::File::open(path)?).map_err(zip_error)?;
    let mut text = String::new();
    z.by_name("manifest.json")
        .map_err(zip_error)?
        .take(1_000_000)
        .read_to_string(&mut text)?;
    let manifest: Value = serde_json::from_str(&text)?;
    require(manifest["format"] == 1, "Unsupported backup format")?;
    require(
        manifest["schema_version"].as_i64().is_some_and(|v| v == 1),
        "Backup requires a newer application",
    )?;
    require(
        manifest["database_bytes"]
            .as_u64()
            .is_some_and(|n| n <= 16 * 1024 * 1024 * 1024),
        "Invalid or oversized backup",
    )?;
    Ok(manifest)
}
pub fn restore(root: &Path, path: &Path, progress: &dyn Fn(Value)) -> Result<Value> {
    let manifest = inspect(path)?;
    let stage = root.join("restore-staging.db");
    let outcome = (|| -> Result<Value> {
        let mut zip = ZipArchive::new(fs::File::open(path)?).map_err(zip_error)?;
        let mut entry = zip.by_name("pharmacy.db").map_err(zip_error)?;
        require(
            entry.size() == manifest["database_bytes"].as_u64().unwrap(),
            "Backup size does not match manifest",
        )?;
        let mut f = fs::File::create(&stage)?;
        std::io::copy(&mut entry, &mut f)?;
        f.sync_all()?;
        drop(f);
        require(
            digest(&stage)? == manifest["database_sha256"].as_str().unwrap_or(""),
            "Backup checksum verification failed",
        )?;
        let check = open(&stage)?;
        let integrity: String = check.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        require(integrity == "ok", "Backup database is corrupt")?;
        let foreign_count: i64 =
            check.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })?;
        require(foreign_count == 0, "Backup contains invalid references")?;
        let version: i64 = check.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        require(version == 1, "Unsupported database version")?;
        let _ = settings(&check)?;
        drop(check);
        progress(json!({"stage":"pre_restore_backup","percent":20}));
        run(root, false, None, progress)?;
        let db = root.join("pharmacy.db");
        let old = root.join("pharmacy.pre-restore.db");
        let live = open(&db)?;
        live.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        drop(live);
        clear_sidecars(root)?;
        if old.exists() {
            fs::remove_file(&old)?;
        }
        let mut journal = fs::File::create(root.join("restore-journal"))?;
        journal.write_all(b"prepared")?;
        journal.sync_all()?;
        drop(journal);
        fs::rename(&db, &old)?;
        if let Err(e) = fs::rename(&stage, &db) {
            let _ = fs::rename(&old, &db);
            return Err(e.into());
        }
        let validation = init(&db);
        if let Err(e) = validation {
            clear_sidecars(root)?;
            let _ = fs::remove_file(&db);
            let _ = fs::rename(&old, &db);
            return Err(e);
        }
        fs::remove_file(root.join("restore-journal"))?;
        progress(json!({"stage":"complete","percent":100}));
        Ok(json!({"restored":true,"manifest":manifest}))
    })();
    if outcome.is_err() {
        let _ = fs::remove_file(stage);
    }
    outcome
}
pub fn recover(root: &Path) -> Result<()> {
    let marker = root.join("restore-journal");
    if marker.exists() {
        let db = root.join("pharmacy.db");
        let old = root.join("pharmacy.pre-restore.db");
        if old.exists() {
            clear_sidecars(root)?;
            if db.exists() {
                let _ = fs::rename(&db, root.join("interrupted-restore.db"));
            }
            fs::rename(old, db)?;
        }
        fs::remove_file(marker)?;
    }
    Ok(())
}
fn clear_sidecars(root: &Path) -> Result<()> {
    for name in ["pharmacy.db-wal", "pharmacy.db-shm"] {
        let path = root.join(name);
        if path.exists() {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod backup_tests {
    use super::*;
    #[test]
    fn snapshot_restore_and_corruption_rejection() {
        let root = tempfile::tempdir().unwrap();
        crate::db::init(&root.path().join("pharmacy.db")).unwrap();
        let c = open(&root.path().join("pharmacy.db")).unwrap();
        c.execute(
            "INSERT INTO categories(kind,name) VALUES('expense','Before backup')",
            [],
        )
        .unwrap();
        drop(c);
        let result = run(root.path(), true, None, &|_| {}).unwrap();
        let file = PathBuf::from(result["path"].as_str().unwrap());
        assert_eq!(inspect(&file).unwrap()["schema_version"], 1);
        let c = open(&root.path().join("pharmacy.db")).unwrap();
        c.execute(
            "INSERT INTO categories(kind,name) VALUES('expense','After backup')",
            [],
        )
        .unwrap();
        drop(c);
        restore(root.path(), &file, &|_| {}).unwrap();
        let c = open(&root.path().join("pharmacy.db")).unwrap();
        let count: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM categories WHERE name='After backup'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
        drop(c);
        let bad = root.path().join("broken.pharmbackup");
        fs::write(&bad, b"not an archive").unwrap();
        assert!(restore(root.path(), &bad, &|_| {}).is_err());
        assert_eq!(
            open(&root.path().join("pharmacy.db"))
                .unwrap()
                .query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
    }
    #[test]
    fn retention_only_removes_owned_automatic_archives() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("backups");
        fs::create_dir(&dir).unwrap();
        let id = identity(root.path()).unwrap();
        for i in 0..35 {
            fs::write(
                dir.join(format!("auto-{id}-{i:03}.pharmbackup")),
                b"archive",
            )
            .unwrap();
        }
        fs::write(dir.join("manual-keep.pharmbackup"), b"archive").unwrap();
        fs::write(dir.join("unrelated.txt"), b"keep").unwrap();
        prune(root.path(), &dir).unwrap();
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 32);
        assert!(dir.join("manual-keep.pharmbackup").exists());
        assert!(dir.join("unrelated.txt").exists());
    }
    #[test]
    fn verified_copy_is_durable_and_preserves_source() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.pharmbackup");
        let destination = root.path().join("drive/copy.pharmbackup");
        fs::write(&source, b"verified backup").unwrap();
        let bytes = copy_atomic(&source, &destination, &digest(&source).unwrap()).unwrap();
        assert_eq!(bytes, 15);
        assert_eq!(fs::read(&destination).unwrap(), fs::read(&source).unwrap());
        assert!(!destination.with_extension("partial").exists());
    }
    #[test]
    fn failed_destination_does_not_damage_source() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        let blocked = root.path().join("blocked");
        fs::write(&source, b"backup").unwrap();
        fs::write(&blocked, b"file prevents directory creation").unwrap();
        assert!(copy_atomic(
            &source,
            &blocked.join("copy.pharmbackup"),
            &digest(&source).unwrap()
        )
        .is_err());
        assert_eq!(fs::read(source).unwrap(), b"backup");
    }
    #[test]
    fn interrupted_restore_recovers_original() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("pharmacy.pre-restore.db"), b"original").unwrap();
        fs::write(root.path().join("pharmacy.db"), b"replacement").unwrap();
        fs::write(root.path().join("pharmacy.db-wal"), b"stale").unwrap();
        fs::write(root.path().join("restore-journal"), b"prepared").unwrap();
        recover(root.path()).unwrap();
        assert_eq!(
            fs::read(root.path().join("pharmacy.db")).unwrap(),
            b"original"
        );
        assert!(!root.path().join("pharmacy.db-wal").exists());
    }
}
