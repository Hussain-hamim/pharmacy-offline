use crate::{
    auth::{self, Actor},
    db::*,
};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize, Default)]
pub struct Discount {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub value: String,
}
pub fn discounted(gross: i64, d: &Discount) -> Result<i64> {
    let v = money(if d.value.is_empty() { "0" } else { &d.value })?;
    require(v >= 0, "Discount cannot be negative")?;
    let amount = if d.kind == "percent" {
        require(v <= 10000, "Percentage cannot exceed 100")?;
        ((gross as i128 * v as i128 + 5000) / 10000) as i64
    } else {
        require(
            d.kind.is_empty() || d.kind == "amount",
            "Invalid discount type",
        )?;
        v
    };
    require(
        amount <= gross,
        "Discount cannot exceed the line or invoice amount",
    )?;
    Ok(amount)
}
#[derive(Deserialize)]
pub struct BillLine {
    pub product_id: i64,
    pub unit_id: i64,
    pub quantity: i64,
    pub price: String,
    #[serde(default)]
    pub discount: Discount,
    #[serde(default)]
    pub batch_number: String,
    #[serde(default)]
    pub expiry: String,
}
#[derive(Deserialize)]
pub struct Bill {
    pub kind: String,
    pub party_id: Option<i64>,
    pub date: String,
    pub request_id: String,
    pub lines: Vec<BillLine>,
    #[serde(default)]
    pub discount: Discount,
    #[serde(default)]
    pub paid: String,
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub note: String,
    pub draft_id: Option<String>,
}
fn checked_product(a: i64, b: i64) -> Result<i64> {
    a.checked_mul(b)
        .filter(|n| *n <= 9_000_000_000_000)
        .ok_or(AppError {
            code: "VALIDATION".into(),
            message: "Quantity or amount is too large".into(),
        })
}
pub fn number(c: &Connection, kind: &str) -> Result<String> {
    let next: i64 = c.query_row("SELECT COALESCE(MAX(id),0)+1 FROM documents", [], |r| {
        r.get(0)
    })?;
    let s = settings(c)?;
    let prefix = match kind {
        "sale" => s["prefix"].as_str().unwrap_or("INV"),
        "purchase" => "PUR",
        "customer_return" => "CR",
        _ => "SR",
    };
    Ok(format!("{prefix}-{next:07}"))
}
fn print_snapshot(
    c: &Connection,
    party: Option<i64>,
    actor: &Actor,
    paid: i64,
    credit: i64,
    due: i64,
) -> Result<Value> {
    let mut snapshot = settings(c)?;
    let party = if let Some(id) = party {
        json_rows(c, "SELECT name AS party_name,phone AS party_phone,address AS party_address FROM parties WHERE id=?", &[&id])?.pop().unwrap_or(json!({}))
    } else {
        json!({"party_name":"Walk-in customer"})
    };
    snapshot["document"] = party;
    snapshot["document"]["paid_minor"] = json!(paid);
    snapshot["document"]["credit_minor"] = json!(credit);
    snapshot["document"]["outstanding_minor"] = json!(due);
    snapshot["document"]["user_name"] = json!(actor.name);
    Ok(snapshot)
}
pub fn post(c: &Connection, a: &Actor, p: Value) -> Result<Value> {
    let b: Bill = serde_json::from_value(p)?;
    require(
        b.kind == "sale" || b.kind == "purchase",
        "Invalid bill type",
    )?;
    let sale = b.kind == "sale";
    auth::check(a, if sale { "sales" } else { "purchases" }, true)?;
    valid_date(&b.date)?;
    require(
        !b.lines.is_empty() && b.lines.len() <= 2000,
        "A bill requires between 1 and 2000 lines",
    )?;
    require(!b.request_id.is_empty(), "Request ID is required")?;
    if !sale {
        require(b.party_id.is_some(), "Supplier is required")?;
    }
    let mut available_credit = 0;
    if let Some(id) = b.party_id {
        let (kind, active, balance): (String, i64, i64) = c.query_row(
            "SELECT kind,active,balance_minor FROM parties WHERE id=?",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        require(
            kind == if sale { "customer" } else { "supplier" } && active == 1,
            "Select an active customer or supplier",
        )?;
        available_credit = (-balance).max(0);
    }
    let mut prepared = Vec::new();
    let mut line_nets = Vec::new();
    let mut subtotal = 0;
    for l in &b.lines {
        require(
            l.quantity > 0 && l.quantity <= 1_000_000_000,
            "Quantity must be a positive whole number",
        )?;
        let (name,unit,multiplier):(String,String,i64)=c.query_row("SELECT p.name,u.name,u.multiplier FROM products p JOIN product_units u ON u.product_id=p.id WHERE p.id=? AND u.id=? AND p.active=1 AND u.active=1",params![l.product_id,l.unit_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
        let base = checked_product(l.quantity, multiplier)?;
        require(base <= 1_000_000_000, "Base quantity is too large")?;
        let price = money(&l.price)?;
        require(price >= 0, "Price cannot be negative")?;
        let gross = checked_product(price, l.quantity)?;
        let discount = discounted(gross, &l.discount)?;
        subtotal += gross;
        require(subtotal <= 9_000_000_000_000, "Invoice total is too large")?;
        line_nets.push(gross - discount);
        if !sale {
            valid_date(&l.expiry)?;
            require(
                !l.batch_number.trim().is_empty(),
                "Batch number is required",
            )?;
        }
        prepared.push((name, unit, multiplier, base, price, gross, discount));
    }
    let before: i64 = line_nets.iter().sum();
    let invoice_discount = discounted(before, &b.discount)?;
    let shares = allocate(invoice_discount, &line_nets);
    let total = before - invoice_discount;
    let tendered = money(if b.paid.is_empty() { "0" } else { &b.paid })?;
    require(tendered >= 0, "Payment cannot be negative")?;
    let credit = available_credit.min(total);
    let paid = tendered.min(total - credit);
    let outstanding = total - paid - credit;
    if sale && b.party_id.is_none() {
        require(outstanding == 0, "A customer is required for credit sales")?;
    }
    let number = number(c, &b.kind)?;
    let snapshot = print_snapshot(c, b.party_id, a, paid, credit, outstanding)?;
    c.execute("INSERT INTO documents(request_id,kind,number,party_id,date,subtotal_minor,discount_minor,total_minor,paid_minor,credit_minor,outstanding_minor,note,pharmacy_snapshot,actor_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",params![b.request_id,b.kind,number,b.party_id,b.date,subtotal,subtotal-total,total,paid,credit,outstanding,b.note,snapshot.to_string(),a.id])?;
    let doc = c.last_insert_rowid();
    let mut cost_total = 0;
    for (i, l) in b.lines.iter().enumerate() {
        let (name, unit, multiplier, base, price, _, discount) = &prepared[i];
        let net = line_nets[i] - shares[i];
        c.execute("INSERT INTO document_lines(document_id,product_id,name,unit,multiplier,quantity,base_quantity,price_minor,discount_minor,total_minor,batch_number,expiry) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",params![doc,l.product_id,name,unit,multiplier,l.quantity,base,price,discount+shares[i],net,if sale{None}else{Some(&l.batch_number)},if sale{None}else{Some(&l.expiry)}])?;
        let line = c.last_insert_rowid();
        let cost = if sale {
            consume(c, a, l.product_id, line, doc, *base, None, false)?
        } else {
            c.execute("INSERT INTO batches(product_id,purchase_line_id,number,expiry,quantity,cost_minor) VALUES(?,?,?,?,?,?)",params![l.product_id,line,l.batch_number,l.expiry,base,net])?;
            let batch = c.last_insert_rowid();
            movement(
                c,
                a.id,
                l.product_id,
                batch,
                Some(doc),
                *base,
                net,
                "purchase",
            )?;
            net
        };
        c.execute(
            "UPDATE document_lines SET cost_minor=? WHERE id=?",
            params![cost, line],
        )?;
        cost_total += cost;
    }
    c.execute(
        "UPDATE documents SET cost_minor=? WHERE id=?",
        params![cost_total, doc],
    )?;
    if let Some(party) = b.party_id {
        account(c, party, Some(doc), None, total, "invoice")?;
    }
    if paid > 0 {
        record_payment(
            c,
            a,
            b.party_id,
            Some(doc),
            paid,
            if sale { "receipt" } else { "supplier_payment" },
            &b.date,
            &b.method,
            "",
            &format!("{}:payment", b.request_id),
            true,
        )?;
    }
    daily(
        c,
        &b.date,
        if sale {
            "sales_minor"
        } else {
            "purchases_minor"
        },
        total,
    )?;
    if sale {
        daily(c, &b.date, "cost_minor", cost_total)?;
        daily(c, &b.date, "discounts_minor", subtotal - total)?;
        daily(c, &b.date, "sale_count", 1)?;
    }
    if let Some(d) = b.draft_id {
        c.execute(
            "DELETE FROM drafts WHERE id=? AND user_id=?",
            params![d, a.id],
        )?;
    }
    audit(
        c,
        a.id,
        "post",
        "documents",
        doc,
        json!({"number":number,"total_minor":total}),
    )?;
    Ok(
        json!({"id":doc,"number":number,"total_minor":total,"change_minor":tendered-paid,"outstanding_minor":outstanding}),
    )
}

#[allow(clippy::too_many_arguments)]
fn consume(
    c: &Connection,
    a: &Actor,
    product: i64,
    line: i64,
    doc: i64,
    quantity: i64,
    source: Option<i64>,
    allow_expired: bool,
) -> Result<i64> {
    let date = if allow_expired {
        "0000-01-01".into()
    } else {
        today()
    };
    let batches=json_rows(c,"SELECT id,quantity,cost_minor FROM batches WHERE product_id=? AND quantity>0 AND status='sellable' AND expiry>=? AND (? IS NULL OR purchase_line_id=?) ORDER BY expiry,id",&[&product,&date,&source,&source])?;
    let mut remaining = quantity;
    let mut total = 0;
    for batch in batches {
        if remaining == 0 {
            break;
        }
        let id = batch["id"].as_i64().unwrap();
        let available = batch["quantity"].as_i64().unwrap();
        let oldcost = batch["cost_minor"].as_i64().unwrap();
        let take = remaining.min(available);
        let cost = if take == available {
            oldcost
        } else {
            (oldcost as i128 * take as i128 / available as i128) as i64
        };
        c.execute(
            "UPDATE batches SET quantity=quantity-?,cost_minor=cost_minor-? WHERE id=?",
            params![take, cost, id],
        )?;
        c.execute(
            "INSERT INTO allocations(line_id,batch_id,quantity,cost_minor) VALUES(?,?,?,?)",
            params![line, id, take, cost],
        )?;
        movement(
            c,
            a.id,
            product,
            id,
            Some(doc),
            -take,
            -cost,
            if allow_expired {
                "supplier_return"
            } else {
                "sale"
            },
        )?;
        remaining -= take;
        total += cost;
    }
    if remaining > 0 {
        return err(
            "STOCK",
            "Insufficient sellable, unexpired stock for one or more lines",
        );
    };
    Ok(total)
}

#[allow(clippy::too_many_arguments)]
pub fn record_payment(
    c: &Connection,
    a: &Actor,
    party: Option<i64>,
    document: Option<i64>,
    amount: i64,
    kind: &str,
    date: &str,
    method: &str,
    note: &str,
    request: &str,
    allocate_document: bool,
) -> Result<i64> {
    c.execute("INSERT INTO payments(request_id,party_id,document_id,kind,amount_minor,method,date,note,actor_id) VALUES(?,?,?,?,?,?,?,?,?)",params![request,party,document,kind,amount,if method.is_empty(){"Cash"}else{method},date,note,a.id])?;
    let id = c.last_insert_rowid();
    if let Some(party) = party {
        account(
            c,
            party,
            document,
            Some(id),
            if kind.ends_with("refund") {
                amount
            } else {
                -amount
            },
            kind,
        )?;
    }
    if allocate_document {
        if let Some(doc) = document {
            c.execute("INSERT INTO payment_allocations(payment_id,document_id,amount_minor) VALUES(?,?,?)",params![id,doc,amount])?;
        }
    }
    let (column, sign) = match kind {
        "receipt" => ("receipts_minor", 1),
        "supplier_payment" => ("payments_minor", 1),
        "customer_refund" => ("receipts_minor", -1),
        _ => ("payments_minor", -1),
    };
    daily(c, date, column, amount * sign)?;
    Ok(id)
}
pub fn payment(c: &Connection, a: &Actor, p: Value) -> Result<Value> {
    auth::check(a, "payments", true)?;
    let party = p["party_id"].as_i64().unwrap_or(0);
    let kind: String = c.query_row(
        "SELECT kind FROM parties WHERE id=? AND active=1",
        [party],
        |r| r.get(0),
    )?;
    auth::check(
        a,
        if kind == "customer" {
            "customers"
        } else {
            "suppliers"
        },
        false,
    )?;
    let amount = money(p["amount"].as_str().unwrap_or("0"))?;
    require(amount > 0, "Payment must be greater than zero")?;
    let date = p["date"].as_str().unwrap_or("");
    valid_date(date)?;
    let doc = p["document_id"].as_i64();
    if let Some(doc) = doc {
        let owner: i64 = c.query_row("SELECT party_id FROM documents WHERE id=?", [doc], |r| {
            r.get(0)
        })?;
        require(owner == party, "Invoice belongs to a different account")?;
    }
    let id = record_payment(
        c,
        a,
        Some(party),
        doc,
        amount,
        if kind == "customer" {
            "receipt"
        } else {
            "supplier_payment"
        },
        date,
        p["method"].as_str().unwrap_or("Cash"),
        p["note"].as_str().unwrap_or(""),
        p["request_id"].as_str().unwrap_or(""),
        false,
    )?;
    let docs=json_rows(c,"SELECT id,outstanding_minor FROM documents WHERE party_id=? AND kind=? AND outstanding_minor>0 AND (? IS NULL OR id=?) ORDER BY id",&[&party,&if kind=="customer"{"sale"}else{"purchase"},&doc,&doc])?;
    let mut left = amount;
    for d in docs {
        if left == 0 {
            break;
        }
        let paid = left.min(d["outstanding_minor"].as_i64().unwrap());
        let did = d["id"].as_i64().unwrap();
        c.execute("UPDATE documents SET paid_minor=paid_minor+?,outstanding_minor=outstanding_minor-? WHERE id=?",params![paid,paid,did])?;
        c.execute(
            "INSERT INTO payment_allocations(payment_id,document_id,amount_minor) VALUES(?,?,?)",
            params![id, did, paid],
        )?;
        left -= paid;
    }
    audit(
        c,
        a.id,
        "post",
        "payments",
        id,
        json!({"amount_minor":amount,"unallocated_credit_minor":left}),
    )?;
    Ok(json!({"id":id,"credit_minor":left}))
}

#[derive(Deserialize)]
pub struct ReturnLine {
    pub source_line_id: i64,
    pub quantity: i64,
    #[serde(default)]
    pub disposition: String,
}
#[derive(Deserialize)]
pub struct Return {
    pub source_id: i64,
    pub date: String,
    pub request_id: String,
    pub lines: Vec<ReturnLine>,
    #[serde(default)]
    pub settlement: String,
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub note: String,
    pub draft_id: Option<String>,
}
pub fn returns(c: &Connection, a: &Actor, p: Value) -> Result<Value> {
    auth::check(a, "returns", true)?;
    auth::special(a, "reversals")?;
    let r: Return = serde_json::from_value(p)?;
    valid_date(&r.date)?;
    require(!r.lines.is_empty(), "Select at least one return line")?;
    require(
        ["credit", "refund"].contains(&r.settlement.as_str()),
        "Choose refund or account credit",
    )?;
    let source = json_rows(c, "SELECT * FROM documents WHERE id=?", &[&r.source_id])?
        .pop()
        .ok_or(AppError {
            code: "VALIDATION".into(),
            message: "Original invoice not found".into(),
        })?;
    let source_kind = source["kind"].as_str().unwrap();
    require(
        source_kind == "sale" || source_kind == "purchase",
        "Returns must reference an original sale or purchase",
    )?;
    let customer = source_kind == "sale";
    let kind = if customer {
        "customer_return"
    } else {
        "supplier_return"
    };
    let party = source["party_id"].as_i64();
    require(
        party.is_some() || r.settlement == "refund",
        "Walk-in returns must be refunded",
    )?;
    let mut total = 0;
    let mut prepared = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for l in &r.lines {
        require(
            l.quantity > 0 && seen.insert(l.source_line_id),
            "Invalid or duplicate return line",
        )?;
        let original = json_rows(
            c,
            "SELECT * FROM document_lines WHERE id=? AND document_id=?",
            &[&l.source_line_id, &r.source_id],
        )?
        .pop()
        .ok_or(AppError {
            code: "VALIDATION".into(),
            message: "Return line does not belong to this invoice".into(),
        })?;
        let old = original["returned_quantity"].as_i64().unwrap();
        let q = original["quantity"].as_i64().unwrap();
        require(
            l.quantity <= q - old,
            "Return exceeds remaining returnable quantity",
        )?;
        let net = original["total_minor"].as_i64().unwrap();
        let value = ((net as i128 * (old + l.quantity) as i128) / q as i128
            - (net as i128 * old as i128) / q as i128) as i64;
        let base = checked_product(l.quantity, original["multiplier"].as_i64().unwrap())?;
        total += value;
        prepared.push((original, value, base));
    }
    let due = source["outstanding_minor"].as_i64().unwrap();
    let reduced = due.min(total);
    let refund = if r.settlement == "refund" {
        total - reduced
    } else {
        0
    };
    let number = number(c, kind)?;
    c.execute("INSERT INTO documents(request_id,kind,number,party_id,source_id,date,subtotal_minor,discount_minor,total_minor,paid_minor,note,pharmacy_snapshot,actor_id) VALUES(?,?,?,?,?,?,?,0,?,?,?,?,?)",params![r.request_id,kind,number,party,r.source_id,r.date,total,total,refund,r.note,print_snapshot(c,party,a,refund,0,0)?.to_string(),a.id])?;
    let doc = c.last_insert_rowid();
    let mut cost_total = 0;
    for (index, l) in r.lines.iter().enumerate() {
        let (original, value, base) = &prepared[index];
        let product = original["product_id"].as_i64().unwrap();
        let disposition = if l.disposition == "sellable" {
            "sellable"
        } else {
            "quarantine"
        };
        c.execute("INSERT INTO document_lines(document_id,product_id,source_line_id,name,unit,multiplier,quantity,base_quantity,price_minor,discount_minor,total_minor,disposition) VALUES(?,?,?,?,?,?,?,?,?,0,?,?)",params![doc,product,l.source_line_id,original["name"].as_str(),original["unit"].as_str(),original["multiplier"].as_i64(),l.quantity,base,original["price_minor"].as_i64(),value,disposition])?;
        let line = c.last_insert_rowid();
        let cost = if customer {
            let allocs=json_rows(c,"SELECT a.*,b.number,b.expiry,b.purchase_line_id FROM allocations a JOIN batches b ON b.id=a.batch_id WHERE a.line_id=? ORDER BY a.id",&[&l.source_line_id])?;
            let mut left = *base;
            let mut cost = 0;
            for alloc in allocs {
                if left == 0 {
                    break;
                }
                let aq = alloc["quantity"].as_i64().unwrap();
                let ar = alloc["returned_quantity"].as_i64().unwrap();
                let take = left.min(aq - ar);
                if take == 0 {
                    continue;
                }
                let ac = alloc["cost_minor"].as_i64().unwrap();
                let returned_cost = ((ac as i128 * (ar + take) as i128) / aq as i128
                    - (ac as i128 * ar as i128) / aq as i128)
                    as i64;
                let expiry = alloc["expiry"].as_str().unwrap();
                if disposition == "sellable" {
                    require(
                        expiry >= today().as_str(),
                        "Expired returned stock must remain quarantined",
                    )?;
                }
                c.execute("INSERT INTO batches(product_id,purchase_line_id,number,expiry,quantity,cost_minor,status) VALUES(?,?,?,?,?,?,?)",params![product,alloc["purchase_line_id"].as_i64(),alloc["number"].as_str(),expiry,take,returned_cost,disposition])?;
                let batch = c.last_insert_rowid();
                movement(
                    c,
                    a.id,
                    product,
                    batch,
                    Some(doc),
                    take,
                    returned_cost,
                    "customer_return",
                )?;
                c.execute(
                    "UPDATE allocations SET returned_quantity=returned_quantity+? WHERE id=?",
                    params![take, alloc["id"].as_i64()],
                )?;
                left -= take;
                cost += returned_cost;
            }
            require(left == 0, "Original batch allocation is incomplete")?;
            cost
        } else {
            consume_supplier_return(c, a, product, line, doc, *base, l.source_line_id)?
        };
        cost_total += cost;
        c.execute(
            "UPDATE document_lines SET cost_minor=? WHERE id=?",
            params![cost, line],
        )?;
        c.execute(
            "UPDATE document_lines SET returned_quantity=returned_quantity+? WHERE id=?",
            params![l.quantity, l.source_line_id],
        )?;
    }
    c.execute(
        "UPDATE documents SET cost_minor=? WHERE id=?",
        params![cost_total, doc],
    )?;
    c.execute("UPDATE documents SET returned_minor=returned_minor+?,outstanding_minor=outstanding_minor-? WHERE id=?",params![total,reduced,r.source_id])?;
    if let Some(party) = party {
        account(c, party, Some(doc), None, -total, kind)?;
    }
    if refund > 0 {
        record_payment(
            c,
            a,
            party,
            Some(doc),
            refund,
            if customer {
                "customer_refund"
            } else {
                "supplier_refund"
            },
            &r.date,
            &r.method,
            &r.note,
            &format!("{}:refund", r.request_id),
            false,
        )?;
    }
    daily(
        c,
        &r.date,
        if customer {
            "returns_minor"
        } else {
            "supplier_returns_minor"
        },
        total,
    )?;
    if customer {
        daily(c, &r.date, "cost_minor", -cost_total)?;
    }
    if let Some(d) = r.draft_id {
        c.execute(
            "DELETE FROM drafts WHERE id=? AND user_id=?",
            params![d, a.id],
        )?;
    }
    audit(
        c,
        a.id,
        "return",
        "documents",
        doc,
        json!({"source_id":r.source_id,"total_minor":total}),
    )?;
    Ok(json!({"id":doc,"number":number,"total_minor":total,"refund_minor":refund}))
}
fn consume_supplier_return(
    c: &Connection,
    a: &Actor,
    product: i64,
    line: i64,
    doc: i64,
    qty: i64,
    source: i64,
) -> Result<i64> {
    let rows=json_rows(c,"SELECT id,quantity,cost_minor FROM batches WHERE purchase_line_id=? AND quantity>0 ORDER BY expiry,id",&[&source])?;
    let mut left = qty;
    let mut cost = 0;
    for b in rows {
        if left == 0 {
            break;
        }
        let q = b["quantity"].as_i64().unwrap();
        let take = left.min(q);
        let cost_old = b["cost_minor"].as_i64().unwrap();
        let part = (cost_old as i128 * take as i128 / q as i128) as i64;
        let id = b["id"].as_i64().unwrap();
        c.execute(
            "UPDATE batches SET quantity=quantity-?,cost_minor=cost_minor-? WHERE id=?",
            params![take, part, id],
        )?;
        c.execute(
            "INSERT INTO allocations(line_id,batch_id,quantity,cost_minor) VALUES(?,?,?,?)",
            params![line, id, take, part],
        )?;
        movement(
            c,
            a.id,
            product,
            id,
            Some(doc),
            -take,
            -part,
            "supplier_return",
        )?;
        left -= take;
        cost += part;
    }
    require(left == 0, "Not enough stock remains from this purchase")?;
    Ok(cost)
}
