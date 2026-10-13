mod auth;
pub mod backup;
pub mod db;
mod master;
mod queries;
#[cfg(test)]
mod tests;
mod trading;
use db::*;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex, RwLock},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

pub struct Core {
    pub root: PathBuf,
    sessions: Mutex<HashMap<String, i64>>,
    writes: Mutex<()>,
    gate: RwLock<()>,
    backups: Mutex<()>,
    attempts: Mutex<HashMap<String, (u32, Instant)>>,
    cancelled: Mutex<HashSet<String>>,
}
impl Core {
    pub fn new(root: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&root)?;
        backup::recover(&root)?;
        db::init(&root.join("pharmacy.db"))?;
        Ok(Self {
            root,
            sessions: Mutex::new(HashMap::new()),
            writes: Mutex::new(()),
            gate: RwLock::new(()),
            backups: Mutex::new(()),
            attempts: Mutex::new(HashMap::new()),
            cancelled: Mutex::new(HashSet::new()),
        })
    }
    pub fn call(
        &self,
        action: &str,
        payload: Value,
        token: Option<&str>,
        progress: &dyn Fn(Value),
    ) -> Result<Value> {
        if action == "restore" {
            let _gate = self.gate.write().map_err(poison)?;
            let _backup = self.backups.lock().map_err(poison)?;
            let c = db::open(&self.root.join("pharmacy.db"))?;
            let a = self.authenticate(&c, token)?;
            auth::check(&a, "backups", true)?;
            auth::special(&a, "restore")?;
            drop(c);
            let result = backup::restore(
                &self.root,
                &PathBuf::from(payload["path"].as_str().unwrap_or("")),
                progress,
            )?;
            self.sessions.lock().map_err(poison)?.clear();
            return Ok(result);
        }
        let _gate = self.gate.read().map_err(poison)?;
        let mut c = db::open(&self.root.join("pharmacy.db"))?;
        match action {
            "bootstrap" => {
                let count: i64 = c.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
                let s = db::settings(&c)?;
                return Ok(json!({"needs_setup":count==0,"pharmacy_name":s["name"]}));
            }
            "setup" => {
                let _write = self.writes.lock().map_err(poison)?;
                let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
                let user = auth::save_user(&tx, None, payload.clone())?;
                if let Some(name) = payload["pharmacy_name"].as_str() {
                    let mut s = db::settings(&tx)?;
                    s["name"] = json!(name);
                    tx.execute(
                        "UPDATE settings SET value=? WHERE key='pharmacy'",
                        [s.to_string()],
                    )?;
                }
                tx.commit()?;
                let a = auth::actor(&c, user["id"].as_i64().unwrap())?;
                return self.session(a);
            }
            "login" => {
                let username = payload["username"].as_str().unwrap_or("");
                {
                    let attempts = self.attempts.lock().map_err(poison)?;
                    if let Some((count, time)) = attempts.get(username) {
                        if *count >= 5 && time.elapsed() < Duration::from_secs(30) {
                            return err("AUTH", "Too many attempts. Wait 30 seconds");
                        }
                    }
                }
                let result = auth::login(&c, username, payload["password"].as_str().unwrap_or(""));
                match result {
                    Ok(a) => {
                        self.attempts.lock().map_err(poison)?.remove(username);
                        return self.session(a);
                    }
                    Err(e) => {
                        let mut attempts = self.attempts.lock().map_err(poison)?;
                        let entry = attempts
                            .entry(username.to_string())
                            .or_insert((0, Instant::now()));
                        if entry.1.elapsed() >= Duration::from_secs(30) {
                            *entry = (0, Instant::now())
                        }
                        entry.0 += 1;
                        return Err(e);
                    }
                }
            }
            "logout" => {
                if let Some(t) = token {
                    self.sessions.lock().map_err(poison)?.remove(t);
                }
                return Ok(json!({"ok":true}));
            }
            _ => {}
        }
        let a = self.authenticate(&c, token)?;
        match action {
            "me" => Ok(json!(a)),
            "list" => queries::list(&c, &a, payload),
            "detail" => queries::detail(&c, &a, payload),
            "dashboard" => queries::dashboard(&c, &a, payload),
            "settings" => db::settings(&c),
            "presets" => {
                auth::check(&a, "users", false)?;
                Ok(
                    json!({"Administrator":auth::preset("Administrator"),"Cashier":auth::preset("Cashier"),"Inventory":auth::preset("Inventory"),"Accountant":auth::preset("Accountant")}),
                )
            }
            "backup_status" => {
                auth::check(&a, "backups", false)?;
                let last: Option<String> = c
                    .query_row(
                        "SELECT value FROM settings WHERE key='last_auto_backup'",
                        [],
                        |r| r.get(0),
                    )
                    .optional()?;
                Ok(
                    json!({"last_auto_backup":last,"destinations":backup::destinations(&self.root)?,"due":backup::due(&self.root)?}),
                )
            }
            "backup" => {
                auth::check(&a, "backups", true)?;
                let _backup = self.backups.try_lock().map_err(|_| AppError {
                    code: "BUSY".into(),
                    message: "Another backup is already running".into(),
                })?;
                let manual = payload["path"].as_str().map(PathBuf::from);
                let result = backup::run(&self.root, false, manual.as_deref(), progress)?;
                db::audit(&c, a.id, "backup", "backups", "manual", json!({}))?;
                Ok(result)
            }
            "inspect_backup" => {
                auth::check(&a, "backups", true)?;
                auth::special(&a, "restore")?;
                backup::inspect(&PathBuf::from(payload["path"].as_str().unwrap_or("")))
            }
            "export" => self.export(&c, &a, payload, progress),
            "cancel_export" => {
                let id = payload["job_id"].as_str().unwrap_or("");
                self.cancelled
                    .lock()
                    .map_err(poison)?
                    .insert(format!("{}:{id}", a.id));
                Ok(json!({"ok":true}))
            }
            _ => {
                let _write = self.writes.lock().map_err(poison)?;
                let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
                let request = payload["request_id"]
                    .as_str()
                    .map(|s| format!("{}:{action}:{s}", a.id));
                if let Some(ref key) = request {
                    if let Some(previous) = tx
                        .query_row("SELECT result FROM requests WHERE id=?", [key], |r| {
                            r.get::<_, String>(0)
                        })
                        .optional()?
                    {
                        return Ok(serde_json::from_str(&previous)?);
                    }
                }
                let result = match action {
                    "save_party" => master::party(&tx, &a, payload.clone()),
                    "save_product" => master::product(&tx, &a, payload.clone()),
                    "save_category" => master::category(&tx, &a, payload.clone()),
                    "save_user" => auth::save_user(&tx, Some(&a), payload.clone()),
                    "save_draft" => master::draft(&tx, &a, payload.clone()),
                    "delete_draft" => master::remove_draft(&tx, &a, payload.clone()),
                    "post_bill" => trading::post(&tx, &a, payload.clone()),
                    "post_payment" => trading::payment(&tx, &a, payload.clone()),
                    "post_return" => trading::returns(&tx, &a, payload.clone()),
                    "post_expense" => master::expense(&tx, &a, payload.clone()),
                    "adjust_stock" => master::adjustment(&tx, &a, payload.clone()),
                    "save_settings" => {
                        auth::check(&a, "settings", true)?;
                        let s = payload["settings"].clone();
                        require(
                            s.is_object() && !s["name"].as_str().unwrap_or("").trim().is_empty(),
                            "Pharmacy name is required",
                        )?;
                        require(
                            ["en", "fa", "ps"].contains(&s["language"].as_str().unwrap_or("")),
                            "Invalid language",
                        )?;
                        require(
                            ["gregory", "persian"].contains(&s["calendar"].as_str().unwrap_or("")),
                            "Invalid calendar",
                        )?;
                        require(
                            s["expiry_days"]
                                .as_i64()
                                .is_some_and(|d| (1..=730).contains(&d)),
                            "Expiry alert must be between 1 and 730 days",
                        )?;
                        require(
                            s["logo"].as_str().unwrap_or("").len() <= 3_000_000,
                            "Logo must be smaller than 2 MB",
                        )?;
                        require(
                            s["prefix"].as_str().is_some_and(|p| {
                                !p.is_empty()
                                    && p.len() <= 12
                                    && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                            }),
                            "Invoice prefix must contain 1–12 letters, digits, or hyphens",
                        )?;
                        tx.execute(
                            "UPDATE settings SET value=? WHERE key='pharmacy'",
                            [s.to_string()],
                        )?;
                        db::audit(&tx, a.id, "save", "settings", "pharmacy", json!({}))?;
                        Ok(s)
                    }
                    _ => db::err("VALIDATION", "Unknown command"),
                }?;
                if action != "save_draft" {
                    if let Some(draft) = payload["draft_id"].as_str() {
                        tx.execute(
                            "DELETE FROM drafts WHERE id=? AND user_id=?",
                            params![draft, a.id],
                        )?;
                    }
                }
                if let Some(key) = request {
                    tx.execute(
                        "INSERT INTO requests(id,result) VALUES(?,?)",
                        params![key, result.to_string()],
                    )?;
                }
                tx.commit()?;
                Ok(result)
            }
        }
    }
    fn authenticate(&self, c: &rusqlite::Connection, token: Option<&str>) -> Result<auth::Actor> {
        let id = self
            .sessions
            .lock()
            .map_err(poison)?
            .get(token.unwrap_or(""))
            .copied()
            .ok_or(AppError {
                code: "AUTH".into(),
                message: "Please sign in".into(),
            })?;
        auth::actor(c, id)
    }
    fn session(&self, a: auth::Actor) -> Result<Value> {
        let token = uuid::Uuid::new_v4().to_string();
        self.sessions
            .lock()
            .map_err(poison)?
            .insert(token.clone(), a.id);
        Ok(json!({"token":token,"user":a}))
    }
    fn export(
        &self,
        c: &rusqlite::Connection,
        a: &auth::Actor,
        p: Value,
        progress: &dyn Fn(Value),
    ) -> Result<Value> {
        use std::io::Write;
        auth::check(a, "reports", false)?;
        let id = p["job_id"].as_str().unwrap_or("");
        let path = PathBuf::from(p["path"].as_str().unwrap_or(""));
        require(
            path.extension().is_some_and(|e| e == "csv"),
            "Export must be a .csv file",
        )?;
        let partial = path.with_extension("partial");
        let mut file = std::fs::File::create(&partial)?;
        file.write_all(&[0xef, 0xbb, 0xbf])?;
        let mut query = p["query"].clone();
        query["limit"] = json!(100);
        query["report"] = json!(true);
        query
            .as_object_mut()
            .ok_or(AppError {
                code: "VALIDATION".into(),
                message: "Invalid export query".into(),
            })?
            .remove("cursor");
        let mut headers: Vec<String> = vec![];
        let mut count = 0;
        let result = (|| -> Result<()> {
            loop {
                if self
                    .cancelled
                    .lock()
                    .map_err(poison)?
                    .remove(&format!("{}:{id}", a.id))
                {
                    return err("CANCELLED", "Export cancelled");
                }
                let page = queries::list(c, a, query.clone())?;
                for row in page["items"].as_array().unwrap() {
                    if headers.is_empty() {
                        headers = row
                            .as_object()
                            .unwrap()
                            .keys()
                            .filter(|s| !s.starts_with('_'))
                            .cloned()
                            .collect();
                        writeln!(
                            file,
                            "{}",
                            headers
                                .iter()
                                .map(|s| csv(&s.replace("_minor", "_AFN")))
                                .collect::<Vec<_>>()
                                .join(",")
                        )?;
                    }
                    writeln!(
                        file,
                        "{}",
                        headers
                            .iter()
                            .map(|h| {
                                let v = &row[h];
                                if h.ends_with("_minor") {
                                    return csv(&format!(
                                        "{:.2}",
                                        v.as_i64().unwrap_or(0) as f64 / 100.0
                                    ));
                                }
                                if let Some(s) = v.as_str() {
                                    csv(s)
                                } else {
                                    csv(&if v.is_null() {
                                        String::new()
                                    } else {
                                        v.to_string()
                                    })
                                }
                            })
                            .collect::<Vec<_>>()
                            .join(",")
                    )?;
                    count += 1;
                }
                progress(json!({"stage":"export","job_id":id,"rows":count}));
                if page["next_cursor"].is_null() {
                    break;
                }
                query["cursor"] = page["next_cursor"].clone();
            }
            file.sync_all()?;
            Ok(())
        })();
        drop(file);
        if let Err(e) = result {
            let _ = std::fs::remove_file(partial);
            return Err(e);
        }
        std::fs::rename(partial, &path)?;
        Ok(json!({"path":path,"rows":count}))
    }
}
fn csv(s: &str) -> String {
    let safe = if s.starts_with(['=', '+', '@', '\t', '\r'])
        || s.starts_with('-') && s.parse::<f64>().is_err()
    {
        format!("'{s}")
    } else {
        s.into()
    };
    format!("\"{}\"", safe.replace('"', "\"\""))
}
fn poison<T>(_: std::sync::PoisonError<T>) -> AppError {
    AppError {
        code: "INTERNAL".into(),
        message: "Application state unavailable; restart the app".into(),
    }
}
#[tauri::command]
async fn request(
    core: tauri::State<'_, Arc<Core>>,
    app: tauri::AppHandle,
    action: String,
    payload: Option<Value>,
    token: Option<String>,
) -> Result<Value> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.call(
            &action,
            payload.unwrap_or(json!({})),
            token.as_deref(),
            &|v| {
                let _ = app.emit("operation-progress", v);
            },
        )
    })
    .await
    .map_err(|e| AppError {
        code: "INTERNAL".into(),
        message: e.to_string(),
    })?
}
#[tauri::command]
fn print_page(
    core: tauri::State<'_, Arc<Core>>,
    window: tauri::WebviewWindow,
    token: Option<String>,
) -> Result<()> {
    core.call("me", json!({}), token.as_deref(), &|_| {})?;
    #[cfg(target_os = "macos")]
    window.print().map_err(|e| AppError {
        code: "PRINT".into(),
        message: e.to_string(),
    })?;
    #[cfg(not(target_os = "macos"))]
    window.eval("window.print()").map_err(|e| AppError {
        code: "PRINT".into(),
        message: e.to_string(),
    })?;
    Ok(())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = if cfg!(debug_assertions) {
                std::env::var_os("PHARMACY_TEST_DATA_DIR")
                    .map(PathBuf::from)
                    .unwrap_or(app.path().app_data_dir()?)
            } else {
                app.path().app_data_dir()?
            };
            let core = Arc::new(Core::new(root)?);
            app.manage(core.clone());
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut initial = true;
                loop {
                    if !initial {
                        std::thread::sleep(Duration::from_secs(60));
                    }
                    initial = false;
                    let Ok(_gate) = core.gate.read() else {
                        continue;
                    };
                    let Ok(_backup) = core.backups.try_lock() else {
                        continue;
                    };
                    if let Ok(_write) = core.writes.lock() {
                        if let Ok(mut c) = db::open(&core.root.join("pharmacy.db")) {
                            let _ = db::refresh_expired(&mut c);
                        }
                    }
                    let progress = |v| {
                        let _ = handle.emit("operation-progress", v);
                    };
                    if backup::due(&core.root).unwrap_or(false) {
                        if let Err(e) = backup::run(&core.root, true, None, &progress) {
                            let _ = handle.emit("backup-error", e);
                        }
                    }
                    let _ = backup::retry(&core.root);
                    drop(_backup);
                    drop(_gate);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![request, print_page])
        .run(tauri::generate_context!())
        .expect("Unable to start Radefy Pharmacy");
}
