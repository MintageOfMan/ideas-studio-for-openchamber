# Ideas Studio - Fedora amd64 development package

Built from the shared implementation with a Linux x64 runtime guard. **Not runtime-tested on Fedora.** Do not treat a successful build as Linux qualification.

For an explicit development trial, add this folder through OpenChamber **Settings > Extensions** on a local Linux x64 host. The package uses OpenChamber's runtime, not a separately installed Node/Python or backend. Protected, remote, and relay connections are not supported.

It offers Summary, Word, Slides, Spreadsheet, Web page, PDF, Mind map, Flashcards, Quiz, and Infographic from selected project documents (text, Word, PDF, PowerPoint, Excel, old Office formats and more) and the current chat, totalling at most 200,000 characters. Tap a tile to review **Options**, with a numeric target and optional focus, then choose **Create**. Spreadsheet uses source tables and shows its limits instead of a row-count target. Generation uses OpenCode's stateless text route; Automatic follows the saved session or configured defaults. Export creates a new file and refuses to overwrite existing files; Infographic keeps both PNG and SVG export. History is under `.studio/`. See the [root README](../README.md#what-it-makes) for numeric options, format limits, and the Git-URL or repository-root installation paths.

Source and full specification: [GitHub repository](https://github.com/MintageOfMan/ideas-studio-for-openchamber). Ten of eleven formats are implemented; only Podcast remains planned. Platform qualification, including PDF font loading on Linux, remains pending.

Licensed under the Apache License 2.0; see LICENSE and NOTICE in this folder. Bundled packages keep their own licenses; standard Iosevka 34.9.0 Regular and Bold remain under the SIL Open Font License 1.1 (THIRD-PARTY-LICENSES.txt).
