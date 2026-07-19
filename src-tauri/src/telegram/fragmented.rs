// Fallback transport used only when the normal reqwest-based path in
// client.rs fails with a network error — the working theory being simple
// SNI-based DPI blocking (e.g. Russia's block on api.telegram.org) that a
// single-segment TLS ClientHello trips, but a ClientHello split across two
// TCP segments does not, since the real Telegram TLS stack reassembles the
// stream correctly regardless of how many packets it arrived in.
//
// reqwest itself can't do this: ClientBuilder::connector_layer wraps an
// already-fully-connected (post-TLS) `Conn` — see its usage examples
// (TimeoutLayer/ConcurrencyLimitLayer), there is no public hook into the raw
// TCP stream before the TLS handshake writes the ClientHello. So this is a
// hand-rolled single-request client: raw TCP -> our fragmenting wrapper ->
// rustls handshake -> one HTTP/1.1 request over hyper's low-level
// client::conn API. Every dependency here (rustls, tokio-rustls,
// webpki-roots, hyper, hyper-util, http-body-util) was already present
// transitively via reqwest's own rustls-tls stack (see Cargo.lock) before
// being declared as direct deps in Cargo.toml for this file.
//
// No efficacy guarantee: this defeats naive single-packet SNI inspection,
// not necessarily more sophisticated DPI. It's a cheap, zero-infrastructure
// thing to try before reaching for a proxy/relay.

use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use bytes::Bytes;
use http_body_util::Full;
use hyper::body::Incoming;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use rustls_pki_types::ServerName;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio_rustls::{client::TlsStream, TlsConnector};

/// Fallback split offset used only when the ClientHello can't be parsed
/// (malformed, or the SNI extension isn't found) — the original v1 fixed
/// offset. Whenever the SNI hostname *can* be located, `compute_split_chunks`
/// below splits inside the hostname bytes themselves instead, since some
/// DPI implementations pattern-match the SNI field specifically and are
/// more reliably defeated by a split that lands inside that field rather
/// than an arbitrary early byte.
const FIRST_WRITE_SPLIT_AT: usize = 2;

/// Locates the `server_name` (SNI) extension's hostname bytes within a raw
/// TLS ClientHello record and returns their `(start, end)` byte range
/// within `buf`. Returns `None` on anything unexpected (wrong record type,
/// truncated buffer, no SNI extension, non-hostname name type) — callers
/// must treat that as "can't do an SNI-aware split" and fall back, never as
/// an error.
fn find_sni_hostname_range(buf: &[u8]) -> Option<(usize, usize)> {
    // Record header: content type(1) + version(2) + length(2).
    if buf.len() < 5 || buf[0] != 0x16 {
        return None;
    }
    let record_len = u16::from_be_bytes([buf[3], buf[4]]) as usize;
    let record_end = 5 + record_len;
    if record_end > buf.len() {
        return None;
    }

    // Handshake header: msg type(1, must be ClientHello=1) + length(3).
    let mut pos = 5;
    if pos + 4 > record_end || buf[pos] != 0x01 {
        return None;
    }
    pos += 4;

    // client_version(2) + random(32).
    pos += 2 + 32;
    if pos > record_end {
        return None;
    }

    // session_id.
    let sid_len = *buf.get(pos)? as usize;
    pos += 1 + sid_len;
    if pos + 2 > record_end {
        return None;
    }

    // cipher_suites.
    let cs_len = u16::from_be_bytes([buf[pos], buf[pos + 1]]) as usize;
    pos += 2 + cs_len;
    if pos + 1 > record_end {
        return None;
    }

    // compression_methods.
    let cm_len = *buf.get(pos)? as usize;
    pos += 1 + cm_len;
    if pos + 2 > record_end {
        return None;
    }

    // extensions.
    let ext_total_len = u16::from_be_bytes([buf[pos], buf[pos + 1]]) as usize;
    pos += 2;
    let ext_end = (pos + ext_total_len).min(record_end);

    while pos + 4 <= ext_end {
        let ext_type = u16::from_be_bytes([buf[pos], buf[pos + 1]]);
        let ext_len = u16::from_be_bytes([buf[pos + 2], buf[pos + 3]]) as usize;
        let ext_data_start = pos + 4;
        let ext_data_end = ext_data_start + ext_len;
        if ext_data_end > ext_end {
            return None;
        }
        if ext_type == 0x0000 {
            // server_name extension: server_name_list length(2), then
            // {name_type(1), name length(2), name} entries.
            let mut sp = ext_data_start;
            if sp + 2 > ext_data_end {
                return None;
            }
            let list_len = u16::from_be_bytes([buf[sp], buf[sp + 1]]) as usize;
            sp += 2;
            let list_end = (sp + list_len).min(ext_data_end);
            if sp + 3 > list_end {
                return None;
            }
            let name_type = buf[sp];
            let name_len = u16::from_be_bytes([buf[sp + 1], buf[sp + 2]]) as usize;
            let name_start = sp + 3;
            let name_end = name_start + name_len;
            if name_type == 0x00 && name_end <= list_end {
                return Some((name_start, name_end));
            }
            return None;
        }
        pos = ext_data_end;
    }
    None
}

