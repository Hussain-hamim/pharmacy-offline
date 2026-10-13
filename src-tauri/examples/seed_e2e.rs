//! Seed a named, disposable desktop test directory. Never use with production data.
use pharmacy_lib::Core;
use serde_json::{json, Value};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::args()
        .nth(1)
        .ok_or("Supply a new isolated test directory")?;
    let core = Core::new(root.into())?;
    let session=core.call("setup",json!({"name":"Desktop Test","username":"e2e","password":"desktop-test-2026","role":"Administrator"}),None,&|_|{})?;
    let call = |action: &str, payload: Value| {
        core.call(action, payload, session["token"].as_str(), &|_| {})
    };
    let supplier = call(
        "save_party",
        json!({"kind":"supplier","name":"Test Supplier","opening":"0"}),
    )?;
    let product = call(
        "save_product",
        json!({"name":"Test Medicine","base_unit":"tablet","reorder_level":10,"units":[{"name":"tablet","multiplier":1,"price":"20"}]}),
    )?;
    let detail = call("detail", json!({"entity":"product","id":product["id"]}))?;
    call(
        "post_bill",
        json!({"kind":"purchase","party_id":supplier["id"],"date":"2026-10-13","request_id":"e2e-purchase","paid":"0","lines":[{"product_id":product["id"],"unit_id":detail["units"][0]["id"],"quantity":100,"price":"10","batch_number":"TEST-001","expiry":"2035-12-31"}]}),
    )?;
    println!("Isolated desktop fixture created");
    Ok(())
}
