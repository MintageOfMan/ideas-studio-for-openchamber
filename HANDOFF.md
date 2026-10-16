# Handoff

## Current work

Based on latest `main` at `b5821f43b14d8488e623ace390642ff837ac29d1`, on local branch `privacy-ideas-studio-branding`.

- Product, package, panel, and generated-file branding is **Ideas Studio**. Both platform folders were rebuilt from shared source.
- Google's NotebookLM/Gemini and SurfSense remain credited as inspirations. The four existing prompt/reply-shape attribution headers and SurfSense license text are retained; independent product development is not a reason to erase recorded provenance.
- The extension ID is now `ideas-studio-v2` on both platforms, intentionally breaking installation-identity compatibility. Add it as a new extension; old host-side preferences are not migrated. Existing per-project `.studio/` history is untouched.
- The real author/company metadata, sensitivity-label properties, revision-author identities, and saved-machine path were neutralized in the four verified synthetic Office fixtures. Test contents and spreadsheet formulas/cached results are unchanged.
- Documentation uses the repository root (`.`), current repository links, and user-home-based paths rather than a developer's absolute path. Public provider/model IDs, model-test notes, and public-handle copyright attribution are preserved.

## Validation

- `npm run build`: Windows and Fedora packages built successfully.
- `npm test`: all 39 existing controlled tests passed during the privacy/branding cleanup. The subsequent ID-only change used a rebuild and targeted manifest checks rather than rerunning unrelated tests.
- After the identity change, both packages rebuilt successfully with `ideas-studio-v2`; the previous ID was absent from all 113 tracked files, and `git diff --check` passed.
- The fixture cleanup additionally checked all four extracted source texts and both spreadsheet formula/cached-value views before and after the change.
- Final scan of all 113 tracked files, including decompressed workbook metadata: no remaining targeted personal/internal identifiers or real user-profile paths. The bundled public dependency's virtual filesystem path is intentionally unchanged. Both package names, panel titles, and export branding passed the targeted checks; source licenses and model-selection behavior are unchanged.
- No live model calls or installation/runtime changes were made. Fedora remains build-only, not runtime-qualified.

## Delivery boundary

Implementation is complete on `privacy-ideas-studio-branding`; publication uses that branch rather than changing `main` directly. No pull request, merge, history rewrite, or installed-extension update is included in this task. Review the commit diff before publication. One-off cleanup work is under ignored `temp/`, not part of the distribution.
