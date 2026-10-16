// A Git-URL install starts at the repository root. The panel is platform-neutral;
// choose the matching prebuilt service without requiring npm or a build at install time.
const folders = { win32: 'windows-11-x64', linux: 'linux-fedora-amd64' };
const folder = folders[process.platform];
if (!folder || process.arch !== 'x64') {
  throw new Error(`Ideas Studio supports Windows x64 and Linux x64, not ${process.platform}/${process.arch}.`);
}
await import(`./${folder}/service/main.js`);
