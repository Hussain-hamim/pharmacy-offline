use crate::{
    auth::{self, Actor},
    db::*,
};
use rusqlite::{types::Value as SqlValue, Connection};
use serde_json::{json, Value};

fn condition(extra: &mut String, args: &mut Vec<SqlValue>, sql: &str, value: SqlValue) {
    extra.push_str(" AND ");
    extra.push_str(sql);
    args.push(value);
}
pub fn list(c: &Connection, a: &Actor, p: Value) -> Result<Value> {
    let entity = p["entity"].as_str().unwrap_or("");
    let reporting = p["report"].as_bool() == Some(true);
    let module = match entity {
        "profit" => "reports",
        "products" => "products",
        "batches" | "movements" | "alerts" => "stock",
        "customers" => "customers",
        "suppliers" => "suppliers",
        "sales" => "sales",
        "purchases" => "purchases",
        "returns" => "returns",
        "payments" | "ledger" => "payments",
        "expenses" => "expenses",
        "users" => "users",
        "categories" => {
            if p["kind"] == "supplier_type" {
                "suppliers"
            } else {
                "expenses"
            }
        }
        "audit" => "audit",
        "backups" => "backups",
        "drafts" => "",
        _ => return err("VALIDATION", "Unknown list"),
    };
    if reporting {
        require(
            !["users", "audit", "backups", "drafts", "categories"].contains(&entity),
            "Unsupported report",
        )?;
        auth::check(a, "reports", false)?;
    } else if !module.is_empty() {
        auth::check(a, module, false)?;
    }
    let limit = p["limit"].as_i64().unwrap_or(50).clamp(1, 100);
    let search = normalize(p["search"].as_str().unwrap_or("").trim());
    let mut args: Vec<SqlValue> = Vec::new();
    let mut extra = String::new();
    let (select, from, key): (&str, &str, &str) = match entity {
        "profit" => {
            auth::special(a, "costs")?;
            ("d.date AS id,d.*,(sales_minor-returns_minor-cost_minor) AS gross_profit_minor,(sales_minor-returns_minor-cost_minor-expenses_minor) AS operating_profit_minor", "daily_totals d", "d.date")
        }
        "products" => {
            if !search.is_empty() {
                condition(&mut extra,&mut args,"(p.barcode=? OR p.id IN (SELECT rowid FROM product_search WHERE product_search MATCH ?))",search.clone().into());
                let terms = search
                    .split_whitespace()
                    .map(|s| format!("\"{}\"*", s.replace('"', "\"\"")))
                    .collect::<Vec<_>>()
                    .join(" AND ");
                args.push(terms.into());
            }
            if p["active"].as_bool() == Some(true) {
                extra.push_str(" AND p.active=1");
            }
            if p["low"].as_bool() == Some(true) {
                extra.push_str(" AND p.on_hand<=p.reorder_level AND p.active=1");
            }
            ("p.*, (SELECT price_minor FROM product_units WHERE product_id=p.id AND active=1 ORDER BY multiplier,id LIMIT 1) AS price_minor","products p","p.id")
        }
        "customers" | "suppliers" => {
            condition(
                &mut extra,
                &mut args,
                "p.kind=?",
                if entity == "customers" {
                    "customer"
                } else {
                    "supplier"
                }
                .to_string()
                .into(),
            );
            if !search.is_empty() {
                condition(
                    &mut extra,
                    &mut args,
                    "p.search_name>=?",
                    search.clone().into(),
                );
                condition(
                    &mut extra,
                    &mut args,
                    "p.search_name<?",
                    format!("{search}\u{10ffff}").into(),
                );
            }
            if p["active"].as_bool() == Some(true) {
                extra.push_str(" AND p.active=1");
            }
            (
                "p.*,cat.name AS type_name",
                "parties p LEFT JOIN categories cat ON cat.id=p.type_id",
                "p.id",
            )
        }
        "sales" | "purchases" | "returns" => {
            if entity == "returns" {
                extra.push_str(" AND d.kind IN ('customer_return','supplier_return')");
            } else {
                condition(
                    &mut extra,
                    &mut args,
                    "d.kind=?",
                    if entity == "sales" {
                        "sale"
                    } else {
                        "purchase"
                    }
                    .to_string()
                    .into(),
                );
            }
            if !search.is_empty() {
                condition(
                    &mut extra,
                    &mut args,
                    "d.number>=?",
                    search.to_uppercase().into(),
                );
                condition(
                    &mut extra,
                    &mut args,
                    "d.number<?",
                    format!("{}\u{10ffff}", search.to_uppercase()).into(),
                );
            }
            if let Some(id) = p["party_id"].as_i64() {
                condition(&mut extra, &mut args, "d.party_id=?", id.into());
            }
            if p["discounted"].as_bool() == Some(true) {
                extra.push_str(" AND d.discount_minor>0");
            }
            if p["unpaid"].as_bool() == Some(true) {
                extra.push_str(" AND d.outstanding_minor>0");
            }
            ("d.id,d.kind,d.number,d.date,d.party_id,COALESCE(p.name,'Walk-in customer') AS party_name,d.total_minor,d.discount_minor,d.paid_minor,d.credit_minor,d.outstanding_minor,d.returned_minor,d.cost_minor,d.created_at","documents d LEFT JOIN parties p ON p.id=d.party_id","d.id")
        }
        "batches" | "alerts" => {
            if let Some(id) = p["product_id"].as_i64() {
                condition(&mut extra, &mut args, "b.product_id=?", id.into());
            }
            extra.push_str(" AND b.quantity>0");
            if entity == "alerts" {
                let days = settings(c)?["expiry_days"].as_i64().unwrap_or(90);
                let until = (chrono::Utc::now()
                    + chrono::Duration::minutes(270)
                    + chrono::Duration::days(days))
                .format("%Y-%m-%d")
                .to_string();
                condition(&mut extra, &mut args, "b.expiry<=?", until.into());
            }
            if !search.is_empty() {
                condition(
                    &mut extra,
                    &mut args,
                    "p.search_name>=?",
                    search.clone().into(),
                );
                condition(
                    &mut extra,
                    &mut args,
                    "p.search_name<?",
                    format!("{search}\u{10ffff}").into(),
                );
            }
            (
                "b.*,p.name AS product_name,p.base_unit,p.shelf",
                "batches b JOIN products p ON p.id=b.product_id",
                "b.id",
            )
        }
        "movements" => {
            if let Some(id) = p["product_id"].as_i64() {
                condition(&mut extra, &mut args, "m.product_id=?", id.into());
            }
            ("m.*,p.name AS product_name,b.number AS batch_number,u.name AS user_name","stock_movements m JOIN products p ON p.id=m.product_id JOIN batches b ON b.id=m.batch_id JOIN users u ON u.id=m.actor_id","m.id")
        }
        "payments" => {
            if let Some(id) = p["party_id"].as_i64() {
                condition(&mut extra, &mut args, "m.party_id=?", id.into());
            }
            ("m.*,COALESCE(p.name,'Walk-in customer') AS party_name,d.number AS document_number","payments m LEFT JOIN parties p ON p.id=m.party_id LEFT JOIN documents d ON d.id=m.document_id","m.id")
        }
        "ledger" => {
            let id = p["party_id"].as_i64().unwrap_or(0);
            condition(&mut extra, &mut args, "m.party_id=?", id.into());
            (
                "m.*,d.number AS document_number",
                "account_movements m LEFT JOIN documents d ON d.id=m.document_id",
                "m.id",
            )
        }
        "expenses" => (
            "e.*,c.name AS category_name,u.name AS user_name",
            "expenses e JOIN categories c ON c.id=e.category_id JOIN users u ON u.id=e.actor_id",
            "e.id",
        ),
        "categories" => {
            condition(
                &mut extra,
                &mut args,
                "c.kind=?",
                p["kind"].as_str().unwrap_or("expense").to_string().into(),
            );
            if !search.is_empty() {
                condition(
                    &mut extra,
                    &mut args,
                    "c.name LIKE ?",
                    format!("{search}%").into(),
                );
            }
            ("c.*", "categories c", "c.id")
        }
        "users" => (
            "u.id,u.username,u.name,u.role,u.permissions,u.active,u.revision,u.created_at",
            "users u",
            "u.id",
        ),
        "audit" => (
            "m.*,u.name AS user_name",
            "audit m LEFT JOIN users u ON u.id=m.user_id",
            "m.id",
        ),
        "backups" => ("b.*", "backups b", "b.id"),
        "drafts" => {
            condition(&mut extra, &mut args, "d.user_id=?", a.id.into());
            (
                "d.id,d.kind,d.title,d.revision,d.updated_at",
                "drafts d",
                "(d.updated_at || '|' || d.id)",
            )
        }
        _ => unreachable!(),
    };
    let datefield = match entity {
        "sales" | "purchases" | "returns" | "profit" => Some("d.date"),
        "payments" => Some("m.date"),
        "expenses" => Some("e.date"),
        "movements" | "audit" | "ledger" => Some("substr(m.created_at,1,10)"),
        _ => None,
    };
    if let Some(field) = datefield {
        for (k, op) in [("from", ">="), ("to", "<=")] {
            if let Some(date) = p[k].as_str().filter(|s| !s.is_empty()) {
                valid_date(date)?;
                extra.push_str(&format!(" AND {field}{op}?"));
                args.push(date.to_string().into());
            }
        }
    }
    if !search.is_empty() {
        let clause = match entity {
            "movements" => Some("p.search_name LIKE ?"),
            "payments" => Some("(p.search_name LIKE ? OR d.number LIKE ?)"),
            "expenses" => Some("(c.name LIKE ? OR e.note LIKE ?)"),
            "users" => Some("(u.name LIKE ? OR u.username LIKE ?)"),
            "audit" => Some("(m.action LIKE ? OR m.entity LIKE ? OR u.name LIKE ?)"),
            "backups" => Some("(b.destination LIKE ? OR b.status LIKE ?)"),
            "drafts" => Some("d.title LIKE ?"),
            _ => None,
        };
        if let Some(clause) = clause {
            extra.push_str(" AND ");
            extra.push_str(clause);
            for _ in 0..clause.matches('?').count() {
                args.push(format!("{search}%").into());
            }
        }
    }
    if entity == "payments" {
        if let Some(kind) = p["payment_kind"].as_str() {
            condition(&mut extra, &mut args, "m.kind=?", kind.to_string().into());
        }
    }
    let asc = p["sort"].as_str() == Some("oldest");
    let backwards = p["direction"].as_str() == Some("previous");
    let ascending = asc ^ backwards;
    if let Some(cursor) = p["cursor"].as_str() {
        extra.push_str(&format!(" AND {key}{}?", if ascending { ">" } else { "<" }));
        args.push(if entity == "drafts" || entity == "profit" {
            cursor.to_string().into()
        } else {
            SqlValue::Integer(cursor.parse().map_err(|_| AppError {
                code: "VALIDATION".into(),
                message: "Invalid page cursor".into(),
            })?)
        });
    }
    let sql = format!(
        "SELECT {select},{key} AS _cursor FROM {from} WHERE 1=1{extra} ORDER BY {key} {} LIMIT ?",
        if ascending { "ASC" } else { "DESC" }
    );
    args.push((limit + 1).into());
    let refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    let mut rows = json_rows(c, &sql, &refs)?;
    let more = rows.len() > limit as usize;
    if more {
        rows.pop();
    }
    if backwards {
        rows.reverse();
    }
    let cursor_of = |r: &Value| -> String {
        match &r["_cursor"] {
            Value::String(v) => v.clone(),
            v => v.to_string(),
        }
    };
    let next = if (!backwards && more) || backwards {
        rows.last().map(cursor_of)
    } else {
        None
    };
    let previous = if p["cursor"].is_string() && (!backwards || more) {
        rows.first().map(cursor_of)
    } else {
        None
    };
    for row in &mut rows {
        redact(a, row);
    }
    Ok(json!({"items":rows,"next_cursor":next,"previous_cursor":previous,"limit":limit}))
}

