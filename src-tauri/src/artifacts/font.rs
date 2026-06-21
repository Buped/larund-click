// Embedded TrueType font support for artifact PDFs.
//
// The legacy PDF path drew text with a non-embedded `Helvetica` Type1 font and
// `Tj` literal strings. That uses WinAnsi/Latin-1 byte encoding, so any UTF-8
// multi-byte character (`á`, `ő`, `ű`, …) rendered as garbage — which is why the
// Hungarian `Számla` looked broken.
//
// This module embeds a real TrueType font as a CIDFontType2 with `Identity-H`
// encoding plus a `ToUnicode` CMap. Text is written as raw 2-byte glyph IDs, so
// every Unicode codepoint the font supports renders correctly, and text
// extraction (pdf-extract) still recovers the original characters via ToUnicode.

use lopdf::{dictionary, Document, Object, ObjectId, Stream, StringFormat};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// A loaded font that records the glyphs it actually draws so only those end up
/// in the PDF width array and ToUnicode map.
pub struct EmbeddedFont {
    data: Vec<u8>,
    units_per_em: f32,
    ascent: i16,
    descent: i16,
    bbox: (i16, i16, i16, i16),
    ps_name: String,
    pdf_name: String,
    /// gid -> (unicode codepoint, advance width in font units)
    used: BTreeMap<u16, (u32, u16)>,
}

impl EmbeddedFont {
    pub fn load(path: &Path, ps_name: &str, pdf_name: &str) -> Result<Self, String> {
        let data = std::fs::read(path).map_err(|e| format!("font_read_failed:{}: {e}", path.display()))?;
        let face = ttf_parser::Face::parse(&data, 0).map_err(|e| format!("font_parse_failed: {e}"))?;
        let units = face.units_per_em();
        if units == 0 {
            return Err("font_units_per_em_zero".to_string());
        }
        let bb = face.global_bounding_box();
        Ok(Self {
            units_per_em: units as f32,
            ascent: face.ascender(),
            descent: face.descender(),
            bbox: (bb.x_min, bb.y_min, bb.x_max, bb.y_max),
            ps_name: ps_name.to_string(),
            pdf_name: pdf_name.to_string(),
            used: BTreeMap::new(),
            data,
        })
    }

    pub fn pdf_name(&self) -> &str {
        &self.pdf_name
    }

