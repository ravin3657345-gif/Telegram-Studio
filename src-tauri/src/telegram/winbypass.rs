// Windows-only, packet-level DPI-bypass fallback — reimplements (as our own
// code, not a bundled third-party tool) the one GoodbyeDPI technique that
// was live-confirmed to fix a real problem: outbound TCP data segments to
// our own relay getting reset mid-transfer under sustained/larger payloads.
// Confirmed 2026-07-20 that this was genuine active network interference
// (reproduced identically via .NET's native HttpClient, ruling out
// anything reqwest/rustls-specific) and confirmed fixed by running
// GoodbyeDPI (WinDivert-based) system-wide. This module intercepts and
// fragments outbound TCP segments the same way, but scoped ONLY to our own
// target hosts via a narrow WinDivert filter — not a system-wide tool.
//
// Does NOT help the *other* problem this app hit (IP+port-level blocking
// of api.telegram.org, confirmed via Test-NetConnection — see
// client.rs/relay). That block happens before any TCP segment is ever
// sent, so there is nothing here to fragment; this only helps once a
// connection is already established and is getting disrupted mid-stream,
// which is what the Supabase relay path was actually hitting.
//
// WinDivert itself (the driver `windivert`/`windivert-sys` bind to) is
// LGPLv3/GPLv2 dual-licensed (our choice: LGPLv3) — vendored as prebuilt
// binaries under vendor/windivert/x64/ (see LICENSE-WinDivert.txt there),
// never statically linked into this crate: WinDivert.dll/WinDivert64.sys
// stay separate, replaceable files alongside the executable, per LGPLv3's
// redistribution terms for a "Combined Work".
//
// Requires Administrator rights to load the driver — this module never
// elevates itself. `spawn_elevated_helper` below launches a *separate*
// process (this same executable, re-invoked with a hidden CLI flag — see
// main.rs) via a single UAC prompt, so the main GUI process stays
// unprivileged. The helper self-terminates when the parent process exits
// (polled by PID), so there's no orphaned elevated process left running
// after the app closes.

use std::net::{Ipv4Addr, SocketAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};

use etherparse::{Ipv4Header, TcpHeader};
use windivert::layer::NetworkLayer;
use windivert::packet::WinDivertPacket;
use windivert::prelude::*;
use windivert::WinDivert;
use windivert_sys::ChecksumFlags;

/// Bytes into the TCP payload where an outbound data segment gets split.
/// Same order of magnitude as the (now-removed) TLS-ClientHello split in
/// the old fragmented.rs — small enough to reliably land inside whatever a
/// naive DPI/middlebox is buffering on, large enough to still be a real
/// segment either side of the cut.
const SPLIT_AT: usize = 4;
/// Segments this small are bare ACKs/handshake noise, not real data —
/// nothing to gain by splitting them, so they're passed through untouched.
const MIN_PAYLOAD_TO_SPLIT: usize = 16;

static RUNNING: AtomicBool = AtomicBool::new(false);

/// File the helper writes its own PID to while actively running, and
/// removes on clean exit — how the (unprivileged) main process learns the
/// (elevated) helper's status. `RUNNING` above only ever gets set *inside*
/// the helper's own process memory, useless for cross-process checks. A
/// first fix tried shelling out to `Get-CimInstance Win32_Process` and
/// matching on command line — also wrong, confirmed live 2026-07-20:
/// Windows won't let an unprivileged caller read an elevated process's
/// CommandLine via WMI at all (comes back empty), so that check silently
/// always failed too, UAC prompt and all. A plain file marker sidesteps
/// the privilege boundary entirely — checking whether a *specific known*
/// PID exists (via `tasklist`, no `/V`) doesn't need elevation, only
/// reading another process's command-line arguments does.
fn marker_path() -> std::path::PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    std::path::Path::new(&appdata)
        .join("com.telegram-studio.app")
        .join("winbypass.pid")
}

/// Path to the helper's own plain-text log — the helper process never runs
/// through `tauri_plugin_log`'s setup (that only happens inside
/// `telegram_studio_lib::run()`, which the helper entrypoint in main.rs
/// bypasses entirely), so without this, every `log::*!` call in this module
/// is a silent no-op when running elevated. Appended to, not truncated, so
/// a run's outcome survives after the process exits.
fn helper_log_path() -> std::path::PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    std::path::Path::new(&appdata)
        .join("com.telegram-studio.app")
        .join("winbypass-helper.log")
}

fn log_line(line: &str) {
    use std::io::Write;
    let path = helper_log_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "[{}] {line}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
    }
}

pub fn is_running() -> bool {
    match std::fs::read_to_string(marker_path()) {
        Ok(content) => content.trim().parse::<u32>().map(process_is_running).unwrap_or(false),
        Err(_) => false,
    }
}

