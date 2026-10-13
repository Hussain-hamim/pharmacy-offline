use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppError {
    pub code: String,
    pub message: String,
}
pub type Result<T> = std::result::Result<T, AppError>;
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for AppError {}
impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        Self {
            code: "DATABASE".into(),
            message: e.to_string(),
        }
    }
}
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self {
            code: "STORAGE".into(),
            message: e.to_string(),
        }
    }
}
impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self {
            code: "VALIDATION".into(),
            message: e.to_string(),
        }
    }
}
pub fn err<T>(code: &str, message: &str) -> Result<T> {
    Err(AppError {
        code: code.into(),
        message: message.into(),
    })
}
pub fn require(test: bool, message: &str) -> Result<()> {
    if test {
        Ok(())
    } else {
        err("VALIDATION", message)
    }
}
pub fn open(path: &Path) -> Result<Connection> {
    let c = Connection::open(path)?;
    c.busy_timeout(Duration::from_secs(5))?;
    c.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
    Ok(c)
}
pub fn init(path: &Path) -> Result<()> {
    let mut c = open(path)?;
    c.execute_batch("PRAGMA journal_mode=WAL;")?;
    let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    require(
        version <= 1,
        "Database belongs to a newer application version",
    )?;
    c.execute_batch("BEGIN IMMEDIATE;")?;
    c.execute_batch(include_str!("schema.sql"))?;
    c.execute_batch("PRAGMA user_version=1; COMMIT;")?;
    refresh_expired(&mut c)?;
    Ok(())
}
// Cached sellable stock changes at midnight even when no bill is posted.
pub fn refresh_expired(c: &mut Connection) -> Result<()> {
    use rusqlite::OptionalExtension;
    let day = today();
    let previous: Option<String> = c
        .query_row(
            "SELECT value FROM settings WHERE key='stock_day'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if previous.as_deref() == Some(&day) {
        return Ok(());
    }
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    // Only products whose batches crossed expiry require a balance refresh.
    tx.execute("UPDATE products SET on_hand=COALESCE((SELECT SUM(quantity) FROM batches WHERE product_id=products.id AND status='sellable' AND expiry>=?),0) WHERE id IN (SELECT product_id FROM batches WHERE expiry>=? AND expiry<? AND status='sellable' AND quantity>0)", params![day,previous.unwrap_or_default(),day])?;
    tx.execute("INSERT INTO settings(key,value) VALUES('stock_day',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [&day])?;
    tx.commit()?;
    Ok(())
}
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
pub fn today() -> String {
    (chrono::Utc::now() + chrono::Duration::minutes(270))
        .format("%Y-%m-%d")
        .to_string()
}
pub fn valid_date(s: &str) -> Result<()> {
    let parsed = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| AppError {
        code: "VALIDATION".into(),
        message: "Invalid Gregorian date".into(),
    })?;
    require(
        parsed.format("%Y-%m-%d").to_string() == s,
        "Invalid Gregorian date",
    )?;
    Ok(())
}
pub fn normalize(s: &str) -> String {
    s.nfkc()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'ي' | 'ى' => 'ی',
            'ك' => 'ک',
            '\u{200c}' => ' ',
            _ => c,
        })
        .filter(|c| !matches!(*c, '\u{064b}'..='\u{065f}' | '\u{0640}'))
        .collect()
}
pub fn money(s: &str) -> Result<i64> {
    let s = s.trim();
    require(!s.is_empty() && s.len() < 17, "Enter a valid amount")?;
    let negative = s.starts_with('-');
    let raw = s.strip_prefix('-').unwrap_or(s);
    let p: Vec<_> = raw.split('.').collect();
    require(
        p.len() <= 2 && p[0].chars().all(|c| c.is_ascii_digit()),
        "Invalid amount",
    )?;
    let whole = p[0].parse::<i64>().map_err(|_| AppError {
        code: "VALIDATION".into(),
        message: "Invalid amount".into(),
    })?;
    let frac = if p.len() == 2 {
        require(
            p[1].len() <= 2 && p[1].chars().all(|c| c.is_ascii_digit()),
            "Use at most two decimal places",
        )?;
        format!("{:0<2}", p[1]).parse::<i64>().unwrap_or(0)
    } else {
        0
    };
    let n = whole
        .checked_mul(100)
        .and_then(|n| n.checked_add(frac))
        .ok_or(AppError {
            code: "VALIDATION".into(),
            message: "Amount too large".into(),
        })?;
    require(n <= 9_000_000_000_000, "Amount exceeds supported range")?;
    Ok(if negative { -n } else { n })
}
pub fn allocate(total: i64, weights: &[i64]) -> Vec<i64> {
    let sum: i64 = weights.iter().sum();
    if sum == 0 {
        return vec![0; weights.len()];
    };
    let mut out: Vec<i64> = weights
        .iter()
        .map(|w| ((total as i128 * *w as i128) / sum as i128) as i64)
        .collect();
    let mut left = total - out.iter().sum::<i64>();
    for (i, w) in weights.iter().enumerate() {
        if left == 0 {
            break;
        }
        if *w > 0 {
            out[i] += 1;
            left -= 1;
        }
    }
    out
}
pub fn json_rows(c: &Connection, sql: &str, p: &[&dyn rusqlite::ToSql]) -> Result<Vec<Value>> {
    let mut stmt = c.prepare(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt
        .query_map(p, |r| {
            let mut m = serde_json::Map::new();
            for (i, n) in names.iter().enumerate() {
                let v = match r.get_ref(i)? {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(v) => json!(v),
                    rusqlite::types::ValueRef::Real(v) => json!(v),
                    rusqlite::types::ValueRef::Text(v) => {
                        Value::String(String::from_utf8_lossy(v).into())
                    }
                    _ => Value::Null,
                };
                m.insert(n.clone(), v);
            }
            Ok(Value::Object(m))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub fn settings(c: &Connection) -> Result<Value> {
    let raw: String = c.query_row("SELECT value FROM settings WHERE key='pharmacy'", [], |r| {
        r.get(0)
    })?;
    Ok(serde_json::from_str(&raw)?)
}
pub fn audit(
    c: &Connection,
    user: i64,
    action: &str,
    entity: &str,
    id: impl ToString,
    detail: Value,
) -> Result<()> {
    c.execute(
        "INSERT INTO audit(user_id,action,entity,entity_id,detail) VALUES(?,?,?,?,?)",
        params![user, action, entity, id.to_string(), detail.to_string()],
    )?;
    Ok(())
}
pub fn account(
    c: &Connection,
    party: i64,
    doc: Option<i64>,
    pay: Option<i64>,
    amount: i64,
    reason: &str,
) -> Result<()> {
    c.execute(
        "UPDATE parties SET balance_minor=balance_minor+? WHERE id=?",
        params![amount, party],
    )?;
    c.execute("INSERT INTO account_movements(party_id,document_id,payment_id,amount_minor,reason) VALUES(?,?,?,?,?)",params![party,doc,pay,amount,reason])?;
    Ok(())
}
pub fn daily(c: &Connection, date: &str, column: &str, amount: i64) -> Result<()> {
    require(
        [
            "sales_minor",
            "purchases_minor",
            "returns_minor",
            "supplier_returns_minor",
            "cost_minor",
            "expenses_minor",
            "receipts_minor",
            "payments_minor",
            "discounts_minor",
            "sale_count",
        ]
        .contains(&column),
        "Invalid summary",
    )?;
    c.execute("INSERT OR IGNORE INTO daily_totals(date) VALUES(?)", [date])?;
    c.execute(
        &format!("UPDATE daily_totals SET {column}={column}+? WHERE date=?"),
        params![amount, date],
    )?;
    Ok(())
}
#[allow(clippy::too_many_arguments)]
pub fn movement(
    c: &Connection,
    user: i64,
    product: i64,
    batch: i64,
    doc: Option<i64>,
    qty: i64,
    cost: i64,
    reason: &str,
) -> Result<()> {
    c.execute("INSERT INTO stock_movements(product_id,batch_id,document_id,quantity,cost_minor,reason,actor_id) VALUES(?,?,?,?,?,?,?)",params![product,batch,doc,qty,cost,reason,user])?;
    c.execute("UPDATE products SET on_hand=(SELECT COALESCE(SUM(quantity),0) FROM batches WHERE product_id=? AND status='sellable' AND expiry>=date('now','+4 hours','+30 minutes')) WHERE id=?",params![product,product])?;
    Ok(())
}
