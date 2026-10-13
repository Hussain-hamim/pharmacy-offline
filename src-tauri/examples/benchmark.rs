//! Reproducible, isolated scale benchmark. Never touches the installed database.
use pharmacy_lib::{db, Core};
use serde_json::{json, Value};
use std::{path::PathBuf, time::Instant};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or(std::env::current_dir()?.join("artifacts/benchmark"));
    std::fs::create_dir_all(&root)?;
    let core = Core::new(root.clone())?;
    let bootstrap = core.call("bootstrap", json!({}), None, &|_| {})?;
    let session = if bootstrap["needs_setup"] == true {
        core.call("setup",json!({"name":"Benchmark","username":"benchmark","password":"benchmark-isolated","role":"Administrator"}),None,&|_|{})?
    } else {
        core.call(
            "login",
            json!({"username":"benchmark","password":"benchmark-isolated"}),
            None,
            &|_| {},
        )?
    };
    let token = session["token"].as_str();
    let c = db::open(&root.join("pharmacy.db"))?;
    let count: i64 = c.query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))?;
    if count == 0 {
        let start = Instant::now();
        println!("Seeding 100,000 products, 1,000,000 documents, 5,000,000 lines...");
        c.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA max_page_count=460800; BEGIN IMMEDIATE;
WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000) INSERT INTO products(id,name,search_name,generic,base_unit,reorder_level,on_hand) SELECT x,'Medicine '||printf('%06d',x),'medicine '||printf('%06d',x),'Paracetamol','tablet',10,100000 FROM n;
INSERT INTO product_units(product_id,name,multiplier,price_minor) SELECT id,'tablet',1,2000 FROM products;
INSERT INTO batches(product_id,number,expiry,quantity,cost_minor) SELECT id,'PERF-'||id,'2035-12-31',100000,100000000 FROM products;
WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000) INSERT INTO documents(id,request_id,kind,number,date,subtotal_minor,discount_minor,total_minor,paid_minor,cost_minor,pharmacy_snapshot,actor_id) SELECT x,'perf-'||x,'sale','INV-PERF-'||printf('%09d',x),date('2024-01-01','+'||(x%730)||' days'),10000,0,10000,10000,5000,'{}',1 FROM n;
INSERT INTO document_lines(document_id,product_id,name,unit,multiplier,quantity,base_quantity,price_minor,discount_minor,total_minor,cost_minor) SELECT d.id,((d.id+n.x)%100000)+1,'Medicine '||printf('%06d',((d.id+n.x)%100000)+1),'tablet',1,1,1,2000,0,2000,1000 FROM documents d CROSS JOIN (SELECT 0 x UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) n;
INSERT INTO daily_totals(date,sales_minor,cost_minor,receipts_minor,sale_count) SELECT date,SUM(total_minor),SUM(cost_minor),SUM(paid_minor),COUNT(*) FROM documents GROUP BY date;
COMMIT; ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);")?;
        println!("Seed completed in {:.2}s", start.elapsed().as_secs_f64());
    }
    let cases = [
        (
            "products first page",
            json!({"entity":"products","limit":50}),
        ),
        (
            "products deep page",
            json!({"entity":"products","limit":50,"cursor":"20000"}),
        ),
        (
            "product FTS search",
            json!({"entity":"products","limit":50,"search":"medicine 087654"}),
        ),
        ("sales first page", json!({"entity":"sales","limit":50})),
        (
            "sales deep page",
            json!({"entity":"sales","limit":50,"cursor":"100000"}),
        ),
        (
            "date-filtered sales",
            json!({"entity":"sales","limit":50,"from":"2025-10-01","to":"2025-10-31"}),
        ),
    ];
    let mut results = vec![];
    for (name, p) in cases {
        let mut times = vec![];
        for _ in 0..50 {
            let start = Instant::now();
            core.call("list", p.clone(), token, &|_| {})?;
            times.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        times.sort_by(f64::total_cmp);
        results.push(json!({"name":name,"p50_ms":times[25],"p95_ms":times[47],"max_ms":times[49]}));
    }
    let mut posts = vec![];
    for i in 0..25 {
        let now = Instant::now();
        core.call("post_bill",json!({"kind":"sale","party_id":null,"date":db::today(),"request_id":uuid::Uuid::new_v4().to_string(),"lines":[{"product_id":i+1,"unit_id":i+1,"quantity":1,"price":"20"}],"paid":"20"}),token,&|_|{})?;
        posts.push(now.elapsed().as_secs_f64() * 1000.0);
    }
    posts.sort_by(f64::total_cmp);
    let output: Value = json!({"platform":std::env::consts::OS,"architecture":std::env::consts::ARCH,"profile":if cfg!(debug_assertions){"debug"}else{"release"},"products":100000,"documents":1000000,"lines":5000000,"database_bytes":std::fs::metadata(root.join("pharmacy.db"))?.len(),"read_results":results,"posting_p95_ms":posts[23],"generated_at":db::now(),"note":"Host measurement; repeat on the target Windows hardware before release acceptance."});
    std::fs::write(
        root.join("results.json"),
        serde_json::to_string_pretty(&output)?,
    )?;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