/// Resolves `hosts` (each "host:port") to IPv4 addresses and runs the
/// intercept/fragment loop on the calling thread until the WinDivert
/// handle errors out or `should_stop` returns true. Blocking — callers
/// that don't want to block their own thread should run this on a
/// dedicated one (see `main.rs`'s helper-process entrypoint, which is the
/// only intended caller: this needs Administrator rights to open the
/// WinDivert handle at all).
///
/// Known limitation: `should_stop` is only re-checked between received
/// packets, since the underlying `WinDivertRecv` call has no timeout and
/// this crate's safe wrapper doesn't expose the raw handle needed to
/// unblock a pending recv from another thread. In practice this only
/// matters if the filtered hosts go completely silent right as the app
/// closes — the helper exits on the next matching packet, or otherwise
/// keeps running quietly (no window, narrow filter) until one arrives.
pub fn run_blocking(hosts: &[String], should_stop: impl Fn() -> bool) -> Result<(), String> {
    log_line(&format!("starting, hosts={hosts:?}"));

    let ips = resolve_ipv4(hosts);
    log_line(&format!("resolved ips={ips:?}"));
    if ips.is_empty() {
        log_line("no target IPv4 addresses resolved, aborting");
        return Err("no target IPv4 addresses resolved".to_string());
    }

    let filter = build_filter(&ips);
    log_line(&format!("opening WinDivert handle, filter: {filter}"));

    let handle = match WinDivert::<NetworkLayer>::network(&filter, 0, WinDivertFlags::new()) {
        Ok(h) => h,
        Err(e) => {
            let msg = format!("failed to open WinDivert handle (needs Administrator): {e}");
            log_line(&msg);
            return Err(msg);
        }
    };
    log_line("handle opened successfully");

    RUNNING.store(true, Ordering::SeqCst);
    let marker = marker_path();
    if let Some(parent) = marker.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&marker, std::process::id().to_string()) {
        log_line(&format!("failed to write status marker (status will show as off): {e}"));
    }

    let mut buf = vec![0u8; 65535];
    let mut seen = 0u64;
    let mut fragmented = 0u64;
    loop {
        if should_stop() {
            log_line(&format!("stop requested, exiting (seen={seen}, fragmented={fragmented})"));
            break;
        }
        let packet = match handle.recv(Some(&mut buf)) {
            Ok(p) => p,
            Err(e) => {
                log_line(&format!("recv error, stopping (seen={seen}, fragmented={fragmented}): {e}"));
                break;
            }
        };
        seen += 1;
        match handle_packet(&handle, packet) {
            Ok(true) => fragmented += 1,
            Ok(false) => {}
            Err(e) => log_line(&format!("packet handling error: {e}")),
        }
        if seen % 50 == 0 {
            log_line(&format!("running (seen={seen}, fragmented={fragmented})"));
        }
    }
    RUNNING.store(false, Ordering::SeqCst);
    let _ = std::fs::remove_file(&marker);
    Ok(())
}

/// Entry point used by the elevated helper process (see main.rs): blocks
/// until `parent_pid` is no longer a running process, checked periodically
/// rather than via any IPC channel — keeps the helper fully independent of
/// the main app's internals, at the cost of a few seconds' shutdown lag.
pub fn run_as_helper(parent_pid: u32, hosts: &[String]) -> Result<(), String> {
    run_blocking(hosts, move || !process_is_running(parent_pid))
}

fn process_is_running(pid: u32) -> bool {
    // No extra Windows API dependency needed for this — `tasklist` is
    // present on every Windows install and cheap enough to shell out to
    // once every few seconds.
    std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
        .map(|out| {
            String::from_utf8_lossy(&out.stdout).contains(&pid.to_string())
        })
        .unwrap_or(false)
}

fn resolve_ipv4(hosts: &[String]) -> Vec<Ipv4Addr> {
    let mut ips = Vec::new();
    for host in hosts {
        match host.to_socket_addrs() {
            Ok(addrs) => {
                for addr in addrs {
                    if let SocketAddr::V4(v4) = addr {
                        ips.push(*v4.ip());
                    }
                }
            }
            Err(e) => log::warn!("[winbypass] failed to resolve {host}: {e}"),
        }
    }
    ips.sort();
    ips.dedup();
    ips
}

fn build_filter(ips: &[Ipv4Addr]) -> String {
    let addr_clause = ips
        .iter()
        .map(|ip| format!("ip.DstAddr == {ip}"))
        .collect::<Vec<_>>()
        .join(" or ");
    format!("outbound and tcp and tcp.DstPort == 443 and ({addr_clause})")
}

