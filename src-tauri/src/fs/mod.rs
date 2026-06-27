use std::path::{Path, PathBuf};

pub fn copy_to_media_dir(
    src: &Path,
    media_dir: &Path,
    file_name: &str,
) -> std::io::Result<PathBuf> {
    let dest = media_dir.join(file_name);
    std::fs::copy(src, &dest)?;
    Ok(dest)
}

pub fn delete_media_file(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}