/// Computes the sequence of write lengths `FragmentFirstWrite` should use
/// to fragment the first write. Each element is relative to the buffer the
/// *next* `poll_write` call will receive (i.e. the unwritten remainder),
/// not an absolute offset — see its use in `poll_write` below.
///
/// When the SNI hostname can be located, splits twice: once right before
/// the hostname starts, once in the middle of the hostname itself — three
/// TCP segments instead of two, with the middle segment boundary landing
/// inside the exact field DPI is most likely to pattern-match on. Falls
/// back to the fixed `FIRST_WRITE_SPLIT_AT` single split otherwise.
fn compute_split_chunks(buf: &[u8]) -> std::collections::VecDeque<usize> {
    let mut chunks = std::collections::VecDeque::new();
    if let Some((start, end)) = find_sni_hostname_range(buf) {
        if start > 0 && start < buf.len() {
            chunks.push_back(start);
            if end > start && end <= buf.len() {
                let mid = start + (end - start) / 2;
                if mid > start {
                    chunks.push_back(mid - start);
                }
            }
            return chunks;
        }
    }
    if buf.len() > FIRST_WRITE_SPLIT_AT {
        chunks.push_back(FIRST_WRITE_SPLIT_AT);
    }
    chunks
}

/// Wraps any AsyncRead+AsyncWrite (used here over a freshly-connected
/// TcpStream) so the very first `poll_write` call — the TLS ClientHello —
/// is split into several separate underlying writes instead of one. Every
/// write after that first fragmented sequence passes through unchanged.
///
/// This relies on the AsyncWrite contract allowing a short write: returning
/// `Ok(n)` with `n` less than the buffer's length is valid, and callers
/// (rustls/tokio-rustls's handshake driver) are required to call
/// `poll_write` again with the remainder — which is exactly the next
/// fragment. Combined with TCP_NODELAY on the underlying socket (set by
/// `connect_fragmented_tls` below — otherwise Nagle's algorithm would just
/// coalesce the small writes back into one segment before they hit the
/// wire), each `poll_write` call in the sequence becomes a distinct TCP
/// segment.
struct FragmentFirstWrite<S> {
    inner: S,
    first_write_done: bool,
    /// Remaining write lengths for the fragmented sequence. `None` until
    /// the first `poll_write` call computes it from the actual ClientHello
    /// bytes; the front element is decremented (not just popped) as
    /// partial underlying writes come back, so a short write from `inner`
    /// doesn't desync the split points.
    chunk_lens: Option<std::collections::VecDeque<usize>>,
}

