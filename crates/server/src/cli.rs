//! CLI subcommands invoked by `main.rs`. Each function reads config + the
//! relevant JSON store, prints to stdout, and returns. No HTTP server, no
//! tokio runtime required. Kept synchronous — these are one-shot inspections.

use crate::config::Config;
use crate::store::load_games;
use crate::types::HighScores;
use std::error::Error;

pub fn show_config() -> Result<(), Box<dyn Error>> {
    let cfg = Config::load()?;
    println!("backend = {:?}", cfg.backend);
    println!("bind = {:?}", cfg.bind);
    println!("allowed_origins = {:?}", cfg.allowed_origins);
    println!("log_buffer_size = {}", cfg.log_buffer_size);
    println!("data_dir = {}", cfg.data_dir.display());
    println!();
    println!("[printer]");
    println!("  host = {:?}", cfg.printer.host);
    println!("  port = {}", cfg.printer.port);
    println!(
        "  timeouts (ms): connect={} response={} print={}",
        cfg.printer.connect_timeout_ms,
        cfg.printer.response_timeout_ms,
        cfg.printer.print_timeout_ms,
    );
    println!();
    println!("[print]");
    println!("  mode = {:?}", cfg.print.mode);
    println!("  cut_mode = {:?}", cfg.print.cut_mode);
    println!(
        "  img = {}x{}",
        cfg.print.img_width, cfg.print.img_height
    );
    println!();
    println!("[mock]");
    println!("  out_dir = {:?}", cfg.mock.out_dir);
    println!(
        "  print_ms={} cut_ms={} tape_width_mm={}",
        cfg.mock.print_ms, cfg.mock.cut_ms, cfg.mock.tape_width_mm
    );
    Ok(())
}

pub fn show_where() -> Result<(), Box<dyn Error>> {
    let cfg = Config::load()?;
    let config_path = Config::resolved_config_path();
    println!("config: {}", config_path.display());
    println!(
        "  (file {})",
        if config_path.exists() {
            "found"
        } else {
            "absent — using defaults"
        }
    );
    println!("data-dir: {}", cfg.data_dir.display());
    Ok(())
}

pub fn list_games(limit: usize, offset: usize, json: bool) -> Result<(), Box<dyn Error>> {
    let cfg = Config::load()?;
    let games = load_games(&cfg.data_dir)?;
    // Newest-first slice.
    let slice: Vec<_> = games
        .iter()
        .rev()
        .skip(offset)
        .take(limit)
        .cloned()
        .collect();

    if json {
        println!("{}", serde_json::to_string_pretty(&slice)?);
        return Ok(());
    }

    if slice.is_empty() {
        println!("(no games recorded)");
        return Ok(());
    }
    println!(
        "{:<38}  {:>7}  {:<12}  {:<14}  {:>6}s  when",
        "id", "score", "state", "reason", "dur"
    );
    for g in &slice {
        println!(
            "{:<38}  {:>7}  {:<12}  {:<14}  {:>6.1}  {}",
            g.id,
            g.score,
            g.state_id,
            g.reason,
            g.duration_ms as f64 / 1000.0,
            format_ts(g.ts_ms),
        );
    }
    Ok(())
}

pub fn high_scores(json: bool) -> Result<(), Box<dyn Error>> {
    let cfg = Config::load()?;
    let games = load_games(&cfg.data_dir)?;
    let hs = HighScores::from_games(&games);

    if json {
        println!("{}", serde_json::to_string_pretty(&hs)?);
        return Ok(());
    }
    println!("overall: {}", hs.overall);
    if hs.by_state.is_empty() {
        println!("(no per-state entries)");
    } else {
        let mut rows: Vec<_> = hs.by_state.iter().collect();
        rows.sort_by(|a, b| b.1.cmp(a.1));
        for (state, score) in rows {
            println!("  {state:<20} {score}");
        }
    }
    Ok(())
}

fn format_ts(ts_ms: u64) -> String {
    // Cheap + dependency-free: emit a Unix ms timestamp. Operators can pipe
    // through `date -r $(( ts / 1000 ))` if they want it formatted; keeps
    // chrono out of the dep tree.
    format!("ts={ts_ms}")
}
