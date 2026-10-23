# Ideas Studio - Windows 11 x64 development package

Add this folder through OpenChamber **Settings > Extensions** and approve `files` and `service`. OpenChamber starts the bundled JavaScript service using its own runtime; no separate Node/Python installation is needed.

Open **Ideas Studio** beside a chat or an empty draft, tick the documents to use (text, Word, PDF, PowerPoint, Excel, old Office formats and more) or the available current chat, and tap a tile to open **Options**. Review its numeric target and optional focus, then choose **Create**. Spreadsheet uses source tables and shows its limits instead of a row-count target. Save writes a new `.md`, `.html`, `.docx`, `.pptx`, `.xlsx`, `.pdf`, `.png`, or `.svg` file in that project, without overwriting files. History is under `.studio/`.

This build targets a local loopback OpenChamber connection whose proxy permits the request as configured. Protected, remote, and relay hosts are not supported. Generation uses OpenCode's stateless text route; Automatic follows the saved session or configured defaults. Sources above 200,000 characters in total are rejected, not truncated. Ten of eleven formats are implemented; only Podcast remains planned. See the [root README](../README.md#what-it-makes) for numeric options, format limits, and the Git-URL or repository-root installation paths.

Earlier Windows checks with OpenChamber 2.1.1 / OpenCode 2.0.22 covered installation, live generation of all ten implemented formats, opening the Office exports in Microsoft Office, study progress, history reopening, and export. Cancellation and no-overwrite checks used controlled transports. These checks predate the Options-first follow-up. Source and full specification: [GitHub repository](https://github.com/MintageOfMan/ideas-studio-for-openchamber).

Licensed under the Apache License 2.0; see LICENSE and NOTICE in this folder. Bundled packages keep their own licenses; standard Iosevka 34.9.0 Regular and Bold remain under the SIL Open Font License 1.1 (THIRD-PARTY-LICENSES.txt).
