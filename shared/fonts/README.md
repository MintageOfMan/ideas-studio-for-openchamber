# Studio's font

Studio uses **standard Iosevka 34.9.0**, Normal width, Upright Regular (400) and
Bold (700), from [the official release](https://github.com/be5invis/Iosevka/releases/tag/v34.9.0).
This is the default sans-serif Iosevka family, with half-em text advances, rather
than an Extended, Term, Fixed, Slab, Aile, Etoile or stylistic-set build.

The four TTF/WOFF2 files are unmodified release files. Each face retains all 7,758
encoded characters and its original family, weight and OpenType metadata. The
regular face contains 48,725 glyphs; the bold face contains 48,719. Both official
release archives were checked against the SHA-256 digests supplied by GitHub.
[Iosevka-SOURCE.json](Iosevka-SOURCE.json) records exact download URLs, archive
entries, byte counts and SHA-256 hashes for the archives and packaged faces.

Copyright (c) 2015-2026, Renzhi Li (aka. Belleve Invis). The full upstream
[SIL Open Font License 1.1](Iosevka-LICENSE.txt) is retained here and included in
each platform's third-party notices. Font embedding and redistribution with
Studio are permitted; the font files remain under OFL-1.1. The original TTFs have
unrestricted embedding flags. No system-font installation is needed for Studio.

## Uses

- The panel, SDK controls, Markdown viewer, code/outline text and Markmap use Iosevka.
- Web pages and infographic SVGs carry the complete WOFF2 regular/bold faces.
  Infographic service previews stay font-free; the panel injects its bundled fonts
  into the preview and the SVG used for PNG rasterization.
- Word embeds both full TTF faces with separate regular/bold relationships and
  deterministic obfuscation keys. PDFKit embeds the used glyphs from these TTFs
  using its existing document-subsetting support, permitted by the OFL and font flags.
  PDF layout disables only the optional `frac` and `calt` substitutions, whose
  reverse-chaining lookups Fontkit 2.0.4 cannot read. Fractions and programming
  operators remain readable as written; glyph coverage and mark positioning remain.
- PPTX and XLSX name Iosevka; their libraries cannot embed it. External applications
  substitute a font if Iosevka is unavailable there. Plain Markdown has no font
  metadata; its appearance outside Studio is controlled by the reader.

Run `node scripts/font-metrics.mjs` from the repository to regenerate
`Iosevka-metrics.json`. It records advances for every encoded Unicode code point,
including supplementary-plane symbols, for Measury's server-side text measurement.
Browser fallback fonts remain available for unsupported characters; PDF's existing
missing-character disclosure remains in place.
