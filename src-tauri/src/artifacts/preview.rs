use image::{ImageBuffer, Rgba};
use std::path::{Path, PathBuf};

pub fn write_thumbnail(path: &Path, title: &str, kind: &str) -> Result<PathBuf, String> {
    let dir = path.parent().ok_or_else(|| "preview_parent_missing".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("preview_mkdir_failed: {e}"))?;
    let mut img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::new(420, 594);
    let dark = kind == "pdf";
    let bg = if dark { Rgba([22, 25, 32, 255]) } else { Rgba([246, 247, 249, 255]) };
    let panel = if dark { Rgba([38, 43, 54, 255]) } else { Rgba([255, 255, 255, 255]) };
    let accent = Rgba([238, 126, 58, 255]);
    for pixel in img.pixels_mut() {
        *pixel = bg;
    }
    for y in 34..560 {
        for x in 34..386 {
            img.put_pixel(x, y, panel);
        }
    }
    for y in 64..74 {
        for x in 64..230 {
            img.put_pixel(x, y, accent);
        }
    }
    let hash = title.bytes().fold(0u32, |acc, b| acc.wrapping_add(b as u32));
    for row in 0..8 {
        let width = 180 + ((hash + row * 31) % 110);
        let y = 120 + row * 38;
        for yy in y..y + 10 {
            for x in 64..(64 + width) {
                img.put_pixel(x, yy, if row == 0 { accent } else { Rgba([150, 158, 171, 255]) });
            }
        }
    }
    img.save(path).map_err(|e| format!("preview_save_failed:{}: {e}", path.display()))?;
    Ok(path.to_path_buf())
}
