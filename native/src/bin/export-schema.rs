use std::path::PathBuf;

use yeoyu_core::browser_package;

fn main() -> rustra::Result<()> {
    let generated = browser_package().generate_typescript()?;
    let out = match std::env::var_os("RUSTRA_SCHEMA_OUT") {
        Some(path) if !path.is_empty() => PathBuf::from(path).join("schema.json"),
        _ => PathBuf::from("generated/schema.json"),
    };
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&out, generated.schema_json)?;
    println!("{} written", out.display());
    Ok(())
}
