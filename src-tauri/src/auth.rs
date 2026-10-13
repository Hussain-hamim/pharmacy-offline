use crate::db::*;
use argon2::{password_hash::SaltString, Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use rand_core::OsRng;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const MODULES: &[&str] = &[
    "dashboard",
    "products",
    "stock",
    "customers",
    "suppliers",
    "purchases",
    "sales",
    "payments",
    "returns",
    "expenses",
    "reports",
    "users",
    "settings",
    "backups",
    "audit",
];
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Actor {
    pub id: i64,
    pub username: String,
    pub name: String,
    pub role: String,
    pub permissions: Value,
    pub revision: i64,
}
pub fn preset(role: &str) -> Value {
    let mut m = serde_json::Map::new();
    for k in MODULES {
        let mode = match role {
            "Administrator" => "write",
            "Cashier" => match *k {
                "dashboard" | "products" | "stock" => "read",
                "customers" | "sales" | "payments" => "write",
                _ => "none",
            },
            "Inventory" => match *k {
                "dashboard" | "suppliers" => "read",
                "products" | "stock" | "purchases" => "write",
                _ => "none",
            },
            "Accountant" => match *k {
                "dashboard" | "customers" | "suppliers" | "purchases" | "sales" | "reports" => {
                    "read"
                }
                "payments" | "expenses" => "write",
                _ => "none",
            },
            _ => "none",
        };
        m.insert(k.to_string(), json!(mode));
    }
    m.insert(
        "costs".into(),
        json!(matches!(role, "Administrator" | "Accountant" | "Inventory")),
    );
    m.insert("reversals".into(), json!(role == "Administrator"));
    m.insert("restore".into(), json!(role == "Administrator"));
    Value::Object(m)
}
pub fn check(a: &Actor, module: &str, write: bool) -> Result<()> {
    if a.role == "Administrator" {
        return Ok(());
    }
    let v = a.permissions[module].as_str().unwrap_or("none");
    if v == "write" || (!write && v == "read") {
        Ok(())
    } else {
        err("PERMISSION", "You do not have permission for this action")
    }
}
pub fn special(a: &Actor, key: &str) -> Result<()> {
    if a.role == "Administrator" || a.permissions[key].as_bool() == Some(true) {
        Ok(())
    } else {
        err("PERMISSION", "This action requires additional permission")
    }
}
pub fn hash(password: &str) -> Result<String> {
    require(
        password.chars().count() >= 8,
        "Password must contain at least 8 characters",
    )?;
    Argon2::default()
        .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
        .map(|v| v.to_string())
        .map_err(|_| AppError {
            code: "AUTH".into(),
            message: "Could not secure password".into(),
        })
}
pub fn actor(c: &Connection, id: i64) -> Result<Actor> {
    let raw = c
        .query_row(
            "SELECT id,username,name,role,permissions,revision FROM users WHERE id=? AND active=1",
            [id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get::<_, String>(4)?,
                    r.get(5)?,
                ))
            },
        )
        .optional()?
        .ok_or(AppError {
            code: "AUTH".into(),
            message: "Please sign in again".into(),
        })?;
    Ok(Actor {
        id: raw.0,
        username: raw.1,
        name: raw.2,
        role: raw.3,
        permissions: serde_json::from_str(&raw.4)?,
        revision: raw.5,
    })
}
pub fn login(c: &Connection, username: &str, password: &str) -> Result<Actor> {
    let row = c
        .query_row(
            "SELECT id,password_hash FROM users WHERE username=? COLLATE NOCASE AND active=1",
            [username.trim()],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()?;
    if let Some((id, hash)) = row {
        if PasswordHash::new(&hash).ok().is_some_and(|h| {
            Argon2::default()
                .verify_password(password.as_bytes(), &h)
                .is_ok()
        }) {
            return actor(c, id);
        }
    }
    err("AUTH", "Username or password is incorrect")
}
#[derive(Deserialize)]
pub struct UserInput {
    pub id: Option<i64>,
    pub revision: Option<i64>,
    pub username: String,
    pub name: String,
    pub password: Option<String>,
    pub role: String,
    pub permissions: Option<Value>,
    #[serde(default = "yes")]
    pub active: bool,
}
fn yes() -> bool {
    true
}
pub fn save_user(c: &Connection, a: Option<&Actor>, p: Value) -> Result<Value> {
    if let Some(a) = a {
        check(a, "users", true)?;
    }
    let p: UserInput = serde_json::from_value(p)?;
    if let Some(a) = a {
        check(a, "users", true)?
    } else {
        let count: i64 = c.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
        require(count == 0, "Setup already completed")?;
        require(
            p.role == "Administrator" && p.active,
            "First user must be an active administrator",
        )?;
    }
    require(
        !p.name.trim().is_empty() && !p.username.trim().is_empty(),
        "Name and username are required",
    )?;
    require(
        [
            "Administrator",
            "Cashier",
            "Inventory",
            "Accountant",
            "Custom",
        ]
        .contains(&p.role.as_str()),
        "Invalid role",
    )?;
    let permissions = p.permissions.unwrap_or_else(|| preset(&p.role));
    for k in MODULES {
        require(
            matches!(permissions[k].as_str(), Some("none" | "read" | "write")),
            "Invalid permission",
        )?;
    }
    let id = if let Some(id) = p.id {
        let old: (String, i64) =
            c.query_row("SELECT role,active FROM users WHERE id=?", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?;
        if old.0 == "Administrator" && old.1 == 1 && (p.role != "Administrator" || !p.active) {
            let others: i64 = c.query_row(
                "SELECT COUNT(*) FROM users WHERE role='Administrator' AND active=1 AND id!=?",
                [id],
                |r| r.get(0),
            )?;
            require(others > 0, "Cannot remove the last administrator")?;
        }
        let n=c.execute("UPDATE users SET username=?,name=?,role=?,permissions=?,active=?,revision=revision+1 WHERE id=? AND revision=?",params![p.username.trim(),p.name.trim(),p.role,permissions.to_string(),p.active,id,p.revision])?;
        require(n == 1, "Record changed. Reload before saving")?;
        if let Some(pass) = p.password.filter(|s| !s.is_empty()) {
            c.execute(
                "UPDATE users SET password_hash=? WHERE id=?",
                params![hash(&pass)?, id],
            )?;
        }
        id
    } else {
        let password = hash(p.password.as_deref().unwrap_or(""))?;
        c.execute("INSERT INTO users(username,name,password_hash,role,permissions,active) VALUES(?,?,?,?,?,?)",params![p.username.trim(),p.name.trim(),password,p.role,permissions.to_string(),p.active])?;
        c.last_insert_rowid()
    };
    audit(
        c,
        a.map(|a| a.id).unwrap_or(id),
        "save",
        "users",
        id,
        json!({"role":p.role,"active":p.active}),
    )?;
    Ok(json!({"id":id}))
}
