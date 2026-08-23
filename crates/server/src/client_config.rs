//! In-memory client-facing config: a base value from `config.toml` plus an
//! optional runtime override, set from the attendant UI, that supersedes it.
//!
//! The override is a deliberate escape hatch. A booth may ship with a
//! hardcoded config yet need the label URL changed at the last minute without
//! editing files or restarting. It lives only in memory: a `config.toml` reload
//! refreshes the base but leaves an active override in place, and a reset clears
//! the override so the base takes over again.

use crate::config::ClientCfg;
use crate::types::ClientConfig;

/// Server-side state behind `AppState.client_config`. Mutated under a lock.
/// Read via [`snapshot`](Self::snapshot) to produce the wire DTO sent to
/// clients.
#[derive(Debug, Clone)]
pub struct ClientConfigState {
    /// Value from `config.toml` (`[client] label_url`), refreshed on reload.
    base_label_url: String,
    /// Runtime override. Supersedes `base_label_url` while `Some`. Not persisted.
    label_url_override: Option<String>,
    /// Booth position and zone from `[client]`, refreshed on reload. No runtime
    /// override, so these pass straight through to the snapshot.
    latitude: f64,
    longitude: f64,
    timezone: String,
}

impl ClientConfigState {
    pub fn new(cfg: &ClientCfg) -> Self {
        Self {
            base_label_url: cfg.label_url.clone(),
            label_url_override: None,
            latitude: cfg.latitude,
            longitude: cfg.longitude,
            timezone: cfg.timezone.clone(),
        }
    }

    /// Replace every base value (on config reload). Any active label-URL
    /// override is left in place so it keeps superseding the refreshed base.
    pub fn set_base(&mut self, cfg: &ClientCfg) {
        self.base_label_url = cfg.label_url.clone();
        self.latitude = cfg.latitude;
        self.longitude = cfg.longitude;
        self.timezone = cfg.timezone.clone();
    }

    /// Set the runtime override. Supersedes the base until [`clear_override`]
    /// is called. Callers should pass a non-empty, trimmed URL.
    ///
    /// [`clear_override`]: Self::clear_override
    pub fn set_override(&mut self, url: String) {
        self.label_url_override = Some(url);
    }

    /// Clear the override, reverting to the base (`config.toml`) value.
    pub fn clear_override(&mut self) {
        self.label_url_override = None;
    }

    /// The wire DTO: the effective URL plus whether an override is active.
    pub fn snapshot(&self) -> ClientConfig {
        ClientConfig {
            label_url: self
                .label_url_override
                .clone()
                .unwrap_or_else(|| self.base_label_url.clone()),
            label_url_overridden: self.label_url_override.is_some(),
            latitude: self.latitude,
            longitude: self.longitude,
            timezone: self.timezone.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(label_url: &str) -> ClientCfg {
        ClientCfg {
            label_url: label_url.into(),
            ..ClientCfg::default()
        }
    }

    #[test]
    fn base_only_is_not_overridden() {
        let snap = ClientConfigState::new(&cfg("cfg.url")).snapshot();
        assert_eq!(snap.label_url, "cfg.url");
        assert!(!snap.label_url_overridden);
    }

    #[test]
    fn override_supersedes_base_and_flags_overridden() {
        let mut s = ClientConfigState::new(&cfg("cfg.url"));
        s.set_override("override.url".into());
        let snap = s.snapshot();
        assert_eq!(snap.label_url, "override.url");
        assert!(snap.label_url_overridden);
    }

    #[test]
    fn reload_refreshes_base_but_keeps_active_override() {
        let mut s = ClientConfigState::new(&cfg("cfg.url"));
        s.set_override("override.url".into());
        s.set_base(&cfg("cfg.url.v2"));
        // Override still wins after a base refresh.
        assert_eq!(s.snapshot().label_url, "override.url");
    }

    #[test]
    fn location_passes_through_without_override_machinery() {
        let mut s = ClientConfigState::new(&ClientCfg {
            latitude: -33.87,
            longitude: 151.21,
            timezone: "Australia/Sydney".into(),
            ..ClientCfg::default()
        });
        s.set_override("override.url".into());
        let snap = s.snapshot();
        assert_eq!(snap.latitude, -33.87);
        assert_eq!(snap.longitude, 151.21);
        assert_eq!(snap.timezone, "Australia/Sydney");
    }

    #[test]
    fn reload_refreshes_location() {
        let mut s = ClientConfigState::new(&ClientCfg::default());
        s.set_base(&ClientCfg {
            latitude: 64.15,
            longitude: -21.94,
            timezone: "Atlantic/Reykjavik".into(),
            ..ClientCfg::default()
        });
        let snap = s.snapshot();
        assert_eq!(snap.latitude, 64.15);
        assert_eq!(snap.timezone, "Atlantic/Reykjavik");
    }

    #[test]
    fn clear_override_reverts_to_current_base() {
        let mut s = ClientConfigState::new(&cfg("cfg.url"));
        s.set_override("override.url".into());
        s.set_base(&cfg("cfg.url.v2"));
        s.clear_override();
        let snap = s.snapshot();
        assert_eq!(snap.label_url, "cfg.url.v2");
        assert!(!snap.label_url_overridden);
    }
}
