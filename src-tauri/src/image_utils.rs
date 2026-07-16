/// Detect real image format by magic bytes (ignores MIME/extension).
/// Converts anything non-JPEG/PNG/GIF to JPEG so the Telegram Bot API accepts it.
/// Returns (bytes, mime_type, file_name).
pub fn normalize_image(
    bytes: Vec<u8>,
    original_name: &str,
) -> Result<(Vec<u8>, &'static str, String), String> {
    let fmt = detect_format(&bytes);

    match fmt {
        // Already supported natively by the Telegram Bot API
        ImgFmt::Jpeg => {
            let name = ensure_ext(original_name, "jpg");
            Ok((bytes, "image/jpeg", name))
        }
        ImgFmt::Png => {
            let name = ensure_ext(original_name, "png");
            Ok((bytes, "image/png", name))
        }
        ImgFmt::Gif => {
            let name = ensure_ext(original_name, "gif");
            Ok((bytes, "image/gif", name))
        }
        // WebP, BMP, TIFF, AVIF, HEIC, unknown → convert to JPEG
        _ => {
            let converted = decode_and_encode_jpeg(&bytes)
                .map_err(|e| format!("Конвертация изображения: {}", e))?;
            let stem = std::path::Path::new(original_name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("image");
            let name = format!("{}.jpg", stem);
            Ok((converted, "image/jpeg", name))
        }
    }
}

#[derive(Debug)]
enum ImgFmt { Jpeg, Png, Gif, Other }

fn detect_format(b: &[u8]) -> ImgFmt {
    if b.len() >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF {
        return ImgFmt::Jpeg;
    }
    if b.len() >= 8 && &b[0..8] == b"\x89PNG\r\n\x1a\n" {
        return ImgFmt::Png;
    }
    if b.len() >= 4 && (&b[0..4] == b"GIF8") {
        return ImgFmt::Gif;
    }
    ImgFmt::Other
}

fn decode_and_encode_jpeg(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("не удалось декодировать изображение: {}", e))?;

    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Jpeg)
        .map_err(|e| format!("не удалось закодировать в JPEG: {}", e))?;

    Ok(out.into_inner())
}

/// Like normalize_image but forces JPEG output for PNG too.
/// Only GIF stays as GIF to preserve animation.
pub fn normalize_to_jpeg(
    bytes: Vec<u8>,
    original_name: &str,
) -> Result<(Vec<u8>, &'static str, String), String> {
    let fmt = detect_format(&bytes);

    match fmt {
        ImgFmt::Jpeg => {
            let name = ensure_ext(original_name, "jpg");
            Ok((bytes, "image/jpeg", name))
        }
        ImgFmt::Gif => {
            let name = ensure_ext(original_name, "gif");
            Ok((bytes, "image/gif", name))
        }
        // PNG + everything else → JPEG
        _ => {
            let converted = decode_and_encode_jpeg(&bytes)
                .map_err(|e| format!("Конвертация изображения: {}", e))?;
            let stem = std::path::Path::new(original_name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("image");
            Ok((converted, "image/jpeg", format!("{}.jpg", stem)))
        }
    }
}

/// Compress JPEG bytes until they fit within `max_bytes`.
/// Tries quality steps 85 → 70 → 55 → 40. Returns original if none fit.
pub fn compress_to_limit(bytes: Vec<u8>, max_bytes: usize) -> Vec<u8> {
    if bytes.len() <= max_bytes {
        return bytes;
    }
    let img = match image::load_from_memory(&bytes) {
        Ok(i) => i,
        Err(_) => return bytes,
    };
    for quality in [85u8, 70, 55, 40] {
        let mut out = std::io::Cursor::new(Vec::new());
        let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
        if img.write_with_encoder(enc).is_ok() {
            let compressed = out.into_inner();
            if compressed.len() <= max_bytes {
                log::debug!(
                    "[compress] {} → {} bytes at quality {}",
                    bytes.len(), compressed.len(), quality
                );
                return compressed;
            }
        }
    }
    bytes
}

fn ensure_ext(name: &str, ext: &str) -> String {
    let p = std::path::Path::new(name);
    if p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case(ext)) == Some(true) {
        name.to_string()
    } else {
        format!("{}.{}", p.file_stem().and_then(|s| s.to_str()).unwrap_or("image"), ext)
    }
}