pub fn redact(a: &Actor, v: &mut Value) {
    if a.role != "Administrator" && a.permissions["costs"].as_bool() != Some(true) {
        if let Some(obj) = v.as_object_mut() {
            for key in [
                "cost_minor",
                "stock_value_minor",
                "gross_profit_minor",
                "operating_profit_minor",
            ] {
                obj.remove(key);
            }
        }
    }
    if let Some(obj) = v.as_object_mut() {
        for key in ["permissions", "payload", "pharmacy_snapshot", "detail"] {
            if let Some(raw) = obj.get(key).and_then(Value::as_str) {
                if let Ok(parsed) = serde_json::from_str(raw) {
                    obj.insert(key.into(), parsed);
                }
            }
        }
    }
}
pub fn detail(c: &Connection, a: &Actor, p: Value) -> Result<Value> {
    let entity = p["entity"].as_str().unwrap_or("");
    let id = p["id"].as_i64().unwrap_or(0);
    match entity {
        "product" => {
            auth::check(a, "products", false)?;
            let mut item = json_rows(c, "SELECT * FROM products WHERE id=?", &[&id])?
                .pop()
                .ok_or(AppError {
                    code: "NOT_FOUND".into(),
                    message: "Product not found".into(),
                })?;
            item["units"]=json!(json_rows(c,"SELECT * FROM product_units WHERE product_id=? AND active=1 ORDER BY multiplier,id",&[&id])?);
            Ok(item)
        }
        "party" => {
            let item=json_rows(c,"SELECT p.*,c.name AS type_name FROM parties p LEFT JOIN categories c ON c.id=p.type_id WHERE p.id=?",&[&id])?.pop().ok_or(AppError{code:"NOT_FOUND".into(),message:"Account not found".into()})?;
            auth::check(
                a,
                if item["kind"] == "customer" {
                    "customers"
                } else {
                    "suppliers"
                },
                false,
            )?;
            Ok(item)
        }
        "document" => {
            let mut doc=json_rows(c,"SELECT d.*,COALESCE(p.name,'Walk-in customer') AS party_name,p.phone AS party_phone,p.address AS party_address,u.name AS user_name FROM documents d LEFT JOIN parties p ON p.id=d.party_id JOIN users u ON u.id=d.actor_id WHERE d.id=?",&[&id])?.pop().ok_or(AppError{code:"NOT_FOUND".into(),message:"Invoice not found".into()})?;
            let kind = doc["kind"].as_str().unwrap();
            if auth::check(a, crate::master::kind_module(kind), false).is_err() {
                auth::check(a, "returns", false)?;
            }
            let mut lines = json_rows(
                c,
                "SELECT * FROM document_lines WHERE document_id=? ORDER BY id",
                &[&id],
            )?;
            for line in &mut lines {
                let lid = line["id"].as_i64().unwrap();
                let mut allocs=json_rows(c,"SELECT a.quantity,a.cost_minor,b.number,b.expiry FROM allocations a JOIN batches b ON b.id=a.batch_id WHERE a.line_id=? ORDER BY a.id",&[&lid])?;
                for v in &mut allocs {
                    redact(a, v);
                }
                line["allocations"] = json!(allocs);
                redact(a, line);
            }
            doc["lines"] = json!(lines);
            redact(a, &mut doc);
            Ok(doc)
        }
        "draft" => {
            let did = p["id"].as_str().unwrap_or("");
            let mut item = json_rows(
                c,
                "SELECT * FROM drafts WHERE id=? AND user_id=?",
                &[&did, &a.id],
            )?
            .pop()
            .ok_or(AppError {
                code: "NOT_FOUND".into(),
                message: "Draft not found".into(),
            })?;
            auth::check(
                a,
                crate::master::kind_module(item["kind"].as_str().unwrap_or("")),
                true,
            )?;
            redact(a, &mut item);
            Ok(item)
        }
        "user" => {
            auth::check(a, "users", false)?;
            let mut item = json_rows(
                c,
                "SELECT id,username,name,role,permissions,active,revision FROM users WHERE id=?",
                &[&id],
            )?
            .pop()
            .ok_or(AppError {
                code: "NOT_FOUND".into(),
                message: "User not found".into(),
            })?;
            redact(a, &mut item);
            Ok(item)
        }
        _ => err("VALIDATION", "Unknown detail request"),
    }
}