    fn face(&self) -> ttf_parser::Face<'_> {
        // Parsing is just table-offset reading; cheap enough to redo per call and
        // avoids a self-referential borrow of `data`.
        ttf_parser::Face::parse(&self.data, 0).expect("font re-parse")
    }

    /// Encode a string to a hex PDF string operand (2-byte GIDs), recording every
    /// glyph used so the width array + ToUnicode map cover it.
    pub fn encode(&mut self, s: &str) -> Object {
        // Parse from the `data` field directly (not via `self.face()`) so the
        // borrow checker sees `self.data` (immutable) and `self.used` (mutable) as
        // disjoint field borrows.
        let face = ttf_parser::Face::parse(&self.data, 0).expect("font re-parse");
        let mut bytes = Vec::with_capacity(s.len() * 2);
        for ch in s.chars() {
            let gid = face.glyph_index(ch).map(|g| g.0).unwrap_or(0);
            let adv = face.glyph_hor_advance(ttf_parser::GlyphId(gid)).unwrap_or(0);
            self.used.entry(gid).or_insert((ch as u32, adv));
            bytes.push((gid >> 8) as u8);
            bytes.push((gid & 0xff) as u8);
        }
        Object::String(bytes, StringFormat::Hexadecimal)
    }

    /// Width of `s` rendered at `font_size` points (PDF text-space units).
    pub fn width(&self, s: &str, font_size: f32) -> f32 {
        let face = self.face();
        let mut total = 0f32;
        for ch in s.chars() {
            let gid = face.glyph_index(ch).map(|g| g.0).unwrap_or(0);
            total += face.glyph_hor_advance(ttf_parser::GlyphId(gid)).unwrap_or(0) as f32;
        }
        total * font_size / self.units_per_em
    }

    /// Greedy word-wrap to a maximum width in points.
    pub fn wrap(&self, s: &str, font_size: f32, max_width: f32) -> Vec<String> {
        let mut lines = Vec::new();
        let mut current = String::new();
        for word in s.split_whitespace() {
            let candidate = if current.is_empty() { word.to_string() } else { format!("{current} {word}") };
            if self.width(&candidate, font_size) > max_width && !current.is_empty() {
                lines.push(std::mem::take(&mut current));
                current = word.to_string();
            } else {
                current = candidate;
            }
        }
        if !current.is_empty() {
            lines.push(current);
        }
        if lines.is_empty() {
            lines.push(String::new());
        }
        lines
    }

    fn scale(&self, v: f32) -> i64 {
        (v * 1000.0 / self.units_per_em).round() as i64
    }

    /// Materialise the Type0 font object graph into the document, returning the
    /// Type0 font id to reference from page resources.
    pub fn add_to_doc(&self, doc: &mut Document) -> ObjectId {
        // Embedded font program.
        let mut font_file = Stream::new(
            dictionary! { "Length1" => self.data.len() as i64 },
            self.data.clone(),
        );
        font_file.compress().ok();
        let font_file_id = doc.add_object(font_file);

        let descriptor_id = doc.add_object(dictionary! {
            "Type" => "FontDescriptor",
            "FontName" => Object::Name(self.ps_name.clone().into_bytes()),
            // Symbolic: glyphs are addressed by our own Identity encoding.
            "Flags" => 4,
            "FontBBox" => vec![
                self.scale(self.bbox.0 as f32).into(),
                self.scale(self.bbox.1 as f32).into(),
                self.scale(self.bbox.2 as f32).into(),
                self.scale(self.bbox.3 as f32).into(),
            ],
            "ItalicAngle" => 0,
            "Ascent" => self.scale(self.ascent as f32),
            "Descent" => self.scale(self.descent as f32),
            "CapHeight" => self.scale(self.ascent as f32),
            "StemV" => 80,
            "FontFile2" => font_file_id,
        });

        // Per-glyph widths: `gid [w]` entries.
        let mut w: Vec<Object> = Vec::new();
        for (gid, (_, adv)) in &self.used {
            w.push(Object::Integer(*gid as i64));
            w.push(Object::Array(vec![Object::Integer(self.scale(*adv as f32))]));
        }

        let cid_font_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "CIDFontType2",
            "BaseFont" => Object::Name(self.ps_name.clone().into_bytes()),
            "CIDSystemInfo" => dictionary! {
                "Registry" => Object::String(b"Adobe".to_vec(), StringFormat::Literal),
                "Ordering" => Object::String(b"Identity".to_vec(), StringFormat::Literal),
                "Supplement" => 0,
            },
            "FontDescriptor" => descriptor_id,
            "CIDToGIDMap" => Object::Name(b"Identity".to_vec()),
            "DW" => 1000,
            "W" => Object::Array(w),
        });

        let mut to_unicode = Stream::new(dictionary! {}, self.build_to_unicode().into_bytes());
        to_unicode.compress().ok();
        let to_unicode_id = doc.add_object(to_unicode);

        doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type0",
            "BaseFont" => Object::Name(self.ps_name.clone().into_bytes()),
            "Encoding" => Object::Name(b"Identity-H".to_vec()),
            "DescendantFonts" => vec![Object::Reference(cid_font_id)],
            "ToUnicode" => to_unicode_id,
        })
    }

    fn build_to_unicode(&self) -> String {
        let mut entries: Vec<String> = self
            .used
            .iter()
            .map(|(gid, (uni, _))| format!("<{:04X}> <{:04X}>", gid, uni))
            .collect();
        let mut body = String::new();
        // bfchar sections are capped at 100 entries each.
        for chunk in entries.chunks_mut(100) {
            body.push_str(&format!("{} beginbfchar\n", chunk.len()));
            for line in chunk.iter() {
                body.push_str(line);
                body.push('\n');
            }
            body.push_str("endbfchar\n");
        }
        format!(
            "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n{body}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend",
        )
    }
}

/// Locate usable regular + bold TrueType faces, preferring system fonts that
/// carry full Latin Extended-A coverage (Hungarian accents).
pub fn resolve_fonts() -> Result<(PathBuf, PathBuf), String> {
    let regular = first_existing(&[
        // Windows
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\calibri.ttf",
        // macOS
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        // Linux
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
    ])
    .ok_or_else(|| "blocked: no usable system TrueType font found for accent-safe embedding".to_string())?;

    let bold = first_existing(&[
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\calibrib.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    ])
    .unwrap_or_else(|| regular.clone());

    Ok((regular, bold))
}

fn first_existing(candidates: &[&str]) -> Option<PathBuf> {
    candidates.iter().map(PathBuf::from).find(|p| p.exists())
}
