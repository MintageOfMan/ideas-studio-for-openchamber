# Next steps

Plan for the next working session. Read [SPEC.md](SPEC.md), [README.md](README.md), and [AGENTS.md](AGENTS.md) first.

## Current follow-up: version 0.2.3

- Standard Iosevka 34.9.0 is the bundled default. Font provenance, license, complete
  glyph coverage and supplementary-symbol metrics are retained. Word/PDF/HTML/SVG
  embed fonts; PPTX/XLSX reference the family; plain Markdown uses its viewer's font.
- Chat compression begins above 25,000 words, with the separate 150,000-character
  summary ceiling and 200,000-character combined source limit.
- Second pass defaults on and persists across projects. Draft and criticism remain
  private; only the complete revision is delivered, under the normal spinner. It
  normally uses three calls, with a shared maximum of five (one/three when off).
  Chat summarization is separate. Settings no longer shows the connection version.
- All 121 controlled test cases were verified across a 120-pass full run and the
  successful focused rerun of one Word-build test after a test-only timeout increase.
  Seven current browser checks and both package builds passed. No live-model quality
  claim, installed update or GitHub write; Linux is still build-only.

## Earlier follow-up: version 0.2.2

- The catalog has 11 formats: 10 implemented, with only Podcast planned.
- Spreadsheet is the tile and creation name. It extracts source tables with optional
  focus and visible limits: 10 data sheets, 20 columns and 500 rows per sheet, plus Notes.
