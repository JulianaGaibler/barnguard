//! Brother VC-500W backend over USB (printer class, bulk endpoints).
//!
//! The printer speaks the same XML + JPEG protocol over USB as over TCP, but
//! the transport differs in ways that matter:
//! - There is no socket to close, so nothing on the wire marks "end of job".
//!   What triggers the cut is configurable ([`UsbCutTrigger`]) until it has
//!   been confirmed on hardware.
//! - Replies can arrive late or not at all, so every command first drains
//!   stale bytes from bulk-IN, and every transfer has a deadline after which
//!   it is cancelled.
//! - The reference Windows driver could not read replies at all. If that holds
//!   on a given host, [`UsbReadMode::WriteOnly`] sends jobs blind and reports
//!   an *estimated* state, with paper-empty and error bits taken from the
//!   printer-class GET_PORT_STATUS request.
//!
//! [`probe`] dumps what the host sees of the printer, to settle those
//! questions on site.

use super::protocol::{self, Framed, ParseOutcome};
use super::{ConfigCache, PrinterBackend};
use crate::error::PrinterError;
use crate::types::{PrintOpts, PrinterConfigInfo, PrinterHealth, PrinterState};
use async_trait::async_trait;
use nusb::transfer::{
    Buffer, Bulk, Completion, ControlIn, ControlOut, ControlType, EndpointDirection, In, Out,
    Recipient, TransferError,
};
use nusb::{DeviceInfo, Endpoint, Interface};
use std::io::Write;
use tokio::time::{sleep, sleep_until, timeout, Duration, Instant};

pub const BROTHER_VENDOR_ID: u16 = 0x04F9;
pub const VC500W_PRODUCT_ID: u16 = 0x20B0;

/// USB printer class code and the interface protocols we can drive.
const CLASS_PRINTER: u8 = 7;
const PROTOCOL_UNIDIRECTIONAL: u8 = 1;
const PROTOCOL_BIDIRECTIONAL: u8 = 2;

/// Printer-class control requests (USB Printer Class 1.1, section 4.2).
const REQ_GET_DEVICE_ID: u8 = 0;
const REQ_GET_PORT_STATUS: u8 = 1;
const REQ_SOFT_RESET: u8 = 2;

/// How long a drain read waits for stale bytes before deciding the pipe is
/// empty.
const DRAIN_WAIT: Duration = Duration::from_millis(50);
/// Gap between the `<print>` command and the JPEG in write-only mode, where
/// we can't wait for the "ready" ack. Value from the reference driver.
const WRITE_ONLY_GAP: Duration = Duration::from_millis(300);

/// Whether the backend reads the printer's replies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsbReadMode {
    /// Read every reply, the same as the TCP backend.
    Bidirectional,
    /// Never wait for replies. State is estimated (see the module docs).
    WriteOnly,
}

/// What [`PrinterBackend::close_for_cut`] sends to the printer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsbCutTrigger {
    /// Send nothing and rely on the printer cutting once it has the image.
    None,
    /// A zero-length packet on bulk-OUT.
    ZeroLengthPacket,
    /// The printer-class SOFT_RESET request. May abort a job in progress.
    SoftReset,
}

/// Construction-time options for [`UsbBackend`], as primitives so the driver
/// stays independent of any config format.
#[derive(Debug, Clone)]
pub struct UsbOpts {
    pub vendor_id: u16,
    pub product_id: u16,
    /// Pick this printer when several are plugged in.
    pub serial: Option<String>,
    pub read_mode: UsbReadMode,
    pub cut_trigger: UsbCutTrigger,
    /// Keep the interface claimed between jobs. When false, it is released
    /// after every cut and claimed again for the next command.
    pub hold_interface: bool,
    pub connect_timeout: Duration,
    pub response_timeout: Duration,
    pub print_timeout: Duration,
    /// Write-only mode: how long a label is assumed to take.
    pub write_only_print: Duration,
}

impl Default for UsbOpts {
    fn default() -> Self {
        Self {
            vendor_id: BROTHER_VENDOR_ID,
            product_id: VC500W_PRODUCT_ID,
            serial: None,
            read_mode: UsbReadMode::Bidirectional,
            cut_trigger: UsbCutTrigger::None,
            hold_interface: true,
            connect_timeout: Duration::from_millis(3000),
            response_timeout: Duration::from_millis(10_000),
            print_timeout: Duration::from_millis(120_000),
            write_only_print: Duration::from_millis(15_000),
        }
    }
}

/// Decoded GET_PORT_STATUS byte.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PortStatus {
    pub paper_empty: bool,
    pub selected: bool,
    pub error: bool,
}

impl PortStatus {
    /// Bit 5 is paper-empty, bit 4 is selected, and bit 3 is *not* error.
    pub fn from_byte(b: u8) -> Self {
        Self {
            paper_empty: b & 0x20 != 0,
            selected: b & 0x10 != 0,
            error: b & 0x08 == 0,
        }
    }
}

/// Decode a GET_DEVICE_ID reply: a big-endian length (which counts its own two
/// bytes) followed by an IEEE 1284 ID string.
pub fn parse_device_id(buf: &[u8]) -> Option<String> {
    if buf.len() < 2 {
        return None;
    }
    let len = (u16::from_be_bytes([buf[0], buf[1]]) as usize).clamp(2, buf.len());
    Some(String::from_utf8_lossy(&buf[2..len]).into_owned())
}

/// One interface alternate setting, as read from the configuration
/// descriptor.
#[derive(Debug, Clone)]
pub struct AltSetting {
    pub number: u8,
    pub alt: u8,
    pub class: u8,
    pub subclass: u8,
    pub protocol: u8,
    /// Bulk endpoint addresses. Bit 7 set means IN.
    pub bulk_endpoints: Vec<u8>,
}

/// The interface and endpoints the backend drives.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrinterInterface {
    pub number: u8,
    pub alt: u8,
    pub protocol: u8,
    pub ep_out: u8,
    pub ep_in: Option<u8>,
}