/// Returns `Ok(true)` if the packet was actually split into two fragments,
/// `Ok(false)` if it was passed through unmodified (not TCP data, too
/// small, or a control segment).
fn handle_packet(
    handle: &WinDivert<NetworkLayer>,
    packet: WinDivertPacket<NetworkLayer>,
) -> Result<bool, String> {
    let raw: &[u8] = packet.data.as_ref();
    let parsed = Ipv4Header::from_slice(raw)
        .ok()
        .and_then(|(ip, rest)| TcpHeader::from_slice(rest).ok().map(|(tcp, payload)| (ip, tcp, payload)));

    let Some((ip_header, tcp_header, payload)) = parsed else {
        // Not an IPv4/TCP packet we know how to parse — pass through
        // unmodified rather than silently dropping it.
        handle.send(&packet).map_err(|e| e.to_string())?;
        return Ok(false);
    };

    if payload.len() < MIN_PAYLOAD_TO_SPLIT || tcp_header.syn || tcp_header.rst || tcp_header.fin {
        handle.send(&packet).map_err(|e| e.to_string())?;
        return Ok(false);
    }

    let split_at = SPLIT_AT.min(payload.len() - 1);
    let (first, second) = payload.split_at(split_at);

    let frag1 = build_fragment(&packet, &ip_header, &tcp_header, first, tcp_header.sequence_number)?;
    let frag2 = build_fragment(
        &packet,
        &ip_header,
        &tcp_header,
        second,
        tcp_header.sequence_number.wrapping_add(split_at as u32),
    )?;

    // One-shot hex dump of the first real split, so a malformed fragment
    // (bad checksum / header) can be spotted by eye against the original.
    if !DUMPED.swap(true, Ordering::SeqCst) {
        log_line(&format!("DUMP original ({} bytes): {}", raw.len(), hex(raw)));
        log_line(&format!("DUMP frag1 ({} bytes): {}", frag1.data.len(), hex(frag1.data.as_ref())));
        log_line(&format!("DUMP frag2 ({} bytes): {}", frag2.data.len(), hex(frag2.data.as_ref())));
    }

    handle.send(&frag1).map_err(|e| e.to_string())?;
    handle.send(&frag2).map_err(|e| e.to_string())?;
    Ok(true)
}

static DUMPED: AtomicBool = AtomicBool::new(false);

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join("")
}

fn build_fragment(
    original: &WinDivertPacket<NetworkLayer>,
    ip_header: &Ipv4Header,
    tcp_header: &TcpHeader,
    payload: &[u8],
    seq: u32,
) -> Result<WinDivertPacket<'static, NetworkLayer>, String> {
    let mut ip = ip_header.clone();
    ip.set_payload_len(tcp_header.header_len() + payload.len())
        .map_err(|e| e.to_string())?;

    let mut tcp = tcp_header.clone();
    tcp.sequence_number = seq;

    let mut bytes = Vec::with_capacity(ip.header_len() + tcp.header_len() + payload.len());
    ip.write(&mut bytes).map_err(|e| e.to_string())?;
    tcp.write(&mut bytes).map_err(|e| e.to_string())?;
    bytes.extend_from_slice(payload);

    // SAFETY: `address` is overwritten immediately below (cloned from the
    // original captured packet, which carries the correct interface/
    // direction info) before this packet is ever passed to `send()`.
    let mut frag = unsafe { WinDivertPacket::<NetworkLayer>::new(bytes) };
    frag.address = original.address.clone();
    frag.recalculate_checksums(ChecksumFlags::new())
        .map_err(|e| e.to_string())?;
    Ok(frag)
}

/// Launches a detached, elevated copy of this same executable (hidden CLI
/// flag, see main.rs) via a single UAC prompt, so the main GUI process
/// never needs to run elevated itself. Returns as soon as the elevation
/// prompt has been triggered — does not wait for the helper to actually
/// start intercepting (that happens, or fails with a clear log line, in
/// the helper process).
pub fn spawn_elevated_helper(hosts: &[&str]) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe.to_string_lossy();
    let parent_pid = std::process::id();
    let hosts_arg = hosts.join(",");

    // Start-Process -Verb RunAs is the standard way to trigger a UAC
    // elevation prompt for a *specific* child process from an unprivileged
    // one — avoids adding the `windows` crate just for ShellExecuteW.
    let ps_command = format!(
        "Start-Process -FilePath '{exe_str}' -ArgumentList '--winbypass-helper','{parent_pid}','{hosts_arg}' -Verb RunAs -WindowStyle Hidden"
    );

    std::process::Command::new("powershell")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &ps_command])
        .spawn()
        .map_err(|e| format!("failed to launch elevation prompt: {e}"))?;

    Ok(())
}
