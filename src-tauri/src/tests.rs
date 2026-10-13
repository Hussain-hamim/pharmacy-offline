use super::*;
use serde_json::{json, Value};
struct Fixture {
    _dir: tempfile::TempDir,
    core: Core,
    token: String,
    customer: i64,
    supplier: i64,
    product: i64,
    unit: i64,
}
impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::new(dir.path().to_path_buf()).unwrap();
        let session=core.call("setup",json!({"name":"Test Admin","username":"admin","password":"test-password","role":"Administrator","pharmacy_name":"Test Pharmacy"}),None,&|_|{}).unwrap();
        let token = session["token"].as_str().unwrap().into();
        let mut f = Self {
            _dir: dir,
            core,
            token,
            customer: 0,
            supplier: 0,
            product: 0,
            unit: 0,
        };
        f.customer = f.call(
            "save_party",
            json!({"kind":"customer","name":"Customer","opening":"0"}),
        )["id"]
            .as_i64()
            .unwrap();
        f.supplier = f.call(
            "save_party",
            json!({"kind":"supplier","name":"Supplier","opening":"0"}),
        )["id"]
            .as_i64()
            .unwrap();
        f.product=f.call("save_product",json!({"name":"Medicine","generic":"paracetamol","base_unit":"tablet","reorder_level":10,"units":[{"name":"tablet","multiplier":1,"price":"20"},{"name":"box","multiplier":10,"price":"180"}]}))["id"].as_i64().unwrap();
        f.unit = f.call("detail", json!({"entity":"product","id":f.product}))["units"][0]["id"]
            .as_i64()
            .unwrap();
        f
    }
    fn call(&self, action: &str, payload: Value) -> Value {
        self.core
            .call(action, payload, Some(&self.token), &|_| {})
            .unwrap_or_else(|e| panic!("{action}: {e}"))
    }
    fn try_call(&self, action: &str, payload: Value) -> Result<Value> {
        self.core.call(action, payload, Some(&self.token), &|_| {})
    }
    fn purchase(&self, quantity: i64, expiry: &str, price: &str) -> i64 {
        self.call("post_bill",json!({"kind":"purchase","party_id":self.supplier,"date":today(),"request_id":uuid::Uuid::new_v4().to_string(),"lines":[{"product_id":self.product,"unit_id":self.unit,"quantity":quantity,"price":price,"batch_number":format!("B{expiry}"),"expiry":expiry}],"paid":"0"}))["id"].as_i64().unwrap()
    }
    fn sale_payload(&self, qty: i64, paid: &str) -> Value {
        json!({"kind":"sale","party_id":self.customer,"date":today(),"request_id":uuid::Uuid::new_v4().to_string(),"lines":[{"product_id":self.product,"unit_id":self.unit,"quantity":qty,"price":"20","discount":{"kind":"percent","value":"10"}}],"discount":{"kind":"amount","value":"5"},"paid":paid})
    }
    fn db(&self) -> rusqlite::Connection {
        db::open(&self.core.root.join("pharmacy.db")).unwrap()
    }
}

