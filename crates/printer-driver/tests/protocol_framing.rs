//! Framing / parsing tests against the real `.bin` captures in `fixtures/`.

use printer_driver::protocol::{
    build_print, parse_config_payload, parse_status_payload, try_parse_response, Framed,
    ParseOutcome,
};
use printer_driver::{CutMode, PrintMode, PrintOpts, PrinterState};

const GETCONFIG: &[u8] = include_bytes!("fixtures/getconfig.resp.bin");
const GETSTATUS3: &[u8] = include_bytes!("fixtures/getstatus3.resp.bin");
const GETSTATUS2: &[u8] = include_bytes!("fixtures/getstatus2.resp.bin");
const PRINTSETUP_RESP: &[u8] = include_bytes!("fixtures/printsetup.resp.bin");
const IMAGE_RESP: &[u8] = include_bytes!("fixtures/image.resp.bin");
const PRINTSETUP_REQ: &[u8] = include_bytes!("fixtures/printsetup.bin");

fn done(buf: &[u8]) -> Framed {
    match try_parse_response(buf) {
        ParseOutcome::Done { framed, .. } => framed,
        ParseOutcome::NeedMore => panic!("expected Done, got NeedMore"),
    }
}

#[test]
fn config_read_is_two_block_with_nul_separator() {
    let framed = done(GETCONFIG);
    let header = framed.header();
    assert_eq!(header.code, 0);
    assert_eq!(header.datasize, Some(1467));
    assert_eq!(header.path.as_deref(), Some("/config.xml"));

    let payload = framed.payload().expect("config read has a payload");
    // Exactly `datasize` bytes were sliced, past the `\n\0` separator.
    assert_eq!(payload.len(), 1467);
    let text = String::from_utf8_lossy(payload);
    assert!(text.contains("<config>"));

    let info = parse_config_payload(&text);
    assert_eq!(info.model.as_deref(), Some("Wedge"));
    assert_eq!(info.cassette_type.as_deref(), Some("1"));
    // width_inches 1.022 -> ~25.96 mm.
    let mm = info.tape_width_mm.expect("tape width present");
    assert!((mm - 25.96).abs() < 0.1, "tape width mm was {mm}");
}

#[test]
fn status_read_idle() {
    let framed = done(GETSTATUS3);
    let payload = framed.payload().expect("status read has a payload");
    let sp = parse_status_payload(&String::from_utf8_lossy(payload));
    assert_eq!(sp.state, Some(PrinterState::Idle));
    // print_job_error is NONE -> filtered to None.
    assert_eq!(sp.print_job_error, None);
    let remain = sp.tape_remaining_mm.expect("remain present");
    // 180.96 in * 25.4.
    assert!(
        (remain - 180.96 * 25.4).abs() < 1.0,
        "remain mm was {remain}"
    );
}

#[test]
fn status_read_busy_is_not_ready() {
    let framed = done(GETSTATUS2);
    let payload = framed.payload().expect("payload");
    let sp = parse_status_payload(&String::from_utf8_lossy(payload));
    assert_eq!(sp.state, Some(PrinterState::Busy));
    assert!(!sp.state.unwrap().is_ready());
}

#[test]
fn print_and_image_acks_are_single_block() {
    let ps = done(PRINTSETUP_RESP);
    assert!(matches!(ps, Framed::StatusOnly(_)));
    assert_eq!(ps.header().code, 0);
    assert_eq!(ps.header().comment.as_deref(), Some("ready to receive"));

    let img = done(IMAGE_RESP);
    assert!(matches!(img, Framed::StatusOnly(_)));
    assert_eq!(img.header().code, 0);
    assert_eq!(img.header().comment.as_deref(), Some("print data received"));
}

#[test]
fn no_media_error_parses_code_3() {
    let raw =
        b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<status>\n<code>3</code>\n<comment>No media loaded</comment>\n</status>\n";
    let framed = done(raw);
    assert!(matches!(framed, Framed::StatusOnly(_)));
    assert_eq!(framed.header().code, 3);
}

#[test]
fn partial_buffers_return_need_more() {
    // A two-block response one byte short of its payload is incomplete.
    assert!(matches!(
        try_parse_response(&GETCONFIG[..GETCONFIG.len() - 1]),
        ParseOutcome::NeedMore
    ));
    // A prefix before the header's closing tag is incomplete.
    assert!(matches!(
        try_parse_response(&PRINTSETUP_RESP[..20]),
        ParseOutcome::NeedMore
    ));
    // The full buffers parse.
    assert!(matches!(
        try_parse_response(GETCONFIG),
        ParseOutcome::Done { .. }
    ));
    assert!(matches!(
        try_parse_response(PRINTSETUP_RESP),
        ParseOutcome::Done { .. }
    ));
}

#[test]
fn build_print_matches_reference_capture() {
    let opts = PrintOpts {
        mode: PrintMode::Vivid,
        cut: CutMode::Full,
        img_w: 0,
        img_h: 0,
    };
    let built = build_print(347, &opts);
    let expected = String::from_utf8_lossy(PRINTSETUP_REQ);
    assert_eq!(built, expected);
}
