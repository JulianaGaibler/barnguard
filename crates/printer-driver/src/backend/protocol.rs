//! Pure VC-500W wire protocol: XML command builders, a tolerant tag parser, and
//! response framing. No I/O here; this is the unit-tested core.
//!
//! Framing notes (verified against real captures in `tests/fixtures/`):
//! - A response is either a single `<status>…</status>` block (print/image
//!   acks, errors) OR a header `<status>` block carrying a `<datasize>`
//!   followed by a **NUL-separated** payload of exactly that many bytes
//!   (config/status reads). The separator after the header's `</status>` is
//!   `\n\0` in practice; we tolerate any run of whitespace/NUL.
//! - Headers may include a `<path>` echo and a `<comment>`. Always parse by
//!   tag, never by fixed offset.

use crate::types::{PrintOpts, PrinterConfigInfo, PrinterState};

pub const XML_PREFIX: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";

/// `<read>/config.xml` request.
pub fn read_config() -> String {
    format!("{XML_PREFIX}<read>\n<path>/config.xml</path>\n</read>\n")
}

/// `<read>/status.xml` request.
pub fn read_status() -> String {
    format!("{XML_PREFIX}<read>\n<path>/status.xml</path>\n</read>\n")
}

/// `<print>` command. Field order matches the printer's expectation exactly
/// (see `tests/fixtures` `printsetup.bin`). `datasize` MUST equal the JPEG
/// byte count that will follow. `autofit` is always 1 so the printer scales the
/// image to the loaded tape while preserving aspect.
pub fn build_print(datasize: usize, opts: &PrintOpts) -> String {
    let (mode, speed, lpi) = opts.mode.xml();
    let cut = opts.cut.xml();
    format!(
        "{XML_PREFIX}<print>\n\
<mode>{mode}</mode>\n\
<speed>{speed}</speed>\n\
<lpi>{lpi}</lpi>\n\
<width>{w}</width>\n\
<height>{h}</height>\n\
<dataformat>jpeg</dataformat>\n\
<autofit>1</autofit>\n\
<datasize>{datasize}</datasize>\n\
<cutmode>{cut}</cutmode>\n\
</print>\n",
        w = opts.img_w,
        h = opts.img_h,
    )
}

/// Case-insensitive `<tag>…</tag>` inner-text extractor. Returns the trimmed
/// inner text of the FIRST match. Printer values are ASCII, so lowercasing for
/// the search preserves byte offsets into the original string.
pub fn tag_value_ci<'a>(buf: &'a str, tag: &str) -> Option<&'a str> {
    let lower = buf.to_ascii_lowercase();
    let open = format!("<{}>", tag.to_ascii_lowercase());
    let close = format!("</{}>", tag.to_ascii_lowercase());
    let start = lower.find(&open)? + open.len();
    let rest = &lower[start..];
    let end = rest.find(&close)? + start;
    Some(buf[start..end].trim())
}

fn tag_i32(buf: &str, tag: &str) -> Option<i32> {
    tag_value_ci(buf, tag).and_then(|s| s.parse().ok())
}

fn tag_f32(buf: &str, tag: &str) -> Option<f32> {
    tag_value_ci(buf, tag).and_then(|s| s.parse().ok())
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|w| w.eq_ignore_ascii_case(needle))
}

/// Parsed header of a response's leading `<status>` block.
#[derive(Debug, Clone)]
pub struct StatusHeader {
    pub code: i32,
    pub datasize: Option<usize>,
    pub comment: Option<String>,
    pub path: Option<String>,
}

/// A fully-parsed response frame.
#[derive(Debug, Clone)]
pub enum Framed {
    /// Single `<status>` block (print/image acks, errors).
    StatusOnly(StatusHeader),
    /// Header `<status>` + a payload of `datasize` bytes (config/status reads).
    StatusPlusPayload(StatusHeader, Vec<u8>),
}

impl Framed {
    pub fn header(&self) -> &StatusHeader {
        match self {
            Framed::StatusOnly(h) | Framed::StatusPlusPayload(h, _) => h,
        }
    }