/// Choose the printer-class alternate setting to talk to. Prefers
/// bidirectional (protocol 2) and falls back to unidirectional (protocol 1).
/// IEEE 1284.4 (3) and IPP-over-USB (4) interfaces don't speak the XML
/// protocol, so they are never picked.
pub fn pick_printer_interface(alts: &[AltSetting]) -> Option<PrinterInterface> {
    let candidate = |protocol: u8| {
        alts.iter()
            .filter(|a| a.class == CLASS_PRINTER && a.protocol == protocol)
            .find_map(|a| {
                let ep_out = a.bulk_endpoints.iter().copied().find(|e| e & 0x80 == 0)?;
                let ep_in = a.bulk_endpoints.iter().copied().find(|e| e & 0x80 != 0);
                if protocol == PROTOCOL_BIDIRECTIONAL && ep_in.is_none() {
                    return None;
                }
                Some(PrinterInterface {
                    number: a.number,
                    alt: a.alt,
                    protocol,
                    ep_out,
                    ep_in,
                })
            })
    };
    candidate(PROTOCOL_BIDIRECTIONAL).or_else(|| candidate(PROTOCOL_UNIDIRECTIONAL))
}

/// Bulk and control I/O on a claimed printer interface. The real
/// implementation wraps nusb. Tests swap in a fake.
#[async_trait]
pub(crate) trait UsbTransport: Send {
    fn has_in(&self) -> bool;
    async fn write(&mut self, data: &[u8], deadline: Duration) -> Result<(), PrinterError>;
    async fn write_zlp(&mut self, deadline: Duration) -> Result<(), PrinterError>;
    /// One bulk-IN read. Returns whatever arrived before `deadline`, which may
    /// be nothing.
    async fn read(&mut self, deadline: Duration) -> Result<Vec<u8>, PrinterError>;
    async fn port_status(&mut self) -> Result<PortStatus, PrinterError>;
    async fn soft_reset(&mut self) -> Result<(), PrinterError>;
}

/// Finds the printer and claims its interface.
#[async_trait]
pub(crate) trait UsbOpener: Send + Sync {
    async fn open(&self) -> Result<Box<dyn UsbTransport>, PrinterError>;
}

/// Where a print stands, so a cancel can tell whether the printer is left
/// waiting for the rest of a job.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum JobPhase {
    Idle,
    /// Between the first byte of `<print>` and the last byte of the JPEG.
    Sending,
}

pub struct UsbBackend {
    opts: UsbOpts,
    opener: Box<dyn UsbOpener>,
    transport: Option<Box<dyn UsbTransport>>,
    cache: ConfigCache,
    phase: JobPhase,
    /// Write-only mode: the printer is assumed busy until this instant. `None`
    /// until the first connect, which assumes a print may be in progress.
    busy_until: Option<Instant>,
}

impl UsbBackend {
    pub fn new(opts: UsbOpts) -> Self {
        let opener = NusbOpener {
            vendor_id: opts.vendor_id,
            product_id: opts.product_id,
            serial: opts.serial.clone(),
        };
        Self::with_opener(opts, Box::new(opener))
    }

    pub(crate) fn with_opener(opts: UsbOpts, opener: Box<dyn UsbOpener>) -> Self {
        Self {
            opts,
            opener,
            transport: None,
            cache: ConfigCache::default(),
            phase: JobPhase::Idle,
            busy_until: None,
        }
    }

    fn write_only(&self) -> bool {
        self.opts.read_mode == UsbReadMode::WriteOnly
    }

    /// Write to bulk-OUT. A failed write may leave the printer mid-command, so
    /// it is soft-reset and the transport dropped.
    async fn write(&mut self, data: &[u8], deadline: Duration) -> Result<(), PrinterError> {
        let t = self.transport.as_mut().ok_or(PrinterError::Disconnected)?;
        let result = t.write(data, deadline).await;
        if result.is_err() {
            self.abort().await;
        }
        result
    }

    /// Read until one complete response frame has arrived. On a timeout or
    /// error the transport is dropped, so a late reply can't be taken for the
    /// answer to the next command.
    async fn read_frame(&mut self, dur: Duration) -> Result<Framed, PrinterError> {
        let deadline = Instant::now() + dur;
        let mut buf: Vec<u8> = Vec::with_capacity(2048);
        loop {
            if let ParseOutcome::Done { framed, .. } = protocol::try_parse_response(&buf) {
                return Ok(framed);
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                self.transport = None;
                return Err(PrinterError::Timeout);
            }
            let t = self.transport.as_mut().ok_or(PrinterError::Disconnected)?;
            match t.read(left).await {
                Ok(chunk) => buf.extend_from_slice(&chunk),
                Err(e) => {
                    self.transport = None;
                    return Err(e);
                }
            }
        }
    }

    /// Throw away anything already waiting on bulk-IN (late replies to earlier
    /// commands).
    async fn drain(&mut self) -> Result<(), PrinterError> {
        for _ in 0..32 {
            let Some(t) = self.transport.as_mut() else {
                return Ok(());
            };
            if !t.has_in() {
                return Ok(());
            }
            match t.read(DRAIN_WAIT).await {
                Ok(chunk) if chunk.is_empty() => return Ok(()),
                Ok(chunk) => tracing::debug!(bytes = chunk.len(), "usb: drained stale reply"),
                Err(e) => {
                    self.transport = None;
                    return Err(e);
                }
            }
        }
        Ok(())
    }

    /// Port status, or `None` when the printer doesn't answer the request. A
    /// disconnect still fails.
    async fn port_status(&mut self) -> Result<Option<PortStatus>, PrinterError> {
        let t = self.transport.as_mut().ok_or(PrinterError::Disconnected)?;
        match t.port_status().await {
            Ok(ps) => Ok(Some(ps)),
            Err(PrinterError::Disconnected) => {
                self.transport = None;
                Err(PrinterError::Disconnected)
            }
            Err(e) => {
                tracing::debug!(error = %e, "usb: GET_PORT_STATUS failed");
                Ok(None)
            }
        }
    }

