//! CLI subcommands invoked by `main.rs`. Each function reads config + the
//! relevant JSON store, prints to stdout, and returns. No HTTP server. All are
//! synchronous one-shot inspections except [`usb_probe`], which talks to the
//! printer.

use crate::backend_factory::usb_opts;
use crate::config::Config;
use crate::store::load_games;
use crate::types::{DisplayHighScores, GameDetails, DISPLAY_ARCADE, DISPLAY_ENTERPRISE};
use std::error::Error;
use std::path::PathBuf;

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
    println!("[usb]");
    println!(
        "  id = {}:{} serial = {:?}",
        cfg.usb.vendor_id, cfg.usb.product_id, cfg.usb.serial
    );
    println!(
        "  read_mode = {:?} cut_trigger = {:?} hold_interface = {} write_only_print_ms = {}",
        cfg.usb.read_mode, cfg.usb.cut_trigger, cfg.usb.hold_interface, cfg.usb.write_only_print_ms
    );
    println!();
    println!("[print]");
    println!("  mode = {:?}", cfg.print.mode);
    println!("  cut_mode = {:?}", cfg.print.cut_mode);
    println!("  img = {}x{}", cfg.print.img_width, cfg.print.img_height);
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
            "absent, using defaults"
        }
    );
    println!("data-dir: {}", cfg.data_dir.display());
    Ok(())
}

/// Run the USB probe against the configured printer. `read_mode` and
/// `cut_trigger` override the config for the test print, so each cut trigger
/// can be tried without editing `config.toml`.
pub async fn usb_probe(
    print: Option<PathBuf>,
    read_mode: Option<String>,
    cut_trigger: Option<String>,
) -> Result<(), Box<dyn Error>> {
    let mut cfg = Config::load()?;
    if let Some(m) = read_mode {
        cfg.usb.read_mode = m;
    }
    if let Some(t) = cut_trigger {
        cfg.usb.cut_trigger = t;
    }
    // Surface a bad override as an error instead of the silent fallback in
    // usb_opts.
    cfg.usb.vendor_id()?;
    cfg.usb.product_id()?;
    cfg.usb.read_mode()?;
    cfg.usb.cut_trigger()?;
    let opts = usb_opts(&cfg);
    let jpeg = print.map(std::fs::read).transpose()?;
    let test_print = jpeg.as_deref().map(|j| (j, cfg.print.opts()));
    printer_driver::backend::usb::probe(&opts, test_print, &mut std::io::stdout()).await?;
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
        "{:<38}  {:<14}  {:>7}  {:<12}  {:<14}  {:>6}s  when",
        "id", "display", "score", "state", "reason", "dur"
    );
    for g in &slice {
        let (state, reason) = match &g.details {
            GameDetails::Enterprise(d) => (d.state_id.as_str(), d.reason.to_string()),
            GameDetails::Arcade(d) => (
                d.game_id.as_str(),
                match &d.winner {
                    Some(w) => format!("{} ({w})", d.mode),
                    None => d.mode.clone(),
                },
            ),
        };
        println!(
            "{:<38}  {:<14}  {:>7}  {:<12}  {:<14}  {:>6.1}  {}",
            g.id,
            g.display_id(),
            g.score,
            state,
            reason,
            g.duration_ms as f64 / 1000.0,
            format_ts(g.ts_ms),
        );
    }
    Ok(())
}

pub fn high_scores(json: bool) -> Result<(), Box<dyn Error>> {
    let cfg = Config::load()?;
    let games = load_games(&cfg.data_dir)?;
    let all: Vec<DisplayHighScores> = [DISPLAY_ENTERPRISE, DISPLAY_ARCADE]
        .into_iter()
        .map(|d| DisplayHighScores::from_games(d, &games))
        .collect();

    if json {
        println!("{}", serde_json::to_string_pretty(&all)?);
        return Ok(());
    }
    for hs in all {
        match hs {
            DisplayHighScores::Enterprise(hs) => {
                println!("display: {DISPLAY_ENTERPRISE}");
                if hs.by_map.is_empty() {
                    println!("(no entries)");
                }
                let mut maps: Vec<_> = hs.by_map.iter().collect();
                maps.sort_by(|a, b| b.1.cmp(a.1));
                for (map_id, best) in maps {
                    println!("map {map_id}: best {best}");
                    match hs.by_state.get(map_id) {
                        None => println!("  (no per-region entries)"),
                        Some(regions) => {
                            let mut rows: Vec<_> = regions.iter().collect();
                            rows.sort_by(|a, b| b.1.cmp(a.1));
                            for (region, score) in rows {
                                println!("  {region:<20} {score}");
                            }
                        }
                    }
                }
            }
            DisplayHighScores::Arcade(hs) => {
                println!("display: {DISPLAY_ARCADE}");
                if hs.by_game.is_empty() {
                    println!("(no per-game entries)");
                } else {
                    let mut rows: Vec<_> = hs.by_game.iter().collect();
                    rows.sort_by(|a, b| b.1.cmp(a.1));
                    for (game, score) in rows {
                        println!("  {game:<20} {score}");
                    }
                }
            }
        }
        println!();
    }
    Ok(())
}

fn format_ts(ts_ms: u64) -> String {
    // Cheap + dependency-free: emit a Unix ms timestamp. Operators can pipe
    // through `date -r $(( ts / 1000 ))` if they want it formatted. Keeps
    // chrono out of the dep tree.
    format!("ts={ts_ms}")
}