- Implemented tiles open Options first; Create submits the request. Numeric targets
  replace qualitative length, count and detail labels, with the same choice/default IDs
  for saved history. [README.md](README.md#what-it-makes) lists every target and limit.
- Slide totals include the added title slide. Infographic keeps all checked layouts,
  PNG/SVG export and rasterization; its numeric choices distinguish per-group counts.
- Focused shared-format verification: 14/14 controlled tests across `formats`,
  `panel-context` and `numeric-options`. They check compatibility and generated-file
  structure, not live model quality.
- Creation now requires a valid available agent and base text model. Defaults are
  tried first; unresolved selection opens the agent/model dialog. Explicit Studio
  choices are validated without changing the real session. The UI and service both
  enforce the gate; there are no billable readiness probes.
- Final 0.2.2 checks: 87/87 controlled Node tests and 10/10 browser checks of the
  rebuilt Windows panel; both platform packages rebuilt. Browser job submissions
  were mocked, and its temporary preview server was stopped. No installed extension
  or GitHub state changed. Linux remains build-only.

## 0. Version 0.2.1: session startup and source browser

- Studio now initializes before a saved session exists, using the host's draft directory
  and configured project/app/OpenCode AI defaults. A saved session remains authoritative
  for its directory, model variant, and agent. Automatic follows that model; the existing
  known-good recommendation is used only for bounded retry recovery.
- OpenChamber 2.5.0 does not expose unsent composer model/agent overrides to extensions.
  Before a session exists, configured defaults are the supported fallback. Generation
  remains stateless; inheriting an agent does not run its instructions or tools.
- Sources now show immediate files and folders, home path, breadcrumbs, Home/Up,
  name/size/created/modified sorting, and paginated listings. Hidden/tool folders stay
  visible. Only a checked file is parsed; no files are selected or restored automatically.
  Available current-chat text is checked by default; an explicit untick is preserved.
- The five document/output tile descriptions use the requested PowerPoint, Word,
  Excel, HTML dashboard, and Portable PDF wording.
- Verification: 72/72 controlled Node tests and 10/10 browser checks of the rebuilt
  Windows panel with controlled SDK responses. Both platform packages rebuilt.
  No real model calls, live installation, runtime restart, commit, or GitHub push.
- Linux remains build-only. Installed-host checks and publication require a separately
  approved action. Existing history and licenses are preserved.

## 1. Where things stand

- The current development build implements Summary, Word, Slides, Spreadsheet, Web page, PDF, Mind map, Flashcards, Quiz, and Infographic. Only Podcast is a planned, disabled grid tile. Earlier passes and their verification are recorded below.
- Verified on Windows 11 x64 with OpenChamber 2.1.1 and OpenCode 2.0.22: folder install, the service on OpenChamber's runtime, live generation of all nine formats from the complete `SPEC.md` with Astra Ultrafast, panel previews, history reopening, and exports. Pass 3 exports matched their stored files by MD5, re-export was refused with `FILE_EXISTS`, and the Word, PowerPoint, and Excel files opened read-only in Microsoft Office without repair. 20/20 focused tests pass.
- Simple UI pass (branch `feat/simple-ui`): NotebookLM-style panel with source tick boxes, colored tiles, one choice plus focus, a creations list, a full-panel viewer with **Save**, and a gear for the model (Automatic by default). Tiles now open **Options** before **Create**. Quiet recovery: the chosen model twice, then the recommended model once. Checked live during that earlier pass: Quiz, a short Summary, and two-source Flashcards completed, and Save wrote a title-named file. 25/25 tests passed.
- Package: about 3.27 MB expanded in 10 files and 1.29 MB zipped per platform folder.
- Fedora is build-only. Nothing has been tested on Linux or macOS.
- Settled: no self-packaged Python; `docx`, `pptxgenjs`, `write-excel-file`, and `pdfkit`; Iosevka is the current default font. Text generation uses the local OpenChamber proxy, OpenCode's base model catalog, and its stateless route. Password-protected, remote, and relay hosts are out of scope.
- Merged pull requests: #1 (Summary), #2 (study formats and web page), #3 (this plan).

- Pass 4a (branch `feat/infographic`, pushed, no pull request yet): Infographic brought the implemented count to 10, with Inter as the one font everywhere. Live in the panel: a compare layout and a simple roadmap generated from two sources; Save wrote SVG and PNG; Word showed embedded Inter where it is not installed. 28/28 tests pass. Package about 4.6 MB expanded, 13 files, 2.0 MB zipped.
- Pass 4b (branch `feat/more-sources`): the service reads sources by path: text and data types, HTML, DOCX (Mammoth), PDF (PDF.js, no OCR), PPTX, XLSX, plus the current chat (compressed by OpenCode above 10,000 characters). Live: a PDF quiz, DOCX+CSV+HTML flashcards, and a PPTX + long-chat summary (chat 36,983 -> 7,065 characters). 34/34 tests pass. Package about 6.7 MB expanded, 15 files.
- Pass 4c (branch `feat/legacy-office`): source limit raised to 200,000 characters and 50 files; `.doc`, `.xls` and `.ppt` read by Studio's own Compound File Binary reader (`shared/service/legacy*.mjs`); Excel dates (`.xlsx` and `.xls`) shown as dates.
- Plain-language pass (branch `feat/plain-language`): generated files name sources plainly and never mention models or paths; "About this" notes rewritten in plain words (no MD5 or byte counts); clearer tile options, flashcard and creation-list wording. Audience is everyone, not only children (SPEC requirement 11).
- Possible follow-ups: PDF.js character maps for East Asian PDFs; OCR; headers and footnotes in `.doc`.
- Next: Podcast (Kokoro pack), per section 4.

## 2. Working setup

| Item | Value |
|---|---|
| Local clone | `.` (repository root; run development commands here) |
| GitHub | `MintageOfMan/ideas-studio-for-openchamber`, default branch `main`; authenticate `gh` for your own account |
| Dev tools | Node 24 and npm (development only), `esbuild` from `devDependencies` |
| OpenChamber backend | `http://127.0.0.1:57123` (desktop local port); OpenCode's own port changes on restart and is not used directly |
| Installed extension | Ideas Studio, folder install of `windows-11-x64/`, ID `ideas-studio-v2`, grants `files` and `service`; add as a new extension |

Routine:

1. `npm ci --ignore-scripts --no-audit --no-fund --cache ./temp/npm-cache`, then `npm test` and `npm run build`. Edit `shared/` only; the build rewrites both platform folders.
2. Panel changes load when the Studio panel reopens. Service changes need a service restart: back up `%USERPROFILE%\.config\openchamber\extensions.json`, then `PUT http://127.0.0.1:57123/api/guests/ideas-studio-v2/enabled` with `{"enabled":false}` and then `{"enabled":true}`. The local helper `temp/restart-development-extension.ps1` does this; `temp/` is not committed, so recreate it in a fresh clone.
3. Read-only connection check: `npm run probe -- --origin http://127.0.0.1:57123 --session <session id> --directory <clone path>`.
4. Live generation check: `temp/live-format.mjs <format> [provider/model]` submits one job through `POST /api/guests/ideas-studio-v2/service/request` and polls it. Its hard-coded session id is from the previous session; replace it with the new one (`OPENCODE_SESSION_ID` in an agent shell). The session must belong to the clone directory.
5. Panel checks: open `http://127.0.0.1:57123/?session=<id>` with the Chrome DevTools tools, click the **Ideas Studio** rail button, and act on snapshot ids. Element screenshots of nodes inside the extension iframe come out blank; take viewport screenshots instead.

Model notes: `amazon-bedrock/us.openai.gpt-6-astra-ultrafast` worked for every format. `amazon-bedrock/us.anthropic.claude-opus-5-5` at variant `max` returned no text for all four structured formats (about 50 seconds each, probably billed). The stateless route has no output-budget control.

Approvals to request again next session: every live generation (billable), service restarts and other extension-registry changes, and every GitHub push, pull request, or merge. Commit and merge permission was given for this session only.

## 3. Pass 3: document formats (done, pending merge)

Delivered: `shared/common/documents.mjs` (prompts, validation, disclosed caps), `shared/service/builders/` (deterministic builders; files stored as `.studio/<folder>/<id>.<ext>` with name, bytes, and MD5 in the record; export copies those bytes service-side), `shared/panel/viewers/documents.js` (outline, slide-card, and sheet previews), `tests/documents.test.mjs`, and bundled DejaVu Sans with license notices. Development-only checks in `temp/` (not committed): `check_files.py` (python-docx, python-pptx, openpyxl, pypdf), `office-open.ps1` (read-only Office COM open), `live-export.mjs`.

Follow-ups:

- True file rendering in the panel (`pdf.js`, `docx-preview`) was not added; decide whether it is worth the bundle and iframe-policy cost.
- Long Office layout is unchecked beyond opening: slide text uses shrink-to-fit, and very wide tables may need landscape pages.

## 4. Pass 4: audio

### Podcast with the optional Kokoro pack

1. Evaluate a Kokoro runtime that needs no per-platform native binaries (for example a JavaScript or WebAssembly build) for license, CPU speed, and memory. Fall back to per-platform native packs only if needed.
2. Define the pack: pinned version, weights, voices, phonemizer, licenses (eSpeak-ng is GPL if used), hosting such as GitHub Releases, and integrity and authenticity checks.
3. Build the download, verify, activate, remove, and health-check lifecycle from SPEC section 8, then two-speaker script generation, voicing, WAV assembly, transcript, and player.

## 5. Pass 5: release qualification

- Run the acceptance criteria in SPEC section 12 for all 11 formats on each advertised platform. Fedora needs its first runtime test on a real Fedora x64 machine; decide whether macOS is a target.
- Re-measure each package against the ZIP limits; choose ZIP or folder distribution.
- Clean-machine installs with no developer tools; upgrade with existing history; disable, re-enable, and uninstall behavior.
- Versioning and release archives per platform. `temp/package_development_builds.py` (local only) shows the archive check to move into `scripts/`.

## 6. Small backlog

- README and the service's remote-host error message still describe an authenticated broker; reword them to say these hosts are out of scope.
- Derive the service `/health` version from the build instead of the hard-coded `0.2.0`.
- Large mind maps are tiny in the side panel; consider a shallower initial expand level or a larger minimum scale.
- Surface the reasoning-variant hint in the panel when a model returns empty text.
- Delete the merged branches `feat/summary-first-pass`, `feat/study-formats`, and `docs/js-builders-plan`, and remove the two test exports in the clone root (`summary-...md`, `webpage-...html`), but only with approval.
- Consider committing the restart and live-check helpers as documented development scripts.

## 7. Guardrails

- Keep Ideas Studio independent; no OpenChamber installer or core changes.
- No self-packaged Python; no model-written code executes.
- Never truncate sources or bypass authentication. Second pass uses draft, review and revision stages; off uses one stage. Two shared recovery calls give maxima of five and three content calls respectively, each recorded. Chat summarization is separate; nothing else retries billable calls. Never publish a failed/cancelled pipeline's first draft as success.
- Keep scratch work in `temp/` and generated history in `.studio/`, both out of commits.
- Distinguish controlled tests from live verification and build-only platforms in every status statement.
