# Ideas Studio
## Extension for OpenChamber v2
Inspired by [Google NotebookLM](https://notebooklm.google.com/) and [SurfSense](https://github.com/MODSetter/SurfSense).

Turn your notes into study material and documents. Ideas Studio is an independent, optional extension for [OpenChamber](https://github.com/openchamber/openchamber). It takes the documents in a project (text, Markdown, Word, PDF, PowerPoint, Excel, including the old 97-2003 formats, CSV, JSON, web pages and more) and, if you like, the current chat, and makes summaries, flashcards, quizzes, mind maps, web pages, Word reports, slide decks, spreadsheets, PDFs and infographics from them, using the AI models you already have in OpenChamber.

It is built for everyone. A curious ten-year-old should be able to use it, and so should a history professor who knows nothing about AI, or someone who is not comfortable with computers. Pick your files, tap a tile, review **Options**, then choose **Create**. Open the result and save it. Studio uses plain words without talking down to anyone, chooses sensible defaults, and quietly recovers from most problems. Technical details are there for people who want them, under **About this**.

> **Status: development build, 10 of 11 formats.** Tested on Windows 11 x64 with OpenChamber 2.1.1 and OpenCode 2.0.22. The Fedora build is produced but has not been run on Linux. Only Podcast is planned. See [Project status](#project-status).

## Contents

- [What it reads](#what-it-reads)
- [What it makes](#what-it-makes)
- [Install](#install)
- [Use](#use)
- [How it works](#how-it-works)
- [Privacy and network use](#privacy-and-network-use)
- [Limits and known issues](#limits-and-known-issues)
- [Develop](#develop)
- [Project status](#project-status)
- [Acknowledgements](#acknowledgements)
- [License](#license)

## What it reads

| Source | File types | How the text is read |
|---|---|---|
| Text and data | `.md`, `.markdown`, `.txt`, `.text`, `.csv`, `.tsv`, `.json`, `.jsonl`, `.xml`, `.yaml`, `.yml`, `.log`, `.ini`, `.toml` | As written (UTF-8) |
| Web pages | `.html`, `.htm` | Readable text only; scripts and styles are dropped |
| Word | `.docx` | [Mammoth](https://github.com/mwilliamson/mammoth.js) |
| PDF | `.pdf` | [PDF.js](https://github.com/mozilla/pdf.js) text, page by page |
| PowerPoint | `.pptx` | Slide text and speaker notes, in slide order |
| Excel | `.xlsx` | Every sheet, row by row; dates and times shown as dates, not day numbers |
| Office 97-2003 | `.doc`, `.xls`, `.ppt` | Studio's own reader for the old binary formats (no extra library): document text, every sheet with dates, slides with notes |
| This chat | The OpenChamber chat Studio is open beside | See below |

Studio opens a file browser at the session's home folder, even before the first message. The home path and folder breadcrumbs show exactly where you are. Open folders to browse their immediate contents; hidden folders, tool folders, and unsupported files are not hidden, and there is no fixed browsing depth. Sort by name, size, date created, or date modified, in either direction. An unavailable creation date is shown as unavailable, not replaced with another date.

No files are selected automatically, including files selected the last time Studio was open. Tick a file to read it; opening a folder does not parse its documents. Selections stay checked as you move between folders, and the selected-files list shows their paths. Unsupported files and shortcuts are visible but disabled. If a selected file cannot be read, Studio explains why. Paths cannot escape the session's home through shortcuts or parent-folder traversal.

**This chat.** The current chat is selected automatically when it has readable messages; untick it to exclude it. An explicit untick is preserved while that chat remains open. An empty or not-yet-created chat does not prevent file-based use. Studio reads the chat's words, not its tool output. A chat through **25,000 words** goes as it is; words are counted as whitespace-separated tokens, not model tokens. If OpenCode has already compacted the chat, Studio uses its summary plus the messages after it. A longer chat is shortened only when generating: Studio asks OpenCode for a summary of at most 20,000 words, rejecting anything above 25,000 words or its 150,000-character ceiling (never longer than the original). The existing 200,000-character combined source budget still applies. Summarization uses the chat's model, may be billed, and never changes the chat itself. **About this** records the original word count when compression happened.

## What it makes

| Tile | Result | Options | Limits |
|---|---|---|---|
| Summary | Structured Markdown brief | About 200, **500** or 900 words | Word counts are approximate |
| Report (Word) | Editable `.docx` with headings, paragraphs, bullets and tables | Up to 3, **6** or 12 sections | 12 sections; tables up to 8 columns x 50 rows |
| Slides | Editable 16:9 `.pptx` with a title slide and speaker notes | Up to 6 or **16** slides total, including the title slide | 15 content slides plus 1 title slide; 6 bullets per content slide |
| Spreadsheet (Excel) | `.xlsx` of tables found in the source, missing values left empty, plus a Notes sheet | Optional focus; source-data limits shown | 10 data sheets plus Notes; 20 columns and 500 rows per data sheet |
| Web page | Self-contained `.html` page with no scripts | Up to 3, **6** or 10 sections | 10 sections |
| PDF | Typeset `.pdf` ready to print | Up to 3, **6** or 12 sections | 12 sections |
| Mind map | Zoomable, collapsible map plus a text outline | Up to 4 main branches / 2 levels, or **10 main branches / 3 levels** below the title | 10 main branches, 6 levels below the title |
| Flashcards | One card at a time with reveal and "mark known"; progress is saved | Up to 8, **12** or 20 cards | 20 cards |
| Quiz | Four-option questions with scoring and explanations; progress is saved | Easy (up to 10 questions), **Medium (up to 10 questions)**, Hard (up to 10 questions) | 10 questions |
| Infographic | One-page poster in one of 16 layouts (steps, timeline, roadmap, cycle, pyramid, funnel, cards, list, compare, SWOT, pie, columns, bars, tree); saved as PNG and SVG | Up to 4 items / 2 per group, or **8 items / 5 per group** | Lists/charts: 8 items; groups: 5 items each; trees: 20 boxes, 3 levels; long text is shortened and the cut is marked |
| Podcast | Planned: two-speaker audio with an optional Kokoro voice pack | | |

Each implemented tile opens **Options** first, with defaults already selected (bold above) and an optional "Focus or custom instructions" box. The numbers are generation targets within the format limits, not promises of an exact result; a short source may support fewer items. Infographic counts apply to list items, chart values or tree boxes including the root; comparison and SWOT layouts instead use the displayed count per group. Spreadsheet extracts source tables without an invented row-count target. **Iosevka** is the default font for Studio and supported output formats; see the font and format limitations below.

## Install

Users do not install Node, Python, Office or any server. In OpenChamber **Settings > Extensions**, paste this Git URL and choose **Add**:

```text
https://github.com/MintageOfMan/ideas-studio-for-openchamber
```

The repository root contains the extension manifest and selects the matching prebuilt service for Windows x64 or Linux x64. The panel is shared across platforms; Linux remains build-only, not runtime-qualified.

Folder installation is also supported:

1. Download or clone this repository.
2. In OpenChamber, open **Settings > Extensions** and choose **Add folder**.
3. Pick the folder for your computer:
   - [`windows-11-x64/`](windows-11-x64/README.md) (tested)
   - [`linux-fedora-amd64/`](linux-fedora-amd64/README.md) (built, not yet tested on Linux)
4. Approve project-file access and the local service when asked.

Keep a folder installation where it is: OpenChamber runs it from that location. You can select either the repository root (automatic platform selection) or the matching platform folder.

**Breaking identity change:** the extension name is **Ideas Studio** and its ID is `ideas-studio-v2`. Add it as a new extension and disable the earlier installation if present. Saved host-side extension preferences do not automatically migrate. Existing per-project `.studio/` history is unchanged and remains available when you open the same project.

## Use

1. Open **Ideas Studio** from the right-hand rail. You do not need to send a message or create a chat first.
2. Under **Sources**, browse from the session's home folder and tick only the files you want. **This chat** is checked when available; untick it to exclude the conversation. Studio keeps file selections as you browse, but starts with no files selected when reopened or switched to another chat. It will not let you tick more text than it can send.
3. Tap a tile to open **Options**. Review the preselected numeric setting, change it if you like, and optionally say what to focus on. Choose **Create** to start; opening Options does not generate anything.
4. Your item appears under **Your creations** with a spinner, then a "ready" message. You can make up to three things at once.
5. Tap an item to open it. Tap **Save** to put a copy in the project folder, named after its title, such as `Planets quiz.md` or `How a seed grows.png`. Saving never overwrites a file; a second copy becomes `(2)`.
6. **About this**, under each item, shows the sources, the AI model and any changes Studio made, such as text it shortened or left out. The files themselves only say which sources they were made from and when; they never mention AI models or file paths.

The gear in the top corner opens the AI agent and model selector. Studio first tries the saved session or configured project/app/OpenCode defaults. If they do not resolve to an available agent and text model, the selector opens automatically and creation stays disabled. Choose an agent and model, then **Use selection** to validate them. Cancelling the selector does not bypass the gate. **Refresh list** reloads available choices after a configuration change. Selecting an agent/model in Studio does not change the real chat. Studio still uses stateless text generation, not agent tools or a new conversation.

**Second pass** is checked by default in Settings. Studio creates a private draft, asks the AI for a concise review against the selected sources and your instructions, then creates a complete revision using that criticism. You see the normal progress circle and one final creation, not intermediate drafts or review text. Uncheck it and save Settings for single-pass creation. This preference is remembered across projects; changing it does not change an already-running job. It normally uses three AI calls instead of one, with at most two shared recovery calls (five maximum with Second pass, three without). Long-chat summarization is separate. **About this** shows call counts and the quality setting; it does not expose the private draft or criticism. A failed or cancelled review/revision is not presented as a successful first draft.

OpenChamber 2.5.0 exposes a new draft's directory but not its unsent composer model/agent overrides to extensions. Before a saved session exists, Studio therefore uses matching project defaults or the configured OpenChamber/OpenCode defaults. It does not create a session just to discover those values. Models and variants must be available to OpenCode's base-configuration text generation. Studio never treats an arbitrary first model or an invented agent name as a working default. Selection checks read the configured catalogs without billable probe calls; provider outages can still cause a generation request to fail.

## How it works

Studio has two parts, both shipped in the platform folder and run by OpenChamber:

- **Panel** (`panel/`): the screen you use. It runs in OpenChamber's sandboxed extension frame.
- **Service** (`service/`): a small JavaScript program that OpenChamber starts with its own runtime. It talks to the AI, checks the replies, builds the files and keeps the history.

When you choose **Create** in Options:

1. The panel sends the ticked file names, with your choice and focus, to the service. The service reads the files itself, so it can open PDFs and Office files that the sandboxed panel cannot. It also reads the chat if ticked, shortening it through OpenCode when it is long.
2. The service asks the AI model for a structured reply (JSON for most formats) through OpenChamber's local connection to OpenCode. It never reads or stores credentials.
3. The service checks the reply strictly. Anything incomplete or over a limit is dropped or shortened, and every change is listed under **About this**. Nothing the model writes is ever run as code.
4. With Second pass on, Studio reviews the validated draft and creates a complete revision from the same source snapshot, numeric choice and custom instructions. The review checks content and structure, not a rendered document's appearance. Recovery shares two extra calls across all stages: a chosen-model retry, then a distinct recommended fallback. Every call and stage is recorded.
5. Trusted builders turn only the final checked content into the file:
   - Word: [docx](https://github.com/dolanmiu/docx), with Iosevka embedded.
   - Slides: [PptxGenJS](https://github.com/gitbrent/PptxGenJS).
   - Excel: [write-excel-file](https://gitlab.com/catamphetamine/write-excel-file).
   - PDF: [PDFKit](https://github.com/foliojs/pdfkit), with Iosevka embedded.
   - Infographic: [AntV Infographic](https://github.com/antvis/Infographic), run in its own background thread.
   - Mind map: [Markmap](https://github.com/markmap/markmap).
   - Web page: a fixed template that escapes every piece of text.
6. History is saved per format under `.studio/` in the project, so it survives restarts and can be reopened, studied or saved again.

Infographic PNGs are drawn in the panel, because the library places text in a way only a browser can rasterize. The PNG is then sent to the service in pieces and saved.

## Privacy and network use

- **Your files and the chat** (only when ticked) go only to the AI model you chose (or Automatic picked), through your local OpenChamber and OpenCode connection. A long chat is first summarized by OpenCode with the chat's own model. Your model provider's terms and charges apply. Studio adds no telemetry.
- **Infographic icons** are looked up by keyword on AntV's icon service (`weavefox.cn`). Only the single icon word the model chose, such as `leaf`, is sent; your documents are not. Without a connection the infographic is drawn without icons.
- Studio works only with OpenChamber on the same computer. Password-protected, remote and relay hosts are not supported, and Studio never bypasses authentication.

## Limits and known issues

- Selected sources can total 200,000 characters of text, up to 50 files. Full chat text is included through 25,000 words; longer chats reserve up to 150,000 characters for their summary. Both word and combined-character limits apply. Studio refuses rather than cutting a source short.
- No OCR: a scanned PDF has no text to read. Files over 25 MB, encrypted files and pre-1997 Office formats are not read. In old `.doc` files only the main text is read (not headers, footnotes or comments). PDFs in East Asian scripts may lack text because PDF.js character maps are not bundled.
- **Automatic** follows the session/default model. The known-good model is kept only as the existing bounded retry fallback. A Claude Opus 5.5 run at variant `max` returned empty text for structured formats through OpenCode's stateless route.
- PowerPoint and Excel files name Iosevka but cannot carry it with the existing builders, so those apps substitute a font where Iosevka is not installed. Word, PDF, web pages and infographic SVGs embed it; PNGs contain rendered pixels. Plain Markdown carries no font metadata, but its Studio viewer uses Iosevka.
- PDF characters the font cannot draw appear as `?` and are listed under **About this**. PDF rendering disables optional `frac` and `calt` substitutions for fontkit compatibility; Unicode glyph coverage and mark positioning are retained.
- Document previews show the content the file was built from, not a pixel-perfect rendering of the file.
- Large mind maps are small in the side panel; zoom in or open Studio full screen.
- Stopping a job cancels Studio's request, but the AI provider may still charge for work already started.

## Develop

All source code is in `shared/`. `scripts/build.mjs` builds both platform folders from it, so never edit the platform folders by hand. Node 22 or later and npm are needed for development only.

```sh
npm ci --ignore-scripts --no-audit --no-fund --cache ./temp/npm-cache
npm test        # controlled tests, no AI calls
npm run build   # rebuilds windows-11-x64/ and linux-fedora-amd64/
```

| Path | What it holds |
|---|---|
| `shared/common/` | Format definitions, prompts and reply checks, shared by panel and service |
| `shared/panel/` | Panel screen, viewers and styles |
| `shared/service/` | Service: HTTP bridge, jobs, storage, OpenCode adapter, file builders |
| `shared/fonts/` | Iosevka font files, upstream provenance/license and text-measurement data |
| `shared/licenses/` | License notices for bundled packages that ship none |
| `scripts/` | Build, read-only connection probe, font-metrics generator |
| `tests/` | Controlled tests for every format, recovery, storage and the service |

`npm run probe`, run from an OpenChamber agent shell, makes a read-only connection and model check. It does not generate text or print credentials. Passing the controlled tests does not prove live model behaviour or other platforms. [SPEC.md](SPEC.md) holds the full specification and design decisions; [nextsteps.md](nextsteps.md) holds the working plan; [AGENTS.md](AGENTS.md) guides AI coding agents.

## Project status

**Checked live on Windows** through the installed extension:
- All ten formats generated from real project files, including PDF, Word, PowerPoint, CSV, HTML, the old `.doc`, `.xls` and `.ppt` formats, and the current chat (compressed by OpenCode).
- Previews, study progress, history, quiet recovery, and saving.
- Word, PowerPoint and Excel files opened in Microsoft Office without repair. Exported files matched the stored files byte for byte (MD5).
- Infographic PNG and SVG saving.

**Not yet done:**
- Podcast.
- Testing on Linux and macOS.
- Clean-machine install and upgrade tests.
- Release packaging.

## Acknowledgements

Studio stands on the work of many people. Thank you all.

**Inspiration and independent development**

- [Google NotebookLM](https://notebooklm.google.com/) and [Gemini](https://gemini.google.com/): inspiration for source-grounded study materials and the simple panel of tiles and creations. No NotebookLM or Gemini application code or assets are included.
- [SurfSense](https://github.com/MODSetter/SurfSense) by MODSetter and contributors: early inspiration for the source-to-study-material workflow and range of formats. Ideas Studio is an independent extension with its own architecture, implementation decisions, and document builders; it does not bundle or require the SurfSense application or backend. Historical attribution for the initial Flashcards, Quiz, Mind map, and Web page prompt/reply-shape adaptations remains in their source headers and [NOTICE](NOTICE), with the applicable Apache-2.0 license text retained.

**Host applications**

- [OpenChamber](https://github.com/openchamber/openchamber): the host application, its extension SDK and UI kit (`@openchamber/sdk`, MIT).
- [OpenCode](https://github.com/sst/opencode): the agent runtime and model connection Studio generates through.

**Libraries bundled in the extension**

- [AntV Infographic](https://github.com/antvis/Infographic) by the AntV team at Ant Group (MIT), its icon service, and its dependencies:
  - [D3](https://github.com/d3/d3) by Mike Bostock and contributors (ISC).
  - [@antv/layout](https://github.com/antvis/layout) and [@antv/hierarchy](https://github.com/antvis/hierarchy) (MIT).
  - [linkedom](https://github.com/WebReflection/linkedom) by Andrea Giammarchi (ISC).
  - [measury](https://github.com/Aarebecca/measury) (MIT).
  - [Rough.js](https://github.com/rough-stuff/rough) by Preet Shihn (MIT).
  - [culori](https://github.com/Evercoder/culori) by Dan Burzo (MIT).
  - [PostCSS](https://github.com/postcss/postcss) by Andrey Sitnik (MIT).
  - [htmlparser2](https://github.com/fb55/htmlparser2) and related packages by Felix Boehm (MIT, BSD-2-Clause).
  - [lodash](https://github.com/lodash/lodash) (MIT).
  - [TinyColor](https://github.com/bgrins/TinyColor) (MIT).
- [docx](https://github.com/dolanmiu/docx) by Dolan Miu (MIT).
- [PptxGenJS](https://github.com/gitbrent/PptxGenJS) by Brent Ely (MIT).
- [write-excel-file](https://gitlab.com/catamphetamine/write-excel-file) by catamphetamine (MIT).
- [PDFKit](https://github.com/foliojs/pdfkit) and [fontkit](https://github.com/foliojs/fontkit) by Devon Govett and the foliojs contributors (MIT).
- [JSZip](https://github.com/Stuk/jszip) by Stuart Knightley (used under MIT) and [pako](https://github.com/nodeca/pako) (MIT and Zlib).
- [fflate](https://github.com/101arrowz/fflate) by Arjun Barrett (MIT).
- [Markmap](https://github.com/markmap/markmap) by Gerald Liu (MIT).
- [marked](https://github.com/markedjs/marked) by Christopher Jeffrey and the MarkedJS team (MIT).
- [DOMPurify](https://github.com/cure53/DOMPurify) by Mario Heiderich and Cure53 (used under Apache-2.0).
- [PDF.js](https://github.com/mozilla/pdf.js) by Mozilla and contributors (Apache-2.0).
- [Mammoth](https://github.com/mwilliamson/mammoth.js) by Michael Williamson (BSD-2-Clause), with its helpers [lop](https://github.com/mwilliamson/lop), [dingbat-to-unicode](https://github.com/mwilliamson/dingbat-to-unicode), [@xmldom/xmldom](https://github.com/xmldom/xmldom), [Underscore](https://github.com/jashkenas/underscore) and [xmlbuilder](https://github.com/oozcitak/xmlbuilder-js).
- [entities](https://github.com/fb55/entities) by Felix Boehm (BSD-2-Clause).
- Many smaller packages, each listed with its full license text in the platform folder's `THIRD-PARTY-LICENSES.txt`.

**Font**

- [Iosevka](https://typeof.net/Iosevka/) 34.9.0 by Renzhi Li (Belleve Invis), under the SIL Open Font License 1.1. Studio bundles unmodified Normal-width, Upright Regular and Bold TTF/WOFF2 files from the [official release](https://github.com/be5invis/Iosevka/releases/tag/v34.9.0); [source URLs and SHA-256 hashes](shared/fonts/Iosevka-SOURCE.json) are retained with the font.

**Development tools (not shipped)**

- [esbuild](https://github.com/evanw/esbuild) by Evan Wallace (MIT) builds the bundles.
- [python-docx](https://github.com/python-openxml/python-docx), [python-pptx](https://github.com/scanny/python-pptx), [openpyxl](https://foss.heptapod.net/openpyxl/openpyxl) and [pypdf](https://github.com/py-pdf/pypdf) were used only to check generated files during development.

Product names are trademarks of their owners. This project is independent and is not affiliated with or endorsed by SurfSense, OpenChamber, OpenCode, Google or AntV.

## License

Copyright 2026 - MintageOfMan.

Licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE) for attributions. Bundled third-party packages keep their own licenses, listed in each platform folder's `THIRD-PARTY-LICENSES.txt`. The Iosevka font stays under the [SIL Open Font License 1.1](shared/fonts/Iosevka-LICENSE.txt).
