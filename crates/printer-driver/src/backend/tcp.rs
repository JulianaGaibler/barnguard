//! Real Brother VC-500W backend over raw TCP (port 9100, XML-over-TCP).
//!
//! The cut quirk is handled by the caller, not here: `send_print` writes the
//! command + JPEG and awaits the acks but leaves the socket open;
//! `close_for_cut` drops it to trigger the cut.

use super::protocol::{self, Framed, ParseOutcome};
use super::{ConfigCache, PrinterBackend};
use crate::error::PrinterError;
use crate::types::{PrintOpts, PrinterConfigInfo, PrinterHealth, PrinterState};
use async_trait::async_trait;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

/// Timeouts for a TCP backend, in the same units used by the printer's
/// protocol phases.
#[derive(Debug, Clone, Copy)]
pub struct TcpTimeouts {
    pub connect: Duration,
    pub response: Duration,
    pub print: Duration,
}

impl Default for TcpTimeouts {
    fn default() -> Self {
        Self {
            connect: Duration::from_millis(3000),
            response: Duration::from_millis(10_000),
            print: Duration::from_millis(120_000),
        }
    }
}

pub struct TcpBackend {
    host: String,
    port: u16,
    timeouts: TcpTimeouts,
    stream: Option<TcpStream>,
    cache: ConfigCache,
}

impl TcpBackend {
    pub fn new(host: impl Into<String>, port: u16, timeouts: TcpTimeouts) -> Self {
        Self {
            host: host.into(),
            port,
            timeouts,
            stream: None,
            cache: ConfigCache::default(),
        }
    }

    async fn write_cmd(&mut self, data: &[u8]) -> Result<(), PrinterError> {
        let s = self.stream.as_mut().ok_or(PrinterError::Disconnected)?;
        s.write_all(data).await?;
        s.flush().await?;
        Ok(())
    }

    /// Read from the socket until a complete response frame is parsed.
    async fn read_frame(&mut self, dur: Duration) -> Result<Framed, PrinterError> {
        let s = self.stream.as_mut().ok_or(PrinterError::Disconnected)?;
        let mut buf: Vec<u8> = Vec::with_capacity(2048);
        let mut tmp = [0u8; 4096];
        loop {
            if let ParseOutcome::Done { framed, .. } = protocol::try_parse_response(&buf) {
                return Ok(framed);
            }
            let n = match timeout(dur, s.read(&mut tmp)).await {
                Err(_) => return Err(PrinterError::Timeout),
                Ok(Ok(0)) => return Err(PrinterError::Disconnected),
                Ok(Ok(n)) => n,
                Ok(Err(e)) => return Err(PrinterError::Io(e)),
            };
            buf.extend_from_slice(&tmp[..n]);
        }
    }
}

#[async_trait]
impl PrinterBackend for TcpBackend {
    async fn connect(&mut self) -> Result<(), PrinterError> {
        if self.stream.is_some() {
            return Ok(());
        }
        let addr = (self.host.as_str(), self.port);
        let stream = match timeout(self.timeouts.connect, TcpStream::connect(addr)).await {
            Err(_) => return Err(PrinterError::Timeout),
            Ok(Ok(s)) => s,
            Ok(Err(e)) => return Err(PrinterError::Io(e)),
        };
        let _ = stream.set_nodelay(true);
        self.stream = Some(stream);
        Ok(())
    }

    async fn get_config(&mut self) -> Result<PrinterConfigInfo, PrinterError> {
        self.connect().await?;
        self.write_cmd(protocol::read_config().as_bytes()).await?;
        let framed = self.read_frame(self.timeouts.response).await?;
        let info = protocol::config_from_frame(&framed);
        self.cache.update(&info);
        Ok(info)
    }

    async fn get_status(&mut self) -> Result<PrinterHealth, PrinterError> {
        self.connect().await?;
        self.write_cmd(protocol::read_status().as_bytes()).await?;
        let framed = self.read_frame(self.timeouts.response).await?;
        let mut health = self.cache.health(PrinterState::Unknown);
        protocol::apply_status_frame(&mut health, &framed);
        Ok(health)
    }

    async fn send_print(&mut self, jpeg: &[u8], opts: &PrintOpts) -> Result<(), PrinterError> {
        self.connect().await?;
        self.write_cmd(protocol::build_print(jpeg.len(), opts).as_bytes())
            .await?;
        let ack = self.read_frame(self.timeouts.response).await?;
        let h = ack.header();
        match h.code {
            0 => {}
            3 => return Err(PrinterError::NoMedia),
            c => {
                return Err(PrinterError::NotReady(
                    c,
                    h.comment.clone().unwrap_or_default(),
                ))
            }
        }
        // Stream the JPEG (exactly `datasize` bytes, the same buffer whose
        // length we declared).
        {
            let s = self.stream.as_mut().ok_or(PrinterError::Disconnected)?;
            s.write_all(jpeg).await?;
            s.flush().await?;
        }
        // The printer has the whole image now, so a lost ack most likely means
        // the label printed anyway. Report that instead of a retryable error.
        let done = self
            .read_frame(self.timeouts.print)
            .await
            .map_err(|e| PrinterError::SentUnconfirmed(e.tag()))?;
        let h2 = done.header();
        if h2.code != 0 {
            return Err(PrinterError::NotReady(
                h2.code,
                h2.comment.clone().unwrap_or_default(),
            ));
        }
        Ok(())
    }

    async fn close_for_cut(&mut self) -> Result<(), PrinterError> {
        // Dropping the stream closes the socket, which triggers the cut.
        if let Some(mut s) = self.stream.take() {
            let _ = s.shutdown().await;
        }
        Ok(())
    }
}
