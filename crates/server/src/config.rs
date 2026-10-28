//! Daemon configuration: a TOML file (path from `--config`-less
//! `PRINTER_DAEMON_CONFIG`, default `./config.toml`) with per-key env overrides.

use printer_driver::{CutMode, PrintMode, PrintOpts, UsbCutTrigger, UsbReadMode};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Config {
    pub backend: String,
    pub bind: String,
    pub allowed_origins: Vec<String>,
    pub printer: PrinterCfg,
    pub usb: UsbCfg,
    pub print: PrintCfg,
    pub timing: TimingCfg,
    pub mock: MockCfg,
    /// Client-facing values pushed to the web app (reloadable at runtime).
    pub client: ClientCfg,
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
            usb: UsbCfg::default(),
            print: PrintCfg::default(),
            timing: TimingCfg::default(),
            mock: MockCfg::default(),
            client: ClientCfg::default(),
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

/// USB backend settings (TOML `[usb]`). Strings on disk so the TOML stays
/// readable (hex IDs, named modes); parsed and validated in [`Config::validate`].
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct UsbCfg {
    /// Hex, with or without a `0x` prefix.
    pub vendor_id: String,
    pub product_id: String,
    /// Pick this printer when several are plugged in. Empty means any.
    pub serial: String,
    pub read_mode: String,
    pub cut_trigger: String,
    pub hold_interface: bool,
    pub write_only_print_ms: u64,
}

impl Default for UsbCfg {
    fn default() -> Self {
        Self {
            vendor_id: "04f9".into(),
            product_id: "20b0".into(),
            serial: String::new(),
            read_mode: "bidirectional".into(),
            cut_trigger: "none".into(),
            hold_interface: true,
            write_only_print_ms: 15000,
        }
    }
}

fn parse_hex_id(field: &str, value: &str) -> Result<u16, String> {
    let digits = value
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    u16::from_str_radix(digits, 16)
        .map_err(|_| format!("usb.{field} {value:?} is not a 16-bit hex ID"))
}

impl UsbCfg {
    pub fn vendor_id(&self) -> Result<u16, String> {
        parse_hex_id("vendor_id", &self.vendor_id)
    }

    pub fn product_id(&self) -> Result<u16, String> {
        parse_hex_id("product_id", &self.product_id)
    }

    pub fn serial(&self) -> Option<String> {
        let s = self.serial.trim();
        (!s.is_empty()).then(|| s.to_string())
    }

    pub fn read_mode(&self) -> Result<UsbReadMode, String> {
        match self.read_mode.to_ascii_lowercase().as_str() {
            "bidirectional" => Ok(UsbReadMode::Bidirectional),
            "write_only" => Ok(UsbReadMode::WriteOnly),
            other => Err(format!(
                "unknown usb.read_mode {other:?} (expected \"bidirectional\" or \"write_only\")"
            )),
        }
    }

    pub fn cut_trigger(&self) -> Result<UsbCutTrigger, String> {
        match self.cut_trigger.to_ascii_lowercase().as_str() {
            "none" => Ok(UsbCutTrigger::None),
            "zlp" => Ok(UsbCutTrigger::ZeroLengthPacket),
            "soft_reset" => Ok(UsbCutTrigger::SoftReset),
            other => Err(format!(
                "unknown usb.cut_trigger {other:?} (expected \"none\", \"zlp\" or \"soft_reset\")"
            )),
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

/// Client-facing config (TOML `[client]`). Snake_case on disk, mapped to the
/// camelCase [`ClientConfig`] DTO before it's sent to the browser.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct ClientCfg {
    /// URL printed top-right on every result label.
    pub label_url: String,
    /// Booth latitude in degrees, north positive. Positions the sun for the
    /// arcade launcher's time-of-day sky.
    pub latitude: f64,
    /// Booth longitude in degrees, east positive.
    pub longitude: f64,
    /// IANA zone name, used only to resolve the launcher's wall-clock dev
    /// overrides. The sky itself runs on UTC and needs no zone.
    pub timezone: String,
}

impl Default for ClientCfg {
    fn default() -> Self {
        Self {
            label_url: "mzl.la/enterprise".into(),
            latitude: 52.52,
            longitude: 13.405,
            timezone: "Europe/Berlin".into(),
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
        if let Ok(v) = std::env::var("PRINTER_DAEMON_USB_SERIAL") {
            self.usb.serial = v;
        }
        if let Ok(v) = std::env::var("PRINTER_DAEMON_USB_READ_MODE") {
            if !v.is_empty() {
                self.usb.read_mode = v;
            }
        }
        if let Ok(v) = std::env::var("PRINTER_DAEMON_USB_CUT_TRIGGER") {
            if !v.is_empty() {
                self.usb.cut_trigger = v;
            }
        }
        if let Ok(v) = std::env::var("PRINTER_DAEMON_USB_WRITE_ONLY_PRINT_MS") {
            if let Ok(n) = v.parse() {
                self.usb.write_only_print_ms = n;
            }
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
        if let Ok(v) = std::env::var("PRINTER_DAEMON_CLIENT_LABEL_URL") {
            if !v.is_empty() {
                self.client.label_url = v;
            }
        }
        if let Ok(v) = std::env::var("PRINTER_DAEMON_CLIENT_LATITUDE") {
            if let Ok(n) = v.parse() {
                self.client.latitude = n;
            }
        }
        if let Ok(v) = std::env::var("PRINTER_DAEMON_CLIENT_LONGITUDE") {
            if let Ok(n) = v.parse() {
                self.client.longitude = n;
            }
        }
        if let Ok(v) = std::env::var("PRINTER_DAEMON_CLIENT_TIMEZONE") {
            if !v.is_empty() {
                self.client.timezone = v;
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
        if !matches!(self.backend.as_str(), "mock" | "tcp" | "usb") {
            return Err(format!(
                "unknown backend {:?} (expected \"mock\", \"tcp\" or \"usb\")",
                self.backend
            ));
        }
        if self.backend == "usb" {
            self.usb.vendor_id()?;
            self.usb.product_id()?;
            self.usb.cut_trigger()?;
            // Otherwise every write-only job ends with an idle_timeout warning
            // before the estimated print time is up.
            if self.usb.read_mode()? == UsbReadMode::WriteOnly
                && self.usb.write_only_print_ms + self.timing.cut_wait_ms
                    >= self.timing.idle_timeout_ms
            {
                return Err(format!(
                    "usb.write_only_print_ms ({}) + timing.cut_wait_ms ({}) must be less than \
                     timing.idle_timeout_ms ({})",
                    self.usb.write_only_print_ms,
                    self.timing.cut_wait_ms,
                    self.timing.idle_timeout_ms
                ));
            }
        }
        if !(-90.0..=90.0).contains(&self.client.latitude) {
            return Err(format!(
                "client.latitude {} is outside [-90, 90]",
                self.client.latitude
            ));
        }
        if !(-180.0..=180.0).contains(&self.client.longitude) {
            return Err(format!(
                "client.longitude {} is outside [-180, 180]",
                self.client.longitude
            ));
        }
        if self.client.timezone.trim().is_empty() {
            return Err("client.timezone must not be empty".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_section_parses_and_maps_to_dto() {
        let cfg: Config = toml::from_str(
            r#"
            backend = "mock"
            [client]
            label_url = "mzl.la/booth"
            "#,
        )
        .unwrap();
        assert_eq!(cfg.client.label_url, "mzl.la/booth");
    }

    #[test]
    fn missing_client_section_falls_back_to_default() {
        let cfg: Config = toml::from_str(r#"backend = "mock""#).unwrap();
        assert_eq!(cfg.client.label_url, "mzl.la/enterprise");
        assert_eq!(cfg.client.latitude, 52.52);
        assert_eq!(cfg.client.timezone, "Europe/Berlin");
    }

    #[test]
    fn partial_client_section_defaults_the_rest() {
        let cfg: Config = toml::from_str(
            r#"
            backend = "mock"
            [client]
            latitude = 64.15
            "#,
        )
        .unwrap();
        assert_eq!(cfg.client.latitude, 64.15);
        assert_eq!(cfg.client.longitude, 13.405);
        assert_eq!(cfg.client.label_url, "mzl.la/enterprise");
    }

    #[test]
    fn usb_section_parses_with_defaults() {
        let cfg: Config = toml::from_str(
            r#"
            backend = "usb"
            [usb]
            vendor_id = "0x04F9"
            read_mode = "write_only"
            "#,
        )
        .unwrap();
        assert!(cfg.validate().is_ok());
        assert_eq!(cfg.usb.vendor_id(), Ok(0x04f9));
        assert_eq!(cfg.usb.product_id(), Ok(0x20b0));
        assert_eq!(cfg.usb.read_mode(), Ok(UsbReadMode::WriteOnly));
        assert_eq!(cfg.usb.cut_trigger(), Ok(UsbCutTrigger::None));
        assert_eq!(cfg.usb.serial(), None);
    }

    #[test]
    fn bad_usb_settings_are_rejected() {
        let mut cfg = Config {
            backend: "usb".into(),
            ..Config::default()
        };
        assert!(cfg.validate().is_ok());

        cfg.usb.read_mode = "sometimes".into();
        assert!(cfg.validate().is_err());
        cfg.usb.read_mode = "bidirectional".into();

        cfg.usb.vendor_id = "brother".into();
        assert!(cfg.validate().is_err());
        cfg.usb.vendor_id = "04f9".into();

        cfg.usb.cut_trigger = "scissors".into();
        assert!(cfg.validate().is_err());
        cfg.usb.cut_trigger = "zlp".into();

        // The estimated print time must fit inside the idle timeout.
        cfg.usb.read_mode = "write_only".into();
        cfg.usb.write_only_print_ms = 28000;
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn out_of_range_latitude_is_rejected() {
        let mut cfg = Config::default();
        cfg.client.latitude = 91.0;
        assert!(cfg.validate().is_err());
    }
}
