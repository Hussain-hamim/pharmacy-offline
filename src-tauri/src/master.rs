use crate::{
    auth::{self, Actor},
    db::*,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct PartyInput {
    pub id: Option<i64>,
    pub revision: Option<i64>,
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub address: String,
    pub type_id: Option<i64>,
    #[serde(default)]
    pub opening: String,
    #[serde(default = "yes")]
    pub active: bool,
}
fn yes() -> bool {
    true
}
pub fn party(c: &Connection, a: &Actor, p: Value) -> Result<Value> {
    let p: PartyInput = serde_json::from_value(p)?;
    require(
        ["customer", "supplier"].contains(&p.kind.as_str()),
        "Invalid party type",
    )?;
    auth::check(
        a,
        if p.kind == "customer" {
            "customers"
        } else {
            "suppliers"
        },
        true,
    )?;
    require(!p.name.trim().is_empty(), "Name is required")?;
    if let Some(t) = p.type_id {
        let valid: i64 = c.query_row(
            "SELECT COUNT(*) FROM categories WHERE id=? AND kind='supplier_type'",
            [t],
            |r| r.get(0),
        )?;
        require(valid == 1, "Invalid supplier type")?;
    }
    let id = if let Some(id) = p.id {
        let n=c.execute("UPDATE parties SET name=?,search_name=?,phone=?,address=?,type_id=?,active=?,revision=revision+1 WHERE id=? AND kind=? AND revision=?",params![p.name.trim(),normalize(&p.name),p.phone,p.address,p.type_id,p.active,id,p.kind,p.revision])?;
        require(n == 1, "Record changed. Reload before saving")?;
        id
    } else {
        let opening = money(if p.opening.is_empty() {
            "0"
        } else {
            &p.opening
        })?;
        c.execute("INSERT INTO parties(kind,name,search_name,phone,address,type_id,opening_minor) VALUES(?,?,?,?,?,?,?)",params![p.kind,p.name.trim(),normalize(&p.name),p.phone,p.address,p.type_id,opening])?;
        let id = c.last_insert_rowid();
        if opening != 0 {
            account(c, id, None, None, opening, "opening_balance")?;
        }
        id
    };
    audit(c, a.id, "save", "parties", id, json!({"kind":p.kind}))?;
    let balance: i64 = c.query_row("SELECT balance_minor FROM parties WHERE id=?", [id], |r| {
        r.get(0)
    })?;
    Ok(json!({"id":id, "name":p.name.trim(), "balance_minor":balance}))
}
#[derive(Deserialize)]
pub struct UnitInput {
    pub name: String,
    pub multiplier: i64,
    pub price: String,
}
#[derive(Deserialize)]
pub struct OpeningStockInput {
    pub quantity: i64,
    #[serde(default)]
    pub batch_number: String,
    #[serde(default)]
    pub expiry: String,
    #[serde(default)]
    pub total_cost: String,
}
#[derive(Deserialize)]
pub struct ProductInput {
    pub id: Option<i64>,
    pub revision: Option<i64>,
    pub name: String,
    #[serde(default)]
    pub generic: String,
    #[serde(default)]
    pub strength: String,
    #[serde(default)]
    pub form: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub manufacturer: String,
    #[serde(default)]
    pub barcode: String,
    #[serde(default)]
    pub shelf: String,
    pub base_unit: String,
    pub reorder_level: i64,
    #[serde(default = "yes")]
    pub active: bool,
    pub units: Vec<UnitInput>,
    pub opening_stock: Option<OpeningStockInput>,
}
pub fn product(c: &Connection, a: &Actor, p: Value) -> Result<Value> {
    auth::check(a, "products", true)?;
    let p: ProductInput = serde_json::from_value(p)?;
    require(
        !p.name.trim().is_empty() && !p.base_unit.trim().is_empty(),
        "Product name and base unit are required",
    )?;
    require(p.reorder_level >= 0, "Reorder level cannot be negative")?;
    if let Some(stock) = &p.opening_stock {
        require(
            (0..=1_000_000_000).contains(&stock.quantity),
            "Invalid base quantity",
        )?;
        require(
            p.id.is_none() || stock.quantity == 0,
            "Opening stock can only be added when creating a product",
        )?;
    }
    require(
        !p.units.is_empty() && p.units.iter().any(|u| u.multiplier == 1),
        "A base unit with multiplier 1 is required",
    )?;
    let mut names = std::collections::HashSet::new();
    for u in &p.units {
        require(
            !u.name.trim().is_empty() && u.multiplier > 0 && u.multiplier <= 1_000_000,
            "Invalid unit",
        )?;
        require(
            names.insert(u.name.trim().to_lowercase()),
            "Unit names must be unique",
        )?;
        require(money(&u.price)? >= 0, "Unit price cannot be negative")?;
    }
    let barcode = if p.barcode.trim().is_empty() {
        None
    } else {
        Some(p.barcode.trim())
    };
    let id = if let Some(id) = p.id {
        let history: i64 = c.query_row(
            "SELECT EXISTS(SELECT 1 FROM stock_movements WHERE product_id=?)",
            [id],
            |r| r.get(0),
        )?;
        if history > 0 {
            let base: String =
                c.query_row("SELECT base_unit FROM products WHERE id=?", [id], |r| {
                    r.get(0)
                })?;
            require(
                base == p.base_unit,
                "Base unit cannot change after stock activity",
            )?;
            for u in &p.units {
                let old: Option<i64> = c
                    .query_row(
                        "SELECT multiplier FROM product_units WHERE product_id=? AND name=?",
                        params![id, u.name],
                        |r| r.get(0),
                    )
                    .optional()?;
                if let Some(old) = old {
                    require(old==u.multiplier,"Existing unit conversions cannot change after stock activity; add a new unit")?;
                }
            }
        }
        let n=c.execute("UPDATE products SET name=?,search_name=?,generic=?,strength=?,form=?,category=?,manufacturer=?,barcode=?,shelf=?,base_unit=?,reorder_level=?,active=?,revision=revision+1 WHERE id=? AND revision=?",params![p.name.trim(),normalize(&format!("{} {}",p.name,p.generic)),p.generic,p.strength,p.form,p.category,p.manufacturer,barcode,p.shelf,p.base_unit,p.reorder_level,p.active,id,p.revision])?;
        require(n == 1, "Record changed. Reload before saving")?;
        id
    } else {
        c.execute("INSERT INTO products(name,search_name,generic,strength,form,category,manufacturer,barcode,shelf,base_unit,reorder_level,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",params![p.name.trim(),normalize(&format!("{} {}",p.name,p.generic)),p.generic,p.strength,p.form,p.category,p.manufacturer,barcode,p.shelf,p.base_unit,p.reorder_level,p.active])?;
        c.last_insert_rowid()
    };
    c.execute("UPDATE product_units SET active=0 WHERE product_id=?", [id])?;
    for u in p.units {
        c.execute("INSERT INTO product_units(product_id,name,multiplier,price_minor) VALUES(?,?,?,?) ON CONFLICT(product_id,name) DO UPDATE SET price_minor=excluded.price_minor,multiplier=excluded.multiplier,active=1",params![id,u.name.trim(),u.multiplier,money(&u.price)?])?;
    }
    audit(c, a.id, "save", "products", id, json!({"name":p.name}))?;
    if let Some(stock) = p.opening_stock.filter(|stock| stock.quantity > 0) {
        adjustment(
            c,
            a,
            json!({
                "mode": "opening",
                "product_id": id,
                "quantity": stock.quantity,
                "batch_number": stock.batch_number,
                "expiry": stock.expiry,
                "total_cost": if stock.total_cost.is_empty() { "0" } else { &stock.total_cost },
                "reason": "Opening stock",
            }),
        )?;
    }
    Ok(json!({"id":id}))
}
pub fn category(c: &Connection, a: &Actor, p: Value) -> Result<Value> {
    let kind = p["kind"].as_str().unwrap_or("");
    auth::check(
        a,
        if kind == "supplier_type" {
            "suppliers"
        } else {
            "expenses"
        },
        true,
    )?;
    require(
        ["supplier_type", "expense"].contains(&kind),
        "Invalid category",
    )?;
    let name = p["name"].as_str().unwrap_or("").trim();
    require(!name.is_empty(), "Name is required")?;
    let id = if let Some(id) = p["id"].as_i64() {
        let n = c.execute(
            "UPDATE categories SET name=?,revision=revision+1 WHERE id=? AND kind=? AND revision=?",
            params![name, id, kind, p["revision"].as_i64()],
        )?;
        require(n == 1, "Record changed. Reload before saving")?;
        id
    } else {
        c.execute(
            "INSERT INTO categories(kind,name) VALUES(?,?)",
            params![kind, name],
        )?;
        c.last_insert_rowid()
    };
    audit(c, a.id, "save", "categories", id, json!({"name":name}))?;
    Ok(json!({"id":id}))
}
pub fn expense(c: &Connection, a: &Actor, p: Value) -> Result<Value> {
    auth::check(a, "expenses", true)?;
    let amount = money(p["amount"].as_str().unwrap_or("0"))?;
    require(amount > 0, "Expense must be greater than zero")?;
    let date = p["date"].as_str().unwrap_or("");
    valid_date(date)?;
    let category = p["category_id"].as_i64().unwrap_or(0);
    let valid: i64 = c.query_row(
        "SELECT COUNT(*) FROM categories WHERE id=? AND kind='expense'",
        [category],
        |r| r.get(0),
    )?;
    require(valid == 1, "Select an expense category")?;
    c.execute("INSERT INTO expenses(request_id,category_id,amount_minor,date,method,note,actor_id) VALUES(?,?,?,?,?,?,?)",params![p["request_id"].as_str().unwrap_or(""),category,amount,date,p["method"].as_str().unwrap_or("Cash"),p["note"].as_str().unwrap_or(""),a.id])?;
    let id = c.last_insert_rowid();
    daily(c, date, "expenses_minor", amount)?;
    audit(
        c,
        a.id,
        "post",
        "expenses",
        id,
        json!({"amount_minor":amount}),
    )?;
    Ok(json!({"id":id}))
}
pub fn draft(c: &Connection, a: &Actor, p: Value) -> Result<Value> {
    let id = p["id"].as_str().unwrap_or("");
    let kind = p["kind"].as_str().unwrap_or("");
    require(!id.is_empty(), "Draft identifier is required")?;
    auth::check(a, kind_module(kind), true)?;
    let rev = p["revision"].as_i64().unwrap_or(0);
    let existing: Option<(i64, i64)> = c
        .query_row(
            "SELECT user_id,revision FROM drafts WHERE id=?",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((owner, current)) = existing {
        require(owner == a.id, "This draft belongs to another user")?;
        if current != rev {
            return err("CONFLICT", "Draft changed. Reload before saving");
        }
        c.execute(
            "UPDATE drafts SET title=?,payload=?,revision=revision+1,updated_at=? WHERE id=?",
            params![
                p["title"].as_str().unwrap_or("Draft"),
                p["payload"].to_string(),
                now(),
                id
            ],
        )?;
    } else {
        require(rev == 0, "Draft no longer exists")?;
        c.execute(
            "INSERT INTO drafts(id,user_id,kind,title,payload,updated_at) VALUES(?,?,?,?,?,?)",
            params![
                id,
                a.id,
                kind,
                p["title"].as_str().unwrap_or("Draft"),
                p["payload"].to_string(),
                now()
            ],
        )?;
    }
    Ok(json!({"id":id,"revision":rev+1}))
}
pub fn kind_module(kind: &str) -> &str {
    match kind {
        "sale" => "sales",
        "purchase" => "purchases",
        "customer_return" | "supplier_return" => "returns",
        "customer" => "customers",
        "supplier" | "supplier_type" => "suppliers",
        "product" => "products",
        "expense" => "expenses",
        "payment" => "payments",
        "adjustment" => "stock",
        _ => kind,
    }
}
pub fn remove_draft(c: &Connection, a: &Actor, p: Value) -> Result<Value> {
    let n = c.execute(
        "DELETE FROM drafts WHERE id=? AND user_id=?",
        params![p["id"].as_str().unwrap_or(""), a.id],
    )?;
    Ok(json!({"deleted":n}))
}
pub fn adjustment(c: &Connection, a: &Actor, p: Value) -> Result<Value> {
    auth::check(a, "stock", true)?;
    let product = p["product_id"].as_i64().unwrap_or(0);
    let reason = p["reason"].as_str().unwrap_or("");
    require(!reason.trim().is_empty(), "Adjustment reason is required")?;
    let mode = p["mode"].as_str().unwrap_or("opening");
    require(
        ["opening", "count", "release", "quarantine"].contains(&mode),
        "Invalid stock adjustment",
    )?;
    let qty = p["quantity"].as_i64().unwrap_or(0);
    require((0..=1_000_000_000).contains(&qty), "Invalid base quantity")?;
    let id = if mode == "opening" {
        require(qty > 0, "Quantity must be positive")?;
        let expiry = p["expiry"].as_str().unwrap_or("");
        valid_date(expiry)?;
        let number = p["batch_number"].as_str().unwrap_or("");
        require(!number.trim().is_empty(), "Batch number is required")?;
        let cost = money(p["total_cost"].as_str().unwrap_or("0"))?;
        require(cost >= 0, "Cost cannot be negative")?;
        c.execute("INSERT INTO batches(product_id,number,expiry,quantity,cost_minor,status) VALUES(?,?,?,?,?,?)",params![product,number,expiry,qty,cost,if p["quarantine"].as_bool()==Some(true){"quarantine"}else{"sellable"}])?;
        let b = c.last_insert_rowid();
        movement(c, a.id, product, b, None, qty, cost, reason)?;
        b
    } else {
        let b = p["batch_id"].as_i64().unwrap_or(0);
        let (prod, old_qty, old_cost): (i64, i64, i64) = c.query_row(
            "SELECT product_id,quantity,cost_minor FROM batches WHERE id=?",
            [b],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let (new_qty, new_cost) = if mode == "release" {
            let expiry: String =
                c.query_row("SELECT expiry FROM batches WHERE id=?", [b], |r| r.get(0))?;
            require(expiry >= today(), "Expired stock cannot be released")?;
            c.execute("UPDATE batches SET status='sellable' WHERE id=?", [b])?;
            (old_qty, old_cost)
        } else if mode == "quarantine" {
            c.execute("UPDATE batches SET status='quarantine' WHERE id=?", [b])?;
            (old_qty, old_cost)
        } else {
            require(
                old_qty > 0 || qty == 0,
                "Use opening stock to replenish an empty batch",
            )?;
            (
                qty,
                if old_qty == 0 {
                    0
                } else {
                    (old_cost as i128 * qty as i128 / old_qty as i128) as i64
                },
            )
        };
        c.execute(
            "UPDATE batches SET quantity=?,cost_minor=? WHERE id=?",
            params![new_qty, new_cost, b],
        )?;
        movement(
            c,
            a.id,
            prod,
            b,
            None,
            new_qty - old_qty,
            new_cost - old_cost,
            reason,
        )?;
        b
    };
    audit(
        c,
        a.id,
        "adjust",
        "batches",
        id,
        json!({"reason":reason,"mode":mode}),
    )?;
    Ok(json!({"id":id}))
}
