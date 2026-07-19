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

/// Bytes of the very first outbound write (the TLS ClientHello record)
/// allowed through before forcing a split. Small and fixed rather than
/// SNI-aware (i.e. not parsed to split exactly inside the hostname bytes) —
/// see the module doc in client.rs's fallback wiring for why a v1 fixed
/// split is enough for now, and the one place to revisit if it isn't.
const FIRST_WRITE_SPLIT_AT: usize = 2;

/// Wraps any AsyncRead+AsyncWrite (used here over a freshly-connected
/// TcpStream) so the very first `poll_write` call — the TLS ClientHello —
/// is split into two separate underlying writes instead of one. Every
/// write after the first passes through unchanged.
///
/// This relies on the AsyncWrite contract allowing a short write: returning
/// `Ok(n)` with `n` less than the buffer's length is valid, and callers
/// (rustls/tokio-rustls's handshake driver) are required to call
/// `poll_write` again with the remainder — which is exactly the second
/// fragment. Combined with TCP_NODELAY on the underlying socket (set by
/// `connect_fragmented_tls` below — otherwise Nagle's algorithm would just
/// coalesce the two small writes back into one segment before they hit the
/// wire), the two `poll_write` calls become two distinct TCP segments.
struct FragmentFirstWrite<S> {
    inner: S,
    first_write_done: bool,
}

impl<S> FragmentFirstWrite<S> {
    fn new(inner: S) -> Self {
        Self { inner, first_write_done: false }
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
            this.first_write_done = true;
            if buf.len() > FIRST_WRITE_SPLIT_AT {
                return Pin::new(&mut this.inner).poll_write(cx, &buf[..FIRST_WRITE_SPLIT_AT]);
            }
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