#[test]
fn money_is_exact_and_validated() {
    assert_eq!(money("123.45").unwrap(), 12345);
    assert_eq!(money("0.1").unwrap(), 10);
    assert_eq!(money("-12.03").unwrap(), -1203);
    assert!(money("1.001").is_err());
    assert!(money("NaN").is_err());
    assert!(money("--12").is_err());
    assert!(valid_date("2026-1-1").is_err());
    assert!(valid_date("2026-01-01").is_ok());
    assert!(money("1e3").is_err());
    assert_eq!(allocate(5, &[1, 1, 1]), vec![2, 2, 1]);
}
#[test]
fn full_purchase_sale_payment_return_workflow() {
    let f = Fixture::new();
    let purchase = f.purchase(100, "2030-12-31", "10");
    let sale = f.call("post_bill", f.sale_payload(10, "50"));
    let sid = sale["id"].as_i64().unwrap();
    assert_eq!(sale["total_minor"], 17500);
    assert_eq!(sale["outstanding_minor"], 12500);
    f.call("post_payment",json!({"request_id":"pay-1","party_id":f.customer,"document_id":sid,"amount":"75","date":today(),"method":"Cash"}));
    let doc = f.call("detail", json!({"entity":"document","id":sid}));
    assert_eq!(doc["outstanding_minor"], 5000);
    let line = doc["lines"][0]["id"].as_i64().unwrap();
    let ret=f.call("post_return",json!({"request_id":"ret-1","source_id":sid,"date":today(),"settlement":"refund","lines":[{"source_line_id":line,"quantity":4,"disposition":"quarantine"}]}));
    assert_eq!(ret["total_minor"], 7000);
    assert_eq!(ret["refund_minor"], 2000);
    let customer = f.call("detail", json!({"entity":"party","id":f.customer}));
    assert_eq!(customer["balance_minor"], 0);
    let product = f.call("detail", json!({"entity":"product","id":f.product}));
    assert_eq!(product["on_hand"], 90);
    let pdoc = f.call("detail", json!({"entity":"document","id":purchase}));
    f.call("post_return",json!({"request_id":"supplier-ret","source_id":purchase,"date":today(),"settlement":"credit","lines":[{"source_line_id":pdoc["lines"][0]["id"],"quantity":5}]}));
    let supplier = f.call("detail", json!({"entity":"party","id":f.supplier}));
    assert_eq!(supplier["balance_minor"], 95000);
    let dashboard = f.call("dashboard", json!({}));
    assert_eq!(dashboard["totals"]["sales_minor"], 17500);
    assert_eq!(dashboard["totals"]["returns_minor"], 7000);
    assert_eq!(dashboard["totals"]["cost_minor"], 6000);
    assert_eq!(dashboard["totals"]["gross_profit_minor"], 4500);
    assert_eq!(dashboard["totals"]["receipts_minor"], 10500);
}
#[test]
fn insufficient_stock_rolls_back_all_lines() {
    let f = Fixture::new();
    f.purchase(5, "2030-01-01", "10");
    let mut p = f.sale_payload(3, "0");
    let extra = p["lines"][0].clone();
    p["lines"].as_array_mut().unwrap().push(extra);
    assert!(f.try_call("post_bill", p).is_err());
    assert_eq!(
        f.call("detail", json!({"entity":"product","id":f.product}))["on_hand"],
        5
    );
    assert_eq!(
        f.db()
            .query_row(
                "SELECT COUNT(*) FROM documents WHERE kind='sale'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}
#[test]
fn fefo_excludes_expired_and_quarantine() {
    let f = Fixture::new();
    f.purchase(20, "2032-01-01", "10");
    f.purchase(5, "2030-01-01", "12");
    f.purchase(50, "2020-01-01", "1");
    let sale = f.call("post_bill", f.sale_payload(8, "0"));
    let doc = f.call("detail", json!({"entity":"document","id":sale["id"]}));
    let a = &doc["lines"][0]["allocations"];
    assert_eq!(a[0]["expiry"], "2030-01-01");
    assert_eq!(a[0]["quantity"], 5);
    assert_eq!(a[1]["quantity"], 3);
    assert_eq!(doc["cost_minor"], 9000);
}
#[test]
fn duplicate_post_is_idempotent() {
    let f = Fixture::new();
    f.purchase(20, "2030-01-01", "10");
    let p = f.sale_payload(3, "0");
    let first = f.call("post_bill", p.clone());
    let second = f.call("post_bill", p);
    assert_eq!(first, second);
    assert_eq!(
        f.call("detail", json!({"entity":"product","id":f.product}))["on_hand"],
        17
    );
}
#[test]
fn customer_credit_applies_to_next_invoice() {
    let f = Fixture::new();
    f.purchase(30, "2030-01-01", "10");
    f.call(
        "post_payment",
        json!({"request_id":"advance","party_id":f.customer,"amount":"100","date":today()}),
    );
    let sale = f.call("post_bill", f.sale_payload(10, "0"));
    assert_eq!(sale["outstanding_minor"], 7500);
    assert_eq!(
        f.call("detail", json!({"entity":"party","id":f.customer}))["balance_minor"],
        7500
    );
}
#[test]
fn drafts_persist_and_do_not_change_stock() {
    let f = Fixture::new();
    let d=f.call("save_draft",json!({"id":"draft-1","kind":"sale","title":"Unfinished","payload":f.sale_payload(10,"0"),"revision":0}));
    assert_eq!(d["revision"], 1);
    assert!(f
        .try_call(
            "save_draft",
            json!({"id":"draft-1","kind":"sale","title":"Stale","payload":{},"revision":0})
        )
        .is_err());
    let restarted = Core::new(f.core.root.clone()).unwrap();
    let login = restarted
        .call(
            "login",
            json!({"username":"admin","password":"test-password"}),
            None,
            &|_| {},
        )
        .unwrap();
    let draft = restarted
        .call(
            "detail",
            json!({"entity":"draft","id":"draft-1"}),
            login["token"].as_str(),
            &|_| {},
        )
        .unwrap();
    assert_eq!(draft["title"], "Unfinished");
    assert_eq!(
        f.call("detail", json!({"entity":"product","id":f.product}))["on_hand"],
        0
    );
}
#[test]
fn permissions_enforced_at_command_boundary() {
    let f = Fixture::new();
    f.call(
        "save_user",
        json!({"username":"cashier","name":"Cashier","password":"test-password","role":"Cashier"}),
    );
    let login = f
        .core
        .call(
            "login",
            json!({"username":"cashier","password":"test-password"}),
            None,
            &|_| {},
        )
        .unwrap();
    let token = login["token"].as_str();
    for (action, p) in [
        ("save_user", json!({"name":"Evil"})),
        ("save_settings", json!({"settings":{}})),
        (
            "post_bill",
            json!({"kind":"purchase","party_id":f.supplier,"date":today(),"request_id":"no","lines":[]}),
        ),
        ("restore", json!({"path":"/tmp/no"})),
    ] {
        let e = f.core.call(action, p, token, &|_| {}).unwrap_err();
        assert_eq!(e.code, "PERMISSION");
    }
    let dash = f.core.call("dashboard", json!({}), token, &|_| {}).unwrap();
    assert!(dash["totals"].get("cost_minor").is_none());
    assert!(dash["totals"].get("gross_profit_minor").is_none());
}
#[test]
fn last_administrator_cannot_be_disabled() {
    let f = Fixture::new();
    assert!(f.try_call("save_user",json!({"id":1,"revision":1,"username":"admin","name":"Test Admin","role":"Administrator","active":false})).is_err());
}
#[test]
fn pagination_does_not_repeat_or_skip() {
    let f = Fixture::new();
    for i in 0..12 {
        f.call(
            "save_party",
            json!({"kind":"customer","name":format!("Person {i}"),"opening":"0"}),
        );
    }
    let mut cursor = Value::Null;
    let mut seen = HashSet::new();
    loop {
        let page = f.call(
            "list",
            json!({"entity":"customers","limit":3,"cursor":cursor}),
        );
        for row in page["items"].as_array().unwrap() {
            assert!(seen.insert(row["id"].as_i64().unwrap()));
        }
        if page["next_cursor"].is_null() {
            break;
        }
        cursor = page["next_cursor"].clone();
    }
    assert_eq!(seen.len(), 13);
    let first = f.call("list", json!({"entity":"customers","limit":5}));
    let second = f.call(
        "list",
        json!({"entity":"customers","limit":5,"cursor":first["next_cursor"]}),
    );
    let previous=f.call("list",json!({"entity":"customers","limit":5,"cursor":second["previous_cursor"],"direction":"previous"}));
    assert_eq!(first["items"], previous["items"]);
    assert!(previous["previous_cursor"].is_null());
}
#[test]
fn over_return_rolls_back() {
    let f = Fixture::new();
    f.purchase(20, "2030-01-01", "10");
    let sale = f.call("post_bill", f.sale_payload(3, "0"));
    let doc = f.call("detail", json!({"entity":"document","id":sale["id"]}));
    assert!(f.try_call("post_return",json!({"request_id":"bad","source_id":sale["id"],"date":today(),"settlement":"credit","lines":[{"source_line_id":doc["lines"][0]["id"],"quantity":4}]})).is_err());
    assert_eq!(
        f.call("detail", json!({"entity":"product","id":f.product}))["on_hand"],
        17
    );
}

#[test]
fn posted_print_identity_survives_master_and_payment_changes() {
    let f = Fixture::new();
    f.purchase(20, "2030-12-31", "10");
    let id = f.call("post_bill", f.sale_payload(2, "0"))["id"]
        .as_i64()
        .unwrap();
    f.call("save_party",json!({"id":f.customer,"kind":"customer","name":"Renamed account","revision":1,"opening":"0"}));
    f.call("post_payment",json!({"party_id":f.customer,"amount":"31","date":today(),"method":"Cash","request_id":"snapshot-pay"}));
    let d = f.call("detail", json!({"entity":"document","id":id}));
    assert_eq!(d["outstanding_minor"], 0);
    assert_eq!(d["pharmacy_snapshot"]["document"]["party_name"], "Customer");
    assert_eq!(d["pharmacy_snapshot"]["document"]["paid_minor"], 0);
    assert_eq!(
        d["pharmacy_snapshot"]["document"]["outstanding_minor"],
        3100
    );
}
#[test]
fn expiry_refresh_removes_cached_sellable_stock() {
    let f = Fixture::new();
    f.purchase(10, "2030-12-31", "10");
    let mut c = f.db();
    c.execute("UPDATE batches SET expiry='2020-01-01'", [])
        .unwrap();
    c.execute(
        "UPDATE settings SET value='2019-12-31' WHERE key='stock_day'",
        [],
    )
    .unwrap();
    db::refresh_expired(&mut c).unwrap();
    assert_eq!(
        f.call("detail", json!({"entity":"product","id":f.product}))["on_hand"],
        0
    );
}
#[test]
fn count_and_quarantine_preserve_audited_batch_cost() {
    let f = Fixture::new();
    f.purchase(10, "2030-12-31", "10");
    let batch = f.call("list", json!({"entity":"batches"}))["items"][0]["id"]
        .as_i64()
        .unwrap();
    f.call(
        "adjust_stock",
        json!({"batch_id":batch,"mode":"count","quantity":12,"reason":"Physical count"}),
    );
    let b = f.call("list", json!({"entity":"batches"}))["items"][0].clone();
    assert_eq!(b["quantity"], 12);
    assert_eq!(b["cost_minor"], 12000);
    f.call(
        "adjust_stock",
        json!({"batch_id":batch,"mode":"quarantine","reason":"Damaged packaging"}),
    );
    assert_eq!(
        f.call("detail", json!({"entity":"product","id":f.product}))["on_hand"],
        0
    );
    assert!(f.try_call("post_bill", f.sale_payload(1, "20")).is_err());
}
#[test]
fn query_plans_use_document_and_fefo_indexes() {
    let f = Fixture::new();
    let c = f.db();
    for (sql,index) in [("EXPLAIN QUERY PLAN SELECT id FROM documents WHERE kind='sale' AND id<100 ORDER BY id DESC LIMIT 50","doc_kind_id"),("EXPLAIN QUERY PLAN SELECT id FROM batches WHERE product_id=1 AND status='sellable' AND expiry>='2026-10-13' AND quantity>0 ORDER BY expiry,id","batch_fefo")] {
        let plans=db::json_rows(&c,sql,&[]).unwrap();
        assert!(format!("{plans:?}").contains(index),"{plans:?}");
    }
}

#[test]
fn backup_schedule_is_persisted_and_snapshots_allow_posting() {
    let f = Fixture::new();
    f.purchase(100, "2035-12-31", "10");
    assert!(backup::due(&f.core.root).unwrap());
    std::thread::scope(|scope| {
        let backup_job = scope.spawn(|| backup::run(&f.core.root, true, None, &|_| {}).unwrap());
        for _ in 0..10 {
            f.call("post_bill", f.sale_payload(1, "20"));
        }
        let archive = backup_job.join().unwrap();
        let path = PathBuf::from(archive["path"].as_str().unwrap());
        assert_eq!(backup::inspect(&path).unwrap()["schema_version"], 1);
        let fresh = tempfile::tempdir().unwrap();
        db::init(&fresh.path().join("pharmacy.db")).unwrap();
        backup::restore(fresh.path(), &path, &|_| {}).unwrap();
        let c = db::open(&fresh.path().join("pharmacy.db")).unwrap();
        let check: String = c
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(check, "ok");
        let imbalance:i64=c.query_row("SELECT COUNT(*) FROM products p WHERE p.on_hand<>(SELECT COALESCE(SUM(b.quantity),0) FROM batches b WHERE b.product_id=p.id AND b.status='sellable')",[],|r|r.get(0)).unwrap();
        assert_eq!(imbalance, 0);
    });
    assert!(!backup::due(&f.core.root).unwrap());
    f.db()
        .execute(
            "UPDATE settings SET value=? WHERE key='last_auto_backup'",
            [(chrono::Utc::now() - chrono::Duration::hours(25)).to_rfc3339()],
        )
        .unwrap();
    assert!(backup::due(&f.core.root).unwrap());
}
#[test]
fn csv_export_is_not_limited_to_screen_page_and_honors_permissions() {
    let f = Fixture::new();
    for n in 0..125 {
        f.call(
            "save_party",
            json!({"kind":"customer","name":format!("Export {n}"),"opening":"12.34"}),
        );
    }
    let path = f.core.root.join("accounts.csv");
    let result=f.call("export",json!({"path":path,"job_id":"export-test","query":{"entity":"customers","limit":25,"cursor":"1"}}));
    assert_eq!(result["rows"], 126);
    let text = std::fs::read_to_string(path).unwrap();
    assert_eq!(text.lines().count(), 127);
    assert!(text.contains("balance_AFN"));
    assert!(text.contains("12.34"));
    f.call(
        "save_user",
        json!({"username":"cashier","name":"Cashier","role":"Cashier","password":"cashier-test"}),
    );
    let session = f
        .core
        .call(
            "login",
            json!({"username":"cashier","password":"cashier-test"}),
            None,
            &|_| {},
        )
        .unwrap();
    let result = f.core.call(
        "export",
        json!({"path":f.core.root.join("denied.csv"),"query":{"entity":"customers"}}),
        session["token"].as_str(),
        &|_| {},
    );
    assert_eq!(result.unwrap_err().code, "PERMISSION");
    assert!(!f.core.root.join("denied.csv").exists());
}