    /// Soft-reset the printer (best effort) and drop the transport. Used when
    /// a job was cut off partway, so the printer doesn't swallow the next
    /// command as image data.
    async fn abort(&mut self) {
        if let Some(mut t) = self.transport.take() {
            if let Err(e) = t.soft_reset().await {
                tracing::warn!(error = %e, "usb: soft reset after an aborted transfer failed");
            }
        }
        self.phase = JobPhase::Idle;
    }

    async fn status_bidirectional(&mut self) -> Result<PrinterHealth, PrinterError> {
        self.drain().await?;
        self.write(
            protocol::read_status().as_bytes(),
            self.opts.response_timeout,
        )
        .await?;
        let framed = self.read_frame(self.opts.response_timeout).await?;
        let mut health = self.cache.health(PrinterState::Unknown);
        protocol::apply_status_frame(&mut health, &framed);
        Ok(health)
    }

    async fn status_write_only(&mut self) -> Result<PrinterHealth, PrinterError> {
        // The read is never answered (or never read), but the traffic may
        // still keep the printer from going to sleep.
        self.write(
            protocol::read_status().as_bytes(),
            self.opts.response_timeout,
        )
        .await?;
        self.drain().await?;
        let port = self.port_status().await?;
        let state = match port {
            Some(p) if p.paper_empty => PrinterState::NoMedia,
            Some(p) if p.error => PrinterState::Unknown,
            _ if self.busy_until.is_some_and(|t| Instant::now() < t) => PrinterState::Busy,
            _ => PrinterState::Idle,
        };
        let mut health = self.cache.health(state);
        health.estimated = true;
        health.print_job_error = match port {
            Some(p) if p.paper_empty => Some("no_media".into()),
            Some(p) if p.error => Some("usb_port_error".into()),
            _ => None,
        };
        Ok(health)
    }

    async fn print_bidirectional(
        &mut self,
        jpeg: &[u8],
        opts: &PrintOpts,
    ) -> Result<(), PrinterError> {
        self.drain().await?;
        self.phase = JobPhase::Sending;
        self.write(
            protocol::build_print(jpeg.len(), opts).as_bytes(),
            self.opts.response_timeout,
        )
        .await?;
        let ack = self.read_frame(self.opts.response_timeout).await;
        let ack = match ack {
            Ok(ack) => ack,
            Err(e) => {
                // The printer may be waiting for the image we never sent.
                self.abort().await;
                return Err(e);
            }
        };
        let h = ack.header();
        match h.code {
            0 => {}
            3 => {
                self.phase = JobPhase::Idle;
                return Err(PrinterError::NoMedia);
            }
            c => {
                self.phase = JobPhase::Idle;
                return Err(PrinterError::NotReady(
                    c,
                    h.comment.clone().unwrap_or_default(),
                ));
            }
        }
        self.write(jpeg, self.opts.print_timeout).await?;
        self.phase = JobPhase::Idle;
        // The printer has the whole image now, so a lost ack most likely means
        // the label printed anyway.
        let done = self
            .read_frame(self.opts.print_timeout)
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

    async fn print_write_only(
        &mut self,
        jpeg: &[u8],
        opts: &PrintOpts,
    ) -> Result<(), PrinterError> {
        // Pace jobs here as well as in the status, so nothing is sent into a
        // printer we believe is still busy.
        if let Some(t) = self.busy_until {
            sleep_until(t).await;
        }
        match self.port_status().await? {
            Some(p) if p.paper_empty => return Err(PrinterError::NoMedia),
            Some(p) if p.error => {
                return Err(PrinterError::NotReady(
                    -1,
                    "USB port status reports an error".into(),
                ))
            }
            _ => {}
        }
        self.phase = JobPhase::Sending;
        self.write(
            protocol::build_print(jpeg.len(), opts).as_bytes(),
            self.opts.response_timeout,
        )
        .await?;
        sleep(WRITE_ONLY_GAP).await;
        self.write(jpeg, self.opts.print_timeout).await?;
        self.phase = JobPhase::Idle;
        self.busy_until = Some(Instant::now() + self.opts.write_only_print);
        Ok(())
    }
}

#[async_trait]
impl PrinterBackend for UsbBackend {
    async fn connect(&mut self) -> Result<(), PrinterError> {
        if self.transport.is_some() {
            return Ok(());
        }
        let t = timeout(self.opts.connect_timeout, self.opener.open())
            .await
            .map_err(|_| PrinterError::Timeout)??;
        if !self.write_only() && !t.has_in() {
            return Err(PrinterError::Protocol(
                "printer interface has no bulk-IN endpoint; set usb.read_mode = \"write_only\""
                    .into(),
            ));
        }
        self.transport = Some(t);
        if self.write_only() && self.busy_until.is_none() {
            // After a restart the printer may still be on the last label.
            self.busy_until = Some(Instant::now() + self.opts.write_only_print);
        }
        self.drain().await
    }

    async fn get_config(&mut self) -> Result<PrinterConfigInfo, PrinterError> {
        self.connect().await?;
        if self.write_only() {
            return Ok(PrinterConfigInfo::default());
        }
        self.drain().await?;
        self.write(
            protocol::read_config().as_bytes(),
            self.opts.response_timeout,
        )
        .await?;
        let framed = self.read_frame(self.opts.response_timeout).await?;
        let info = protocol::config_from_frame(&framed);
        self.cache.update(&info);
        Ok(info)
    }

    async fn get_status(&mut self) -> Result<PrinterHealth, PrinterError> {
        self.connect().await?;
        if self.write_only() {
            self.status_write_only().await
        } else {
            self.status_bidirectional().await
        }
    }

    async fn send_print(&mut self, jpeg: &[u8], opts: &PrintOpts) -> Result<(), PrinterError> {
        self.connect().await?;
        if self.write_only() {
            self.print_write_only(jpeg, opts).await
        } else {
            self.print_bidirectional(jpeg, opts).await
        }
    }

