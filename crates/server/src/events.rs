//! Broadcast hub fanning [`ServerEvent`]s out to all SSE subscribers.

use crate::types::ServerEvent;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct EventHub {
    tx: broadcast::Sender<ServerEvent>,
}

impl EventHub {
    pub fn new(capacity: usize) -> Self {
        let (tx, _rx) = broadcast::channel(capacity);
        Self { tx }
    }

    /// Publish an event. Ignored if there are no subscribers.
    pub fn publish(&self, event: ServerEvent) {
        let _ = self.tx.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ServerEvent> {
        self.tx.subscribe()
    }
}
