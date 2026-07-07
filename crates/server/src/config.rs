//! Daemon configuration: a TOML file (path from `--config`-less
//! `PRINTER_DAEMON_CONFIG`, default `./config.toml`) with per-key env overrides.

use printer_driver::{CutMode, PrintMode, PrintOpts};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Config {
    pub backend: String,
    pub bind: String,
    pub allowed_origins: Vec<String>,
    pub printer: PrinterCfg,
    pub print: PrintCfg,
    pub timing: TimingCfg,
    pub mock: MockCfg,
    /// Max entries kept in the in-memory message-log ring (surfaced to the UI).
    pub log_buffer_size: usize,
    /// Directory for persisted server state (state.json, games.json). Created on
    /// boot if missing. Resolved to an absolute path against the working dir.
    pub data_dir: PathBuf,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            backend: "mock".into(),
            bind: "127.0.0.1:9110".into(),
            allowed_origins: vec!["http://localhost:5173".into()],
            printer: PrinterCfg::default(),
            print: PrintCfg::default(),
            timing: TimingCfg::default(),
            mock: MockCfg::default(),
            log_buffer_size: 100,
            data_dir: PathBuf::from("./data"),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct PrinterCfg {
    pub host: String,
    pub port: u16,
    pub connect_timeout_ms: u64,
    pub response_timeout_ms: u64,
    pub print_timeout_ms: u64,
}

impl Default for PrinterCfg {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 9100,
            connect_timeout_ms: 3000,
            response_timeout_ms: 10000,
            print_timeout_ms: 120000,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct PrintCfg {
    pub mode: String,
    pub cut_mode: String,
    pub img_width: u32,
    pub img_height: u32,
}

impl Default for PrintCfg {
    fn default() -> Self {
        Self {
            mode: "vivid".into(),
            cut_mode: "full".into(),
            img_width: 0,
            img_height: 0,
        }
    }
}

impl PrintCfg {
    pub fn mode(&self) -> PrintMode {
        match self.mode.to_ascii_lowercase().as_str() {
            "normal" | "color" => PrintMode::Normal,
            _ => PrintMode::Vivid,
        }
    }

    pub fn cut(&self) -> CutMode {
        match self.cut_mode.to_ascii_lowercase().as_str() {
            "half" => CutMode::Half,
            "none" => CutMode::None,
            _ => CutMode::Full,
        }
    }

    pub fn opts(&self) -> PrintOpts {
        PrintOpts {
            mode: self.mode(),
            cut: self.cut(),
            img_w: self.img_width,
            img_h: self.img_height,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct TimingCfg {
    pub cut_wait_ms: u64,
    pub poll_interval_ms: u64,
    pub idle_timeout_ms: u64,
    pub keepalive_interval_ms: u64,
    /// Fast idle-poll rate used while the booth is "active" (see active_linger_ms).
    pub active_interval_ms: u64,
    /// Stay on the fast rate for this long after the last job finishes, then
    /// relax to the slow keepalive rate.
    pub active_linger_ms: u64,
    pub max_retries: u32,
}

impl Default for TimingCfg {
    fn default() -> Self {
        Self {
            cut_wait_ms: 3000,
            poll_interval_ms: 2500,
            idle_timeout_ms: 30000,
            keepalive_interval_ms: 30000,
            active_interval_ms: 3000,
            active_linger_ms: 30000,
            max_retries: 1,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct MockCfg {
    pub out_dir: String,
    pub print_ms: u64,
    pub cut_ms: u64,
    pub tape_width_mm: f32,
    pub force_no_media: bool,
    pub force_awaiting_removal: bool,
}

impl Default for MockCfg {
    fn default() -> Self {
        Self {
            out_dir: "./mock-out".into(),
            print_ms: 1500,
            cut_ms: 800,
            tape_width_mm: 25.0,
            force_no_media: false,
            force_awaiting_removal: false,
        }
    }
}

impl Config {
    /// Load from `$PRINTER_DAEMON_CONFIG` (default `config.toml`), falling back
    /// to defaults if the file is absent, then apply env overrides + validate.
    pub fn load() -> Result<Self, Box<dyn std::error::Error>> {
        let path =
            std::env::var("PRINTER_DAEMON_CONFIG").unwrap_or_else(|_| "config.toml".to_string());
        let mut cfg = if std::path::Path::new(&path).exists() {
            let text = std::fs::read_to_string(&path)?;
            toml::from_str(&text)?
        } else {
            Config::default()
        };
        cfg.apply_env();
        cfg.validate()?;
        Ok(cfg)
    }

    fn apply_env(&mut self) {
        if let Ok(v) = std::env::var("PRINTER_DAEMON_BACKEND") {
            self.backend = v;
        }
        if let Ok(v) = std::env::var("PRINTER_DAEMON_BIND") {
            self.bind = v;
        }
        if let Ok(v) = std::env::var("PRINTER_DAEMON_PRINTER_HOST") {
            self.printer.host = v;
        }
        if let Ok(v) = std::env::var("PRINTER_DAEMON_MOCK_OUT_DIR") {
            self.mock.out_dir = v;
        }
        if let Ok(v) = std::env::var("PRINTER_DAEMON_LOG_BUFFER_SIZE") {
            if let Ok(n) = v.parse() {
                self.log_buffer_size = n;
            }
        }
        if let Ok(v) = std::env::var("PRINTER_DAEMON_DATA_DIR") {
            if !v.is_empty() {
                self.data_dir = PathBuf::from(v);
            }
        }
    }

    /// Resolved config-file path (`$PRINTER_DAEMON_CONFIG` or `./config.toml`),
    /// regardless of whether the file exists. Useful for the CLI `where` and
    /// `config` subcommands.
    pub fn resolved_config_path() -> PathBuf {
        PathBuf::from(
            std::env::var("PRINTER_DAEMON_CONFIG").unwrap_or_else(|_| "config.toml".to_string()),
        )
    }

    fn validate(&self) -> Result<(), String> {
        if self.backend == "tcp" && self.printer.host.trim().is_empty() {
            return Err("printer.host is required when backend = \"tcp\"".into());
        }
        if self.backend != "tcp" && self.backend != "mock" {
            return Err(format!(
                "unknown backend {:?} (expected \"mock\" or \"tcp\")",
                self.backend
            ));
        }
        Ok(())
    }
}