    async fn close_for_cut(&mut self) -> Result<(), PrinterError> {
        if self.phase == JobPhase::Sending {
            // A cancel or error interrupted the job partway.
            self.abort().await;
            return Ok(());
        }
        let Some(t) = self.transport.as_mut() else {
            return Ok(());
        };
        let trigger = match self.opts.cut_trigger {
            UsbCutTrigger::None => Ok(()),
            UsbCutTrigger::ZeroLengthPacket => t.write_zlp(self.opts.response_timeout).await,
            UsbCutTrigger::SoftReset => t.soft_reset().await,
        };
        // Errors are swallowed: the caller treats a failed close as a failed
        // print and would retry, which risks a duplicate label.
        if let Err(e) = trigger {
            tracing::warn!(error = %e, "usb: cut trigger failed");
            self.transport = None;
        }
        if !self.opts.hold_interface {
            self.transport = None;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// nusb transport

/// Bulk-OUT writes are split into transfers of this size (a multiple of every
/// USB packet size).
const WRITE_CHUNK: usize = 16 * 1024;
/// Max-packet multiples requested per bulk-IN read.
const READ_PACKETS: usize = 16;
const CONTROL_TIMEOUT: Duration = Duration::from_millis(1000);
/// How long to wait for a cancelled transfer to come back before treating the
/// device as wedged.
const CANCEL_GRACE: Duration = Duration::from_millis(1000);

struct NusbOpener {
    vendor_id: u16,
    product_id: u16,
    serial: Option<String>,
}

#[async_trait]
impl UsbOpener for NusbOpener {
    async fn open(&self) -> Result<Box<dyn UsbTransport>, PrinterError> {
        let info = find_device(self.vendor_id, self.product_id, self.serial.as_deref()).await?;
        let device = info.open().await.map_err(map_nusb_err)?;
        let transport = NusbTransport::claim(device).await?;
        Ok(Box::new(transport))
    }
}

async fn find_device(
    vendor_id: u16,
    product_id: u16,
    serial: Option<&str>,
) -> Result<DeviceInfo, PrinterError> {
    nusb::list_devices()
        .await
        .map_err(map_nusb_err)?
        .find(|d| {
            d.vendor_id() == vendor_id
                && d.product_id() == product_id
                && serial.is_none_or(|s| d.serial_number() == Some(s))
        })
        // A sleeping printer drops off the bus, so "not found" is the normal
        // asleep state, not a config error.
        .ok_or(PrinterError::Disconnected)
}

fn alt_settings(device: &nusb::Device) -> Result<Vec<AltSetting>, PrinterError> {
    let config = device
        .active_configuration()
        .map_err(|e| PrinterError::Io(e.into()))?;
    Ok(config
        .interface_alt_settings()
        .map(|a| AltSetting {
            number: a.interface_number(),
            alt: a.alternate_setting(),
            class: a.class(),
            subclass: a.subclass(),
            protocol: a.protocol(),
            bulk_endpoints: a
                .endpoints()
                .filter(|e| e.transfer_type() == nusb::descriptors::TransferType::Bulk)
                .map(|e| e.address())
                .collect(),
        })
        .collect())
}

/// Read the alternate settings, setting configuration 1 first if the device
/// is unconfigured (which can happen on macOS).
async fn configured_alt_settings(device: &nusb::Device) -> Result<Vec<AltSetting>, PrinterError> {
    if device.active_configuration().is_err() {
        device.set_configuration(1).await.map_err(map_nusb_err)?;
    }
    alt_settings(device)
}

struct NusbTransport {
    interface: Interface,
    number: u8,
    alt: u8,
    out: Endpoint<Bulk, Out>,
    inp: Option<Endpoint<Bulk, In>>,
}

impl NusbTransport {
    async fn claim(device: nusb::Device) -> Result<Self, PrinterError> {
        let alts = configured_alt_settings(&device).await?;
        let pick = pick_printer_interface(&alts).ok_or_else(|| {
            PrinterError::Protocol("no usable printer-class interface on this device".into())
        })?;
        // Linux only, and a no-op when no driver is bound. Unlike
        // detach_and_claim_interface, the kernel driver (usblp) is not
        // re-attached when we release the interface.
        let _ = device.detach_kernel_driver(pick.number);
        let interface = device
            .claim_interface(pick.number)
            .await
            .map_err(map_nusb_err)?;
        if interface.get_alt_setting() != pick.alt {
            interface
                .set_alt_setting(pick.alt)
                .await
                .map_err(map_nusb_err)?;
        }
        let out = interface
            .endpoint::<Bulk, Out>(pick.ep_out)
            .map_err(map_nusb_err)?;
        let inp = match pick.ep_in {
            Some(addr) => Some(interface.endpoint::<Bulk, In>(addr).map_err(map_nusb_err)?),
            None => None,
        };
        tracing::info!(
            interface = pick.number,
            alt = pick.alt,
            protocol = pick.protocol,
            "usb: claimed printer interface"
        );
        Ok(Self {
            number: pick.number,
            alt: pick.alt,
            interface,
            out,
            inp,
        })
    }

    async fn device_id(&self) -> Result<Option<String>, PrinterError> {
        let data = self
            .interface
            .control_in(
                ControlIn {
                    control_type: ControlType::Class,
                    recipient: Recipient::Interface,
                    request: REQ_GET_DEVICE_ID,
                    value: 0,
                    index: ((self.number as u16) << 8) | self.alt as u16,
                    length: 1023,
                },
                CONTROL_TIMEOUT,
            )
            .await
            .map_err(map_transfer_err)?;
        Ok(parse_device_id(&data))
    }
}

/// Cancel and collect anything a dropped future left pending, so its
/// completion isn't mistaken for the next transfer's.
async fn clear_pending<D: EndpointDirection>(
    ep: &mut Endpoint<Bulk, D>,
) -> Result<(), PrinterError> {
    if ep.pending() == 0 {
        return Ok(());
    }
    ep.cancel_all();
    while ep.pending() > 0 {
        if timeout(CANCEL_GRACE, ep.next_complete()).await.is_err() {
            return Err(PrinterError::Disconnected);
        }
    }
    Ok(())
}

/// Wait up to `dur` for the submitted transfer. On timeout it is cancelled
/// and its (possibly partial) completion returned, with status `Cancelled`.
async fn complete<D: EndpointDirection>(
    ep: &mut Endpoint<Bulk, D>,
    dur: Duration,
) -> Result<Completion, PrinterError> {
    if let Ok(c) = timeout(dur, ep.next_complete()).await {
        return Ok(c);
    }
    ep.cancel_all();
    timeout(CANCEL_GRACE, ep.next_complete())
        .await
        .map_err(|_| PrinterError::Disconnected)
}

#[async_trait]
impl UsbTransport for NusbTransport {
    fn has_in(&self) -> bool {
        self.inp.is_some()
    }

    async fn write(&mut self, data: &[u8], deadline: Duration) -> Result<(), PrinterError> {
        clear_pending(&mut self.out).await?;
        let end = Instant::now() + deadline;
        for chunk in data.chunks(WRITE_CHUNK) {
            self.out.submit(Buffer::from(chunk));
            let c = complete(&mut self.out, end.saturating_duration_since(Instant::now())).await?;
            match c.status {
                Ok(()) => {}
                Err(TransferError::Cancelled) => return Err(PrinterError::Timeout),
                Err(e) => return Err(map_transfer_err(e)),
            }
        }
        Ok(())
    }

    async fn write_zlp(&mut self, deadline: Duration) -> Result<(), PrinterError> {
        clear_pending(&mut self.out).await?;
        self.out.submit(Buffer::new(0));
        let c = complete(&mut self.out, deadline).await?;
        match c.status {
            Ok(()) => Ok(()),
            Err(TransferError::Cancelled) => Err(PrinterError::Timeout),
            Err(e) => Err(map_transfer_err(e)),
        }
    }

    async fn read(&mut self, deadline: Duration) -> Result<Vec<u8>, PrinterError> {
        let ep = self.inp.as_mut().ok_or(PrinterError::Disconnected)?;
        clear_pending(ep).await?;
        ep.submit(Buffer::new(ep.max_packet_size() * READ_PACKETS));
        let c = complete(ep, deadline).await?;
        match c.status {
            Ok(()) | Err(TransferError::Cancelled) => {
                let n = c.actual_len.min(c.buffer.len());
                Ok(c.buffer[..n].to_vec())
            }
            Err(e) => Err(map_transfer_err(e)),
        }
    }

    async fn port_status(&mut self) -> Result<PortStatus, PrinterError> {
        let data = self
            .interface
            .control_in(
                ControlIn {
                    control_type: ControlType::Class,
                    recipient: Recipient::Interface,
                    request: REQ_GET_PORT_STATUS,
                    value: 0,
                    index: self.number as u16,
                    length: 1,
                },
                CONTROL_TIMEOUT,
            )
            .await
            .map_err(map_transfer_err)?;
        data.first()
            .map(|b| PortStatus::from_byte(*b))
            .ok_or_else(|| PrinterError::Protocol("empty GET_PORT_STATUS reply".into()))
    }

    async fn soft_reset(&mut self) -> Result<(), PrinterError> {
        // The spec says recipient "other", but some printers only accept
        // "interface" (CUPS' libusb backend tries both, in this order).
        let req = |recipient| ControlOut {
            control_type: ControlType::Class,
            recipient,
            request: REQ_SOFT_RESET,
            value: 0,
            index: self.number as u16,
            data: &[],
        };
        let first = self
            .interface
            .control_out(req(Recipient::Other), CONTROL_TIMEOUT)
            .await;
        if first.is_ok() {
            return Ok(());
        }
        self.interface
            .control_out(req(Recipient::Interface), CONTROL_TIMEOUT)
            .await
            .map_err(map_transfer_err)
    }
}

fn map_transfer_err(e: TransferError) -> PrinterError {
    match e {
        TransferError::Disconnected => PrinterError::Disconnected,
        TransferError::Cancelled => PrinterError::Timeout,
        other => PrinterError::Io(other.into()),
    }
}

fn map_nusb_err(e: nusb::Error) -> PrinterError {
    let hint = match e.kind() {
        nusb::ErrorKind::Disconnected => return PrinterError::Disconnected,
        nusb::ErrorKind::Busy => {
            "printer USB interface is busy: stop other print software (CUPS, Brother apps, \
             a running barnguard-server) or remove the printer from macOS Printers & Scanners"
        }
        nusb::ErrorKind::PermissionDenied => {
            "permission denied opening the printer over USB: install the udev rule (see README)"
        }
        _ => return PrinterError::Io(e.into()),
    };
    PrinterError::Io(std::io::Error::other(format!("{hint} ({e})")))
}

// ---------------------------------------------------------------------------
// Probe

/// Report what this host sees of the printer: matching devices, interfaces and
/// endpoints, the IEEE 1284 device ID, port status, and whether status reads
/// get answered. With `test_print`, also prints one label through
/// [`UsbBackend`] using `opts`, and logs the state changes that follow.
pub async fn probe(
    opts: &UsbOpts,
    test_print: Option<(&[u8], PrintOpts)>,
    out: &mut (dyn Write + Send),
) -> Result<(), PrinterError> {
    fn w(out: &mut (dyn Write + Send), s: String) {
        let _ = writeln!(out, "{s}");
    }

    let devices: Vec<DeviceInfo> = nusb::list_devices()
        .await
        .map_err(map_nusb_err)?
        .filter(|d| d.vendor_id() == opts.vendor_id)
        .collect();
    w(
        out,
        format!("Devices with vendor ID {:04x}:", opts.vendor_id),
    );
    if devices.is_empty() {
        w(
            out,
            "  none. Is the printer on, awake, and plugged in?".into(),
        );
        return Err(PrinterError::Disconnected);
    }
    for d in &devices {
        w(
            out,
            format!(
                "  {:04x}:{:04x}  product={:?} serial={:?}",
                d.vendor_id(),
                d.product_id(),
                d.product_string().unwrap_or("?"),
                d.serial_number().unwrap_or("?"),
            ),
        );
    }

    let info = find_device(opts.vendor_id, opts.product_id, opts.serial.as_deref()).await?;
    let device = info.open().await.map_err(map_nusb_err)?;
    let alts = configured_alt_settings(&device).await?;
    let pick = pick_printer_interface(&alts);
    w(out, String::new());
    w(
        out,
        "Interfaces (class/subclass/protocol, bulk endpoints):".into(),
    );
    for a in &alts {
        let chosen = pick
            .as_ref()
            .is_some_and(|p| p.number == a.number && p.alt == a.alt);
        let eps: Vec<String> = a
            .bulk_endpoints
            .iter()
            .map(|e| format!("{e:02x}{}", if e & 0x80 != 0 { " IN" } else { " OUT" }))
            .collect();
        w(
            out,
            format!(
                "  {} if {} alt {}: {:02x}/{:02x}/{:02x}  [{}]{}",
                if chosen { "*" } else { " " },
                a.number,
                a.alt,
                a.class,
                a.subclass,
                a.protocol,
                eps.join(", "),
                match (a.class, a.protocol) {
                    (CLASS_PRINTER, 4) => "  (IPP over USB, skipped)",
                    (CLASS_PRINTER, 3) => "  (IEEE 1284.4, skipped)",
                    _ => "",
                },
            ),
        );
    }
    if pick.is_none() {
        w(out, "No usable printer-class interface found.".into());
        return Err(PrinterError::Protocol("no printer-class interface".into()));
    }

    let mut t = NusbTransport::claim(device).await?;
    w(out, String::new());
    match t.device_id().await {
        Ok(Some(id)) => w(out, format!("Device ID: {id}")),
        Ok(None) => w(out, "Device ID: (empty)".into()),
        Err(e) => w(out, format!("Device ID: request failed ({})", e.tag())),
    }
    match t.port_status().await {
        Ok(p) => w(
            out,
            format!(
                "Port status: paper_empty={} selected={} error={}",
                p.paper_empty, p.selected, p.error
            ),
        ),
        Err(e) => w(out, format!("Port status: request failed ({})", e.tag())),
    }

    w(out, String::new());
    let mut replies = 0;
    if t.has_in() {
        w(out, "Status read test (5 tries, 5 s each):".into());
        for i in 1..=5 {
            let mut stale = 0;
            for _ in 0..32 {
                let chunk = t.read(DRAIN_WAIT).await?;
                if chunk.is_empty() {
                    break;
                }
                stale += chunk.len();
            }
            t.write(protocol::read_status().as_bytes(), opts.response_timeout)
                .await?;
            let start = Instant::now();
            let mut buf = Vec::new();
            let outcome = loop {
                if let ParseOutcome::Done { framed, .. } = protocol::try_parse_response(&buf) {
                    let mut h = PrinterHealth::default();
                    protocol::apply_status_frame(&mut h, &framed);
                    break format!(
                        "reply in {} ms: state={:?} error={:?} tape_mm={:?}",
                        start.elapsed().as_millis(),
                        h.state,
                        h.print_job_error,
                        h.tape_remaining_mm
                    );
                }
                let left = Duration::from_secs(5).saturating_sub(start.elapsed());
                if left.is_zero() {
                    break format!("no complete reply ({} bytes received)", buf.len());
                }
                buf.extend(t.read(left).await?);
            };
            if outcome.starts_with("reply") {
                replies += 1;
            }
            let stale = if stale > 0 {
                format!(" [drained {stale} stale bytes first]")
            } else {
                String::new()
            };
            w(out, format!("  {i}: {outcome}{stale}"));
        }
    } else {
        w(
            out,
            "No bulk-IN endpoint: the printer can't answer over USB.".into(),
        );
    }
    let suggested = if replies >= 4 {
        "bidirectional"
    } else {
        "write_only"
    };
    w(
        out,
        format!("{replies}/5 replies. Suggested usb.read_mode = \"{suggested}\"."),
    );
    drop(t);

    let Some((jpeg, print_opts)) = test_print else {
        return Ok(());
    };
    w(out, String::new());
    w(
        out,
        format!(
            "Test print: {} bytes, read_mode={:?}, cut_trigger={:?}",
            jpeg.len(),
            opts.read_mode,
            opts.cut_trigger
        ),
    );
    let mut backend = UsbBackend::new(opts.clone());
    // Write-only mode starts out assuming a busy printer. Skip that here.
    backend.busy_until = Some(Instant::now());
    let start = Instant::now();
    let stamp = |start: Instant| format!("{:>6.1}s", start.elapsed().as_secs_f32());
    backend.connect().await?;
    match backend.send_print(jpeg, &print_opts).await {
        Ok(()) => w(
            out,
            format!("{} print data sent and acknowledged", stamp(start)),
        ),
        Err(e) => w(
            out,
            format!("{} send_print failed: {}", stamp(start), e.tag()),
        ),
    }
    backend.close_for_cut().await?;
    w(
        out,
        format!("{} cut trigger done; watch the printer now", stamp(start)),
    );
    let mut last = None;
    while start.elapsed() < Duration::from_secs(40) {
        sleep(Duration::from_millis(1000)).await;
        let now = match backend.get_status().await {
            Ok(h) => format!(
                "{:?}{}",
                h.state,
                if h.estimated { " (estimated)" } else { "" }
            ),
            Err(e) => format!("status error: {}", e.tag()),
        };
        if last.as_ref() != Some(&now) {
            w(out, format!("{} {now}", stamp(start)));
            last = Some(now);
        }
    }
    w(
        out,
        "Did the label cut? Note the time it did, if so.".into(),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{CutMode, PrintMode};
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    const STATUS_IDLE: &[u8] = b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<status>\n<code>0</code>\n<datasize>49</datasize>\n</status>\n\0<status><print_state>IDLE</print_state></status>\n";
    const ACK: &[u8] =
        b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<status>\n<code>0</code>\n</status>\n";

    /// How the fake printer answers each write.
    type Responder = Box<dyn FnMut(&[u8], &mut VecDeque<Vec<u8>>) + Send>;

    #[derive(Default)]
    struct FakeState {
        inbox: VecDeque<Vec<u8>>,
        writes: Vec<Vec<u8>>,
        opens: usize,
        soft_resets: usize,
        zlps: usize,
        port: u8,
        no_in: bool,
        /// Writes longer than this never complete (a stalled JPEG).
        stall_writes_over: Option<usize>,
        responder: Option<Responder>,
    }

    #[derive(Clone)]
    struct Fake(Arc<Mutex<FakeState>>);

    impl Fake {
        fn new() -> Self {
            Fake(Arc::new(Mutex::new(FakeState {
                // Selected, no error, paper present.
                port: 0x18,
                ..Default::default()
            })))
        }
        fn with<R>(&self, f: impl FnOnce(&mut FakeState) -> R) -> R {
            f(&mut self.0.lock().unwrap())
        }
        fn respond(&self, r: impl FnMut(&[u8], &mut VecDeque<Vec<u8>>) + Send + 'static) {
            self.with(|s| s.responder = Some(Box::new(r)));
        }
        fn backend(&self, read_mode: UsbReadMode) -> UsbBackend {
            let opts = UsbOpts {
                read_mode,
                ..UsbOpts::default()
            };
            UsbBackend::with_opener(opts, Box::new(self.clone()))
        }
    }

    /// Answers status reads with IDLE, `<print>` with an ack, and the JPEG
    /// with an ack.
    fn printer_responder(data: &[u8], inbox: &mut VecDeque<Vec<u8>>) {
        let text = String::from_utf8_lossy(data);
        if text.contains("/status.xml") {
            inbox.push_back(STATUS_IDLE.to_vec());
        } else {
            inbox.push_back(ACK.to_vec());
        }
    }

    #[async_trait]
    impl UsbOpener for Fake {
        async fn open(&self) -> Result<Box<dyn UsbTransport>, PrinterError> {
            self.with(|s| s.opens += 1);
            Ok(Box::new(self.clone()))
        }
    }

    #[async_trait]
    impl UsbTransport for Fake {
        fn has_in(&self) -> bool {
            !self.with(|s| s.no_in)
        }
        async fn write(&mut self, data: &[u8], _deadline: Duration) -> Result<(), PrinterError> {
            if self.with(|s| s.stall_writes_over.is_some_and(|n| data.len() > n)) {
                std::future::pending::<()>().await;
            }
            self.with(|s| {
                s.writes.push(data.to_vec());
                let mut inbox = std::mem::take(&mut s.inbox);
                if let Some(r) = s.responder.as_mut() {
                    r(data, &mut inbox);
                }
                s.inbox = inbox;
            });
            Ok(())
        }
        async fn write_zlp(&mut self, _deadline: Duration) -> Result<(), PrinterError> {
            self.with(|s| s.zlps += 1);
            Ok(())
        }
        async fn read(&mut self, deadline: Duration) -> Result<Vec<u8>, PrinterError> {
            match self.with(|s| s.inbox.pop_front()) {
                Some(chunk) => Ok(chunk),
                None => {
                    sleep(deadline).await;
                    Ok(Vec::new())
                }
            }
        }
        async fn port_status(&mut self) -> Result<PortStatus, PrinterError> {
            Ok(PortStatus::from_byte(self.with(|s| s.port)))
        }
        async fn soft_reset(&mut self) -> Result<(), PrinterError> {
            self.with(|s| s.soft_resets += 1);
            Ok(())
        }
    }

    fn opts() -> PrintOpts {
        PrintOpts {
            mode: PrintMode::Vivid,
            cut: CutMode::Full,
            img_w: 0,
            img_h: 0,
        }
    }

    #[tokio::test(start_paused = true)]
    async fn stale_reply_is_drained_before_a_status_read() {
        let fake = Fake::new();
        let mut b = fake.backend(UsbReadMode::Bidirectional);
        b.connect().await.unwrap();
        // A late print ack arrives after connect's drain.
        fake.with(|s| s.inbox.push_back(ACK.to_vec()));
        fake.respond(printer_responder);
        let h = b.get_status().await.unwrap();
        assert_eq!(h.state, PrinterState::Idle);
        assert!(!h.estimated);
    }

    #[tokio::test(start_paused = true)]
    async fn timeout_drops_the_transport_and_the_next_call_reopens() {
        let fake = Fake::new();
        let mut b = fake.backend(UsbReadMode::Bidirectional);
        assert!(matches!(b.get_status().await, Err(PrinterError::Timeout)));
        fake.respond(printer_responder);
        assert_eq!(b.get_status().await.unwrap().state, PrinterState::Idle);
        assert_eq!(fake.with(|s| s.opens), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn cancel_mid_jpeg_soft_resets_and_reopens() {
        let fake = Fake::new();
        fake.respond(printer_responder);
        fake.with(|s| s.stall_writes_over = Some(1000));
        let mut b = fake.backend(UsbReadMode::Bidirectional);
        let jpeg = vec![0u8; 5000];
        let r = timeout(Duration::from_secs(1), b.send_print(&jpeg, &opts())).await;
        assert!(r.is_err(), "send_print should still be stuck on the JPEG");
        b.close_for_cut().await.unwrap();
        assert_eq!(fake.with(|s| s.soft_resets), 1);
        fake.with(|s| s.stall_writes_over = None);
        b.get_status().await.unwrap();
        assert_eq!(fake.with(|s| s.opens), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn lost_completion_ack_is_sent_unconfirmed() {
        let fake = Fake::new();
        // Ack the <print> command, then go silent.
        fake.respond(|data, inbox| {
            if String::from_utf8_lossy(data).contains("<print>") {
                inbox.push_back(ACK.to_vec());
            }
        });
        let mut b = fake.backend(UsbReadMode::Bidirectional);
        let err = b.send_print(&[1, 2, 3], &opts()).await.unwrap_err();
        assert!(matches!(err, PrinterError::SentUnconfirmed(_)));
        assert!(!err.is_retryable());
        assert_eq!(fake.with(|s| s.soft_resets), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn print_ack_no_media_fails_before_sending_the_jpeg() {
        let fake = Fake::new();
        fake.respond(|_, inbox| {
            inbox.push_back(b"<status><code>3</code></status>".to_vec());
        });
        let mut b = fake.backend(UsbReadMode::Bidirectional);
        let err = b.send_print(&[9; 10], &opts()).await.unwrap_err();
        assert!(matches!(err, PrinterError::NoMedia));
        assert_eq!(fake.with(|s| s.writes.len()), 1);
        b.close_for_cut().await.unwrap();
        assert_eq!(fake.with(|s| s.soft_resets), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn bidirectional_requires_a_bulk_in_endpoint() {
        let fake = Fake::new();
        fake.with(|s| s.no_in = true);
        let mut b = fake.backend(UsbReadMode::Bidirectional);
        assert!(matches!(b.connect().await, Err(PrinterError::Protocol(_))));
    }

    #[tokio::test(start_paused = true)]
    async fn write_only_estimates_busy_then_idle_and_paces_prints() {
        let fake = Fake::new();
        fake.with(|s| s.no_in = true);
        let mut b = fake.backend(UsbReadMode::WriteOnly);

        // Busy right after connect, in case a label is still printing.
        let h = b.get_status().await.unwrap();
        assert_eq!(h.state, PrinterState::Busy);
        assert!(h.estimated);

        sleep(Duration::from_secs(16)).await;
        assert_eq!(b.get_status().await.unwrap().state, PrinterState::Idle);

        b.send_print(&[7; 64], &opts()).await.unwrap();
        let writes = fake.with(|s| s.writes.clone());
        let n = writes.len();
        assert!(String::from_utf8_lossy(&writes[n - 2]).contains("<print>"));
        assert_eq!(writes[n - 1], vec![7; 64]);
        assert_eq!(b.get_status().await.unwrap().state, PrinterState::Busy);

        // A second print waits out the first.
        let before = Instant::now();
        b.send_print(&[8; 64], &opts()).await.unwrap();
        assert!(before.elapsed() >= Duration::from_secs(14));
    }

    #[tokio::test(start_paused = true)]
    async fn write_only_reports_paper_empty_from_port_status() {
        let fake = Fake::new();
        fake.with(|s| {
            s.no_in = true;
            s.port = 0x38;
        });
        let mut b = fake.backend(UsbReadMode::WriteOnly);
        let h = b.get_status().await.unwrap();
        assert_eq!(h.state, PrinterState::NoMedia);
        assert_eq!(h.print_job_error.as_deref(), Some("no_media"));

        b.busy_until = Some(Instant::now());
        assert!(matches!(
            b.send_print(&[1], &opts()).await,
            Err(PrinterError::NoMedia)
        ));
        assert!(fake.with(|s| s
            .writes
            .iter()
            .all(|w| !String::from_utf8_lossy(w).contains("<print>"))));
    }

    #[tokio::test(start_paused = true)]
    async fn cut_trigger_and_hold_interface() {
        let fake = Fake::new();
        fake.respond(printer_responder);
        let opts_zlp = UsbOpts {
            cut_trigger: UsbCutTrigger::ZeroLengthPacket,
            ..UsbOpts::default()
        };
        let mut b = UsbBackend::with_opener(opts_zlp, Box::new(fake.clone()));
        b.send_print(&[1; 8], &opts()).await.unwrap();
        b.close_for_cut().await.unwrap();
        b.get_status().await.unwrap();
        assert_eq!(fake.with(|s| (s.zlps, s.opens)), (1, 1));

        let released = UsbOpts {
            hold_interface: false,
            ..UsbOpts::default()
        };
        let mut b = UsbBackend::with_opener(released, Box::new(fake.clone()));
        b.send_print(&[1; 8], &opts()).await.unwrap();
        b.close_for_cut().await.unwrap();
        b.get_status().await.unwrap();
        assert_eq!(fake.with(|s| s.opens), 3);
    }

    fn alt(number: u8, alt: u8, protocol: u8, eps: &[u8]) -> AltSetting {
        AltSetting {
            number,
            alt,
            class: CLASS_PRINTER,
            subclass: 1,
            protocol,
            bulk_endpoints: eps.to_vec(),
        }
    }

    #[test]
    fn picks_the_bidirectional_interface_and_skips_ipp() {
        let alts = [
            alt(0, 0, 4, &[0x01, 0x81]),
            alt(1, 0, 1, &[0x02]),
            alt(1, 1, 2, &[0x02, 0x82]),
        ];
        let p = pick_printer_interface(&alts).unwrap();
        assert_eq!(
            (p.number, p.alt, p.protocol, p.ep_in),
            (1, 1, 2, Some(0x82))
        );

        let only_ipp = [alt(0, 0, 4, &[0x01, 0x81])];
        assert!(pick_printer_interface(&only_ipp).is_none());

        let one_way = [alt(0, 0, 1, &[0x01])];
        assert_eq!(pick_printer_interface(&one_way).unwrap().ep_in, None);
    }

    #[test]
    fn decodes_port_status_and_device_id() {
        assert_eq!(
            PortStatus::from_byte(0x18),
            PortStatus {
                paper_empty: false,
                selected: true,
                error: false
            }
        );
        assert!(PortStatus::from_byte(0x30).error);
        assert!(PortStatus::from_byte(0x38).paper_empty);

        let mut buf = vec![0, 12];
        buf.extend_from_slice(b"MFG:Brother;extra");
        assert_eq!(parse_device_id(&buf).as_deref(), Some("MFG:Brothe"));
        assert_eq!(parse_device_id(&[0]), None);
    }
}
