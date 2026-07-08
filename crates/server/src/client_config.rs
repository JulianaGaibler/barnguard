//! In-memory client-facing config: a base value from `config.toml` plus an
//! optional runtime override, set from the attendant UI, that supersedes it.
//!
//! The override is a deliberate escape hatch — a booth may ship with a
//! hardcoded config yet need the label URL changed at the last minute without
//! editing files or restarting. It lives only in memory: a `config.toml` reload
//! refreshes the base but leaves an active override in place, and a reset clears
//! the override so the base takes over again.

use crate::types::ClientConfig;

/// Server-side state behind `AppState.client_config`. Mutated under a lock; read
/// via [`snapshot`](Self::snapshot) to produce the wire DTO sent to clients.
#[derive(Debug, Clone)]
pub struct ClientConfigState {
    /// Value from `config.toml` (`[client] label_url`), refreshed on reload.
    base_label_url: String,
    /// Runtime override; supersedes `base_label_url` while `Some`. Not persisted.
    label_url_override: Option<String>,
}

impl ClientConfigState {
    pub fn new(base_label_url: String) -> Self {
        Self {
            base_label_url,
            label_url_override: None,
        }
    }

    /// Replace the base value (on config reload). Any active override is left in
    /// place so it keeps superseding the refreshed base.
    pub fn set_base_label_url(&mut self, url: String) {
        self.base_label_url = url;
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
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_only_is_not_overridden() {
        let snap = ClientConfigState::new("cfg.url".into()).snapshot();
        assert_eq!(snap.label_url, "cfg.url");
        assert!(!snap.label_url_overridden);
    }

    #[test]
    fn override_supersedes_base_and_flags_overridden() {
        let mut s = ClientConfigState::new("cfg.url".into());
        s.set_override("override.url".into());
        let snap = s.snapshot();
        assert_eq!(snap.label_url, "override.url");
        assert!(snap.label_url_overridden);
    }

    #[test]
    fn reload_refreshes_base_but_keeps_active_override() {
        let mut s = ClientConfigState::new("cfg.url".into());
        s.set_override("override.url".into());
        s.set_base_label_url("cfg.url.v2".into());
        // Override still wins after a base refresh.
        assert_eq!(s.snapshot().label_url, "override.url");
    }

    #[test]
    fn clear_override_reverts_to_current_base() {
        let mut s = ClientConfigState::new("cfg.url".into());
        s.set_override("override.url".into());
        s.set_base_label_url("cfg.url.v2".into());
        s.clear_override();
        let snap = s.snapshot();
        assert_eq!(snap.label_url, "cfg.url.v2");
        assert!(!snap.label_url_overridden);
    }
}