pub fn dashboard(c: &Connection, a: &Actor, p: Value) -> Result<Value> {
    let report = p["report"].as_bool() == Some(true);
    auth::check(a, if report { "reports" } else { "dashboard" }, false)?;
    let today = today();
    let default_from = (chrono::Utc::now() + chrono::Duration::minutes(270)
        - chrono::Duration::days(29))
    .format("%Y-%m-%d")
    .to_string();
    let from = p["from"]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or(&default_from);
    let to = p["to"].as_str().filter(|s| !s.is_empty()).unwrap_or(&today);
    valid_date(from)?;
    valid_date(to)?;
    let mut totals=json_rows(c,"SELECT COALESCE(SUM(sales_minor),0) AS sales_minor,COALESCE(SUM(purchases_minor),0) AS purchases_minor,COALESCE(SUM(returns_minor),0) AS returns_minor,COALESCE(SUM(supplier_returns_minor),0) AS supplier_returns_minor,COALESCE(SUM(cost_minor),0) AS cost_minor,COALESCE(SUM(expenses_minor),0) AS expenses_minor,COALESCE(SUM(receipts_minor),0) AS receipts_minor,COALESCE(SUM(payments_minor),0) AS payments_minor,COALESCE(SUM(discounts_minor),0) AS discounts_minor,COALESCE(SUM(sale_count),0) AS sale_count FROM daily_totals WHERE date>=? AND date<=?",&[&from,&to])?.pop().unwrap();
    let sales = totals["sales_minor"].as_i64().unwrap();
    let returns = totals["returns_minor"].as_i64().unwrap();
    let cost = totals["cost_minor"].as_i64().unwrap();
    totals["gross_profit_minor"] = json!(sales - returns - cost);
    totals["operating_profit_minor"] =
        json!(sales - returns - cost - totals["expenses_minor"].as_i64().unwrap());
    let stock=json_rows(c,"SELECT COALESCE(SUM(quantity),0) AS stock_units,COALESCE(SUM(cost_minor),0) AS stock_value_minor,COUNT(*) AS active_batches FROM batches WHERE quantity>0",&[])?.pop().unwrap();
    totals
        .as_object_mut()
        .unwrap()
        .extend(stock.as_object().unwrap().clone());
    let parties=json_rows(c,"SELECT COALESCE(SUM(CASE WHEN kind='customer' AND balance_minor>0 THEN balance_minor ELSE 0 END),0) AS receivables_minor,COALESCE(SUM(CASE WHEN kind='supplier' AND balance_minor>0 THEN balance_minor ELSE 0 END),0) AS payables_minor FROM parties",&[])?.pop().unwrap();
    totals
        .as_object_mut()
        .unwrap()
        .extend(parties.as_object().unwrap().clone());
    let low: i64 = c.query_row(
        "SELECT COUNT(*) FROM products WHERE active=1 AND on_hand<=reorder_level",
        [],
        |r| r.get(0),
    )?;
    let cutoff = (chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d").unwrap()
        + chrono::Duration::days(settings(c)?["expiry_days"].as_i64().unwrap_or(90)))
    .to_string();
    let expiry: i64 = c.query_row(
        "SELECT COUNT(*) FROM batches WHERE quantity>0 AND expiry<=?",
        [&cutoff],
        |r| r.get(0),
    )?;
    totals["low_stock_count"] = json!(low);
    totals["expiry_count"] = json!(expiry);
    let trend = json_rows(
        c,
        "SELECT * FROM daily_totals WHERE date>=? AND date<=? ORDER BY date",
        &[&from, &to],
    )?;
    let mut recent=json_rows(c,"SELECT d.id,d.number,d.date,COALESCE(p.name,'Walk-in customer') AS party_name,d.total_minor,d.outstanding_minor FROM documents d LEFT JOIN parties p ON p.id=d.party_id WHERE d.kind='sale' ORDER BY d.id DESC LIMIT 5",&[])?;
    if auth::check(a, "sales", false).is_err() {
        recent.clear();
    }
    let low_items=json_rows(c,"SELECT id,name,base_unit,on_hand,reorder_level FROM products WHERE active=1 AND on_hand<=reorder_level ORDER BY id DESC LIMIT 4",&[])?;
    let mut trend = trend;
    for row in &mut trend {
        redact(a, row);
    }
    redact(a, &mut totals);
    Ok(
        json!({"totals":totals,"trend":trend,"recent":recent,"low_stock":low_items,"from":from,"to":to}),
    )
}
