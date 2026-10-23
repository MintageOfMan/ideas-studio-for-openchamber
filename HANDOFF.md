# Handoff

## Current delivery: 0.2.3

Iosevka 34.9.0 regular/bold is bundled with full glyph coverage, license and source
provenance. The OpenCode connection-version line is removed. Chat compression now
starts above 25,000 whitespace-separated words, within the separately documented
character limits. Second pass defaults on and persists across projects: validated
private draft, concise source-grounded review, then a complete revision. Only the
final content/file is published, using the usual job spinner. Off retains one pass.
The shared recovery budget permits five content calls with it on, three with it off;
normal counts are three and one. Chat summarization remains separate.

Verification covered 121 controlled cases: the full suite passed 120, and a real
Word-build case passed its focused rerun after its test-only timeout was increased
for the larger font payload. All seven current browser checks passed. Both platform
packages built successfully, 15 files and approximately 35 MiB expanded each.
No live model call, installed-extension update, system font installation, runtime
restart or GitHub write was made. Linux remains build-only. Old fonts are retained
under ignored `temp/previous-fonts_2026-10-23T06-21-03-607Z/`, not deleted.

## Earlier delivery: 0.2.2

The AI agent/model selector is implemented. Creation is disabled until catalog
validation succeeds; invalid defaults open the selector automatically. Manual
Studio overrides do not change the actual chat. Both the panel and service enforce
the gate. Options-first creation, numeric targets and the revised format catalog
are included in the rebuilt Windows and Linux packages.

Final verification: 87/87 controlled Node tests and 10/10 browser checks of the
rebuilt Windows panel. Two browser submissions used mock replies, not a live model.
No installed extension, real session, OpenChamber/OpenCode runtime, or GitHub state
was changed. Linux remains build-only. Publication/installation is a separate step.
Availability is validated from configured catalogs; no billable health probes run.

## Current format-options follow-up

- The shared catalog has 11 formats, with 10 implemented and only Podcast planned.
  The Excel tile and creation messages use **Spreadsheet**.
- Options open before creation. Length, count and detail choices show numeric targets
  and send matching hints; their existing IDs and default IDs are retained for history.
  Slide totals include the added title slide. Infographic counts account for grouped
  layouts, and Spreadsheet keeps optional focus with source-only data limits.
- The [README options table](README.md#what-it-makes), specification, roadmap, agent
  guidance and platform READMEs describe the same format scope and workflow.
  Root Git-URL and both platform-folder installations, PNG/SVG exports, source
  attributions and third-party licenses are preserved.
- Focused controlled verification: `node --test tests/formats.test.mjs tests/panel-context.test.mjs tests/numeric-options.test.mjs`
  passed 14/14 tests, including saved-choice compatibility, prompt target delivery,
  actual PowerPoint slide totals and Infographic group counts. Test fixtures stay
  under ignored `temp/`; these checks do not establish live model quality.

## Earlier collector/install fixes

Local branch `fix-license-collector-install`, based on merged `main` at `f6a93d15cf0fa48e4d1314a639b8b08a4a942afc`.

- Fixed the license collector to resolve nested package instances, include license/NOTICE files, and preserve notices from embedded dependency copies. The independent audit reports no missing license text across 102 package instances; all seven embedded copies are listed.
- Added an installable root extension manifest and a small `service.mjs` launcher that selects the existing Windows/Linux x64 backend. Git-URL and repository-root folder installs no longer point at a development-only manifest. Platform-folder installation remains supported.
- Both builds and two focused packaging tests pass. The root launcher passed a local authenticated health check and refused unauthenticated requests. No live OpenChamber installation or model calls were performed.
- The two icon-provenance questions from the earlier audit are outside this collector/install fix.

## Earlier cleanup

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

The earlier privacy/branding cleanup was merged in PR #8. The collector/install fixes are on `fix-license-collector-install` for publication and PR review, not a direct update to `main`. GitHub-URL installation needs these changes merged first; the local repository root can be used for a folder-install trial now. One-off cleanup and audit work is under ignored `temp/`, not part of the distribution. No installed-extension update or merge is included in this follow-up.
