//! barnguard-server CLI entrypoint. Subcommands live in [`printer_daemon::cli`];
//! this file just parses args and dispatches. The default (no subcommand) is
//! [`Command::Serve`], preserving backwards-compat with existing init scripts.

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "barnguard-server")]
#[command(about = "barnguard kiosk daemon: printer bridge, game log, and web UI")]
#[command(version)]
struct Cli {
    /// Config file path (default: ./config.toml). Overrides $PRINTER_DAEMON_CONFIG.
    #[arg(long, global = true, value_name = "PATH")]
    config: Option<PathBuf>,

    /// Data directory for persisted state (default: ./data). Overrides
    /// $PRINTER_DAEMON_DATA_DIR.
    #[arg(long, global = true, value_name = "PATH")]
    data_dir: Option<PathBuf>,

    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Run the HTTP + SSE server (default when no command is given).
    Serve,
    /// Print the resolved configuration and exit.
    Config,
    /// Inspect the game log.
    Games {
        #[command(subcommand)]
        action: GamesAction,
    },
    /// Print the resolved data-dir and config-file paths.
    Where,
}

#[derive(Subcommand)]
enum GamesAction {
    /// List recorded games (newest first).
    List {
        /// Maximum number of games to print (default: 20).
        #[arg(long, default_value_t = 20)]
        limit: usize,
        /// Skip this many newest entries before printing.
        #[arg(long, default_value_t = 0)]
        offset: usize,
        /// Emit JSON (an array of records) instead of a human table.
        #[arg(long)]
        json: bool,
    },
    /// Print computed high scores (overall + per state).
    HighScores {
        /// Emit JSON instead of a human table.
        #[arg(long)]
        json: bool,
    },
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    // Propagate flag overrides through env so downstream loaders (Config::load,
    // stores) see them without threading an override struct through every call
    // site. Safe pre-async: env::set_var is not marked unsafe on edition 2021.
    if let Some(p) = &cli.config {
        std::env::set_var("PRINTER_DAEMON_CONFIG", p);
    }
    if let Some(p) = &cli.data_dir {
        std::env::set_var("PRINTER_DAEMON_DATA_DIR", p);
    }

    let result: Result<(), Box<dyn std::error::Error>> =
        match cli.command.unwrap_or(Command::Serve) {
            Command::Serve => printer_daemon::run().await,
            Command::Config => printer_daemon::cli::show_config(),
            Command::Where => printer_daemon::cli::show_where(),
            Command::Games { action } => match action {
                GamesAction::List {
                    limit,
                    offset,
                    json,
                } => printer_daemon::cli::list_games(limit, offset, json),
                GamesAction::HighScores { json } => printer_daemon::cli::high_scores(json),
            },
        };

    if let Err(e) = result {
        eprintln!("barnguard-server: {e}");
        std::process::exit(1);
    }
}