    pub fn payload(&self) -> Option<&[u8]> {
        match self {
            Framed::StatusPlusPayload(_, p) => Some(p),
            Framed::StatusOnly(_) => None,
        }
    }
}

/// Result of attempting to parse a (possibly partial) buffer.
#[derive(Debug)]
pub enum ParseOutcome {
    /// Not enough bytes yet; read more and try again.
    NeedMore,
    /// A complete frame; `consumed` bytes may be dropped from the buffer.
    Done { framed: Framed, consumed: usize },
}

/// Try to parse one response from the front of `buf`. Returns `NeedMore` until
/// the full frame (header, and payload if any) has arrived.
pub fn try_parse_response(buf: &[u8]) -> ParseOutcome {
    const CLOSE: &[u8] = b"</status>";
    let Some(pos) = find_subslice(buf, CLOSE) else {
        return ParseOutcome::NeedMore;
    };
    let header_end = pos + CLOSE.len();
    let header_str = String::from_utf8_lossy(&buf[..header_end]);
    let header = StatusHeader {
        code: tag_i32(&header_str, "code").unwrap_or(-1),
        datasize: tag_value_ci(&header_str, "datasize").and_then(|s| s.parse::<usize>().ok()),
        comment: tag_value_ci(&header_str, "comment").map(str::to_string),
        path: tag_value_ci(&header_str, "path").map(str::to_string),
    };

    match header.datasize {
        // A payload follows only on a successful read with a positive size.
        Some(ds) if ds > 0 && header.code == 0 => {
            let mut ps = header_end;
            while ps < buf.len() && matches!(buf[ps], b'\n' | b'\r' | b' ' | b'\t' | 0) {
                ps += 1;
            }
            if buf.len() < ps + ds {
                return ParseOutcome::NeedMore;
            }
            let payload = buf[ps..ps + ds].to_vec();
            ParseOutcome::Done {
                framed: Framed::StatusPlusPayload(header, payload),
                consumed: ps + ds,
            }
        }
        _ => ParseOutcome::Done {
            framed: Framed::StatusOnly(header),
            consumed: header_end,
        },
    }
}

/// Map a raw `<print_state>` value to our enum (case-insensitive; `BUSY` is
/// explicitly *not* ready).
pub fn map_print_state(raw: &str) -> PrinterState {
    match raw.trim().to_ascii_lowercase().as_str() {
        "idle" | "ready" => PrinterState::Idle,
        "busy" => PrinterState::Busy,
        "printing" => PrinterState::Printing,
        "feeding" => PrinterState::Feeding,
        "cutting" => PrinterState::Cutting,
        _ => PrinterState::Unknown,
    }
}

/// Parsed fields from a `/status.xml` payload.
#[derive(Debug, Clone, Default)]
pub struct StatusPayload {
    pub state: Option<PrinterState>,
    pub print_job_error: Option<String>,
    pub tape_remaining_mm: Option<f32>,
    pub cassette_type: Option<String>,
}

/// Parse the `<status>` payload document returned by a `/status.xml` read.
pub fn parse_status_payload(payload: &str) -> StatusPayload {
    let error = tag_value_ci(payload, "print_job_error")
        .filter(|s| !s.eq_ignore_ascii_case("NONE") && !s.is_empty())
        .map(str::to_string);
    StatusPayload {
        state: tag_value_ci(payload, "print_state").map(map_print_state),
        print_job_error: error,
        // `remain` is in inches per the reference driver; convert to mm.
        tape_remaining_mm: tag_f32(payload, "remain").map(|inches| inches * 25.4),
        cassette_type: tag_value_ci(payload, "cassette_type").map(str::to_string),
    }
}

/// Parse the `/config.xml` payload document.
pub fn parse_config_payload(payload: &str) -> PrinterConfigInfo {
    PrinterConfigInfo {
        tape_width_mm: tag_f32(payload, "width_inches").map(|inches| inches * 25.4),
        model: tag_value_ci(payload, "model_name").map(str::to_string),
        serial: tag_value_ci(payload, "serial_number").map(str::to_string),
        cassette_type: tag_value_ci(payload, "cassette_type").map(str::to_string),
        tape_length_mm: tag_f32(payload, "media_length_initial"),
    }
}
