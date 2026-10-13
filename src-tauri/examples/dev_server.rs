//! Debug-only browser verification bridge. Never included in the desktop build.
use pharmacy_lib::Core;
use serde_json::{json, Value};
use std::sync::Arc;
#[allow(clippy::assertions_on_constants)]
fn main() {
    assert!(
        cfg!(debug_assertions),
        "The development bridge cannot run in release mode"
    );
    let root = std::env::args()
        .nth(1)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap().join(".dev-data"));
    let core = Arc::new(Core::new(root).expect("initialize development database"));
    let server = tiny_http::Server::http("127.0.0.1:1421").expect("bind development bridge");
    println!("Development bridge listening at http://127.0.0.1:1421 (isolated local database)");
    for mut req in server.incoming_requests() {
        let core = core.clone();
        std::thread::spawn(move || {
            if req.method() != &tiny_http::Method::Post {
                let _ = req.respond(tiny_http::Response::empty(405));
                return;
            }
            if let Some(origin) = req.headers().iter().find(|h| h.field.equiv("Origin")) {
                if !["http://127.0.0.1:1420", "http://localhost:1420"]
                    .contains(&origin.value.as_str())
                {
                    let _ = req.respond(tiny_http::Response::empty(403));
                    return;
                }
            }
            let mut text = String::new();
            use std::io::Read;
            if req
                .as_reader()
                .take(4_000_000)
                .read_to_string(&mut text)
                .is_err()
            {
                return;
            }
            let payload: Value = serde_json::from_str(&text).unwrap_or(json!({}));
            let action = payload["action"].as_str().unwrap_or("");
            let result = core.call(
                action,
                payload["payload"].clone(),
                payload["token"].as_str(),
                &|_| {},
            );
            let (status, value) = match result {
                Ok(v) => (200, v),
                Err(e) => (400, json!(e)),
            };
            let response = tiny_http::Response::from_string(value.to_string())
                .with_status_code(status)
                .with_header(
                    tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap(),
                );
            let _ = req.respond(response);
        });
    }
}