impl<S> FragmentFirstWrite<S> {
    fn new(inner: S) -> Self {
        Self { inner, first_write_done: false, chunk_lens: None }
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for FragmentFirstWrite<S> {
    fn poll_read(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        Pin::new(&mut this.inner).poll_read(cx, buf)
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for FragmentFirstWrite<S> {
    fn poll_write(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<std::io::Result<usize>> {
        let this = self.get_mut();
        if !this.first_write_done {
            let queue = this.chunk_lens.get_or_insert_with(|| compute_split_chunks(buf));
            if let Some(front) = queue.front_mut() {
                let take = (*front).min(buf.len());
                let poll = Pin::new(&mut this.inner).poll_write(cx, &buf[..take]);
                if let Poll::Ready(Ok(n)) = &poll {
                    *front = front.saturating_sub(*n);
                    if *front == 0 {
                        queue.pop_front();
                        if queue.is_empty() {
                            this.first_write_done = true;
                        }
                    }
                }
                return poll;
            }
            this.first_write_done = true;
        }
        Pin::new(&mut this.inner).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        Pin::new(&mut this.inner).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        Pin::new(&mut this.inner).poll_shutdown(cx)
    }
}

async fn connect_fragmented_tls(host: &str, port: u16) -> std::io::Result<TlsStream<FragmentFirstWrite<TcpStream>>> {
    let tcp = TcpStream::connect((host, port)).await?;
    // Critical — without this, Nagle's algorithm can merge the two small
    // writes from FragmentFirstWrite back into a single TCP segment before
    // they ever reach the wire, silently undoing the whole point.
    tcp.set_nodelay(true)?;
    let wrapped = FragmentFirstWrite::new(tcp);

    let mut root_store = rustls::RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = rustls::ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    let connector = TlsConnector::from(Arc::new(config));

    let server_name = ServerName::try_from(host.to_string())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;

    connector.connect(server_name, wrapped).await
}

/// Sends a single HTTP/1.1 request over a freshly fragmented-handshake TLS
/// connection to `host:port`. One request per call — no connection pooling,
/// this is only ever used as a one-shot fallback for a request that already
/// failed once over the normal (pooled, reused) reqwest path.
pub async fn send_via_fragmented(
    host: &str,
    port: u16,
    request: Request<Full<Bytes>>,
) -> Result<Response<Incoming>, Box<dyn std::error::Error + Send + Sync>> {
    let tls_stream = connect_fragmented_tls(host, port).await?;
    let io = TokioIo::new(tls_stream);
    let (mut sender, conn) = hyper::client::conn::http1::handshake(io).await?;
    tokio::spawn(async move {
        if let Err(e) = conn.await {
            log::debug!("[tg-fragmented] connection driver error: {e}");
        }
    });
    let resp = sender.send_request(request).await?;
    Ok(resp)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Hand-builds a minimal but structurally valid TLS ClientHello record
    /// carrying a single `server_name` (SNI) extension, so the parser tests
    /// below have real bytes to find instead of guessing offsets by hand.
    fn build_fake_client_hello(hostname: &str) -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(&[0x03, 0x03]); // client_version (TLS 1.2)
        body.extend_from_slice(&[0u8; 32]); // random
        body.push(0); // session_id length
        body.extend_from_slice(&[0x00, 0x00]); // cipher_suites length
        body.push(0); // compression_methods length

        let mut server_name_list = Vec::new();
        server_name_list.push(0x00); // name_type = host_name
        server_name_list.extend_from_slice(&(hostname.len() as u16).to_be_bytes());
        server_name_list.extend_from_slice(hostname.as_bytes());

        let mut sni_ext_data = Vec::new();
        sni_ext_data.extend_from_slice(&(server_name_list.len() as u16).to_be_bytes());
        sni_ext_data.extend_from_slice(&server_name_list);

        let mut extensions = Vec::new();
        extensions.extend_from_slice(&[0x00, 0x00]); // extension type = server_name
        extensions.extend_from_slice(&(sni_ext_data.len() as u16).to_be_bytes());
        extensions.extend_from_slice(&sni_ext_data);

        body.extend_from_slice(&(extensions.len() as u16).to_be_bytes());
        body.extend_from_slice(&extensions);

        let mut handshake = Vec::new();
        handshake.push(0x01); // ClientHello
        handshake.extend_from_slice(&(body.len() as u32).to_be_bytes()[1..]); // 3-byte length
        handshake.extend_from_slice(&body);

        let mut record = Vec::new();
        record.push(0x16); // handshake content type
        record.extend_from_slice(&[0x03, 0x01]); // record version
        record.extend_from_slice(&(handshake.len() as u16).to_be_bytes());
        record.extend_from_slice(&handshake);
        record
    }

    #[test]
    fn finds_sni_hostname_range_in_synthetic_clienthello() {
        let hello = build_fake_client_hello("api.telegram.org");
        let (start, end) = find_sni_hostname_range(&hello).expect("should find SNI");
        assert_eq!(&hello[start..end], b"api.telegram.org");
    }

    #[test]
    fn no_sni_range_found_when_record_is_malformed() {
        // Same bytes the pre-existing fixed-split tests below use — not a
        // complete/valid record, so this must fall back cleanly, not panic.
        let junk = b"\x16\x03\x01\x00\x2aclient-hello-bytes-here";
        assert_eq!(find_sni_hostname_range(junk), None);
    }

    #[tokio::test]
    async fn first_write_splits_inside_sni_hostname_when_present() {
        let hello = build_fake_client_hello("api.telegram.org");
        let (start, end) = find_sni_hostname_range(&hello).unwrap();
        let mid = start + (end - start) / 2;
        assert!(start < mid && mid < end, "split must land strictly inside the hostname");

        let (mut probe, wire) = tokio::io::duplex(4096);
        let mut wrapped = FragmentFirstWrite::new(wire);
        wrapped.write_all(&hello).await.unwrap();
        wrapped.flush().await.unwrap();

        let mut seg1 = vec![0u8; start];
        probe.read_exact(&mut seg1).await.unwrap();
        assert_eq!(&seg1, &hello[..start]);

        let mut seg2 = vec![0u8; mid - start];
        probe.read_exact(&mut seg2).await.unwrap();
        assert_eq!(&seg2, &hello[start..mid]);

        let mut seg3 = vec![0u8; hello.len() - mid];
        probe.read_exact(&mut seg3).await.unwrap();
        assert_eq!(&seg3, &hello[mid..]);
    }

    // In-memory duplex pair stands in for the TcpStream — this test only
    // needs to prove the split happens at the AsyncWrite level, not that
    // real TCP segments come out the other end (that needs an actual
    // socket, which read_console/dev-mode testing can't simulate anyway).
    #[tokio::test]
    async fn first_write_splits_into_two_underlying_writes() {
        let (mut probe, wire) = tokio::io::duplex(4096);
        let mut wrapped = FragmentFirstWrite::new(wire);

        let clienthello = b"\x16\x03\x01\x00\x2aclient-hello-bytes-here";
        wrapped.write_all(clienthello).await.unwrap();
        wrapped.flush().await.unwrap();

        let mut first_chunk = vec![0u8; FIRST_WRITE_SPLIT_AT];
        probe.read_exact(&mut first_chunk).await.unwrap();
        assert_eq!(&first_chunk, &clienthello[..FIRST_WRITE_SPLIT_AT]);

        let mut rest = vec![0u8; clienthello.len() - FIRST_WRITE_SPLIT_AT];
        probe.read_exact(&mut rest).await.unwrap();
        assert_eq!(&rest, &clienthello[FIRST_WRITE_SPLIT_AT..]);
    }

    #[tokio::test]
    async fn second_write_is_not_split() {
        let (mut probe, wire) = tokio::io::duplex(4096);
        let mut wrapped = FragmentFirstWrite::new(wire);

        wrapped.write_all(b"first-clienthello-write").await.unwrap();
        wrapped.write_all(b"second-app-data-write").await.unwrap();
        wrapped.flush().await.unwrap();

        let mut buf = vec![0u8; "first-clienthello-writesecond-app-data-write".len()];
        probe.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"first-clienthello-writesecond-app-data-write");
    }
}
