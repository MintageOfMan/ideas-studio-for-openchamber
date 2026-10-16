import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dependencyLicenses } from './dependency-licenses.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { name, version, description, openchamber } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const targets = [
  { folder: 'windows-11-x64', platform: 'win32', arch: 'x64' },
  { folder: 'linux-fedora-amd64', platform: 'linux', arch: 'x64' },
];
// Inter, the one Studio font: TTF for PDF and Word embedding, WOFF2 for the panel, web pages and SVG.
const SERVICE_FONTS = ['Inter-Regular.ttf', 'Inter-Bold.ttf', 'Inter-Regular.woff2', 'Inter-Bold.woff2'];
const SEPARATOR = '\n\n----------------------------------------\n\n';

// Only packages that actually contribute bytes to a bundle need their notices shipped.
function bundledInputs(...results) {
  return results.flatMap((result) => Object.values(result.metafile.outputs))
    .flatMap((output) => Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0).map(([name]) => name));
}

async function licenses(inputs) {
  const entries = await dependencyLicenses(inputs, root);
  entries.push([
    'SurfSense (https://github.com/MODSetter/SurfSense), commit 7fb479c361414e1ffd180860eb0b5eb5afb0c4e3',
    'Historical attribution for the initial Apache-2.0 prompt/reply-shape adaptations in',
    'Flashcards, Quiz, Mind map and Web page; see their headers in shared/common/. No code from',
    'surfsense_backend/app/proprietary/ is used. The upstream license file follows verbatim.',
    '',
  ].join('\n'));
  entries.push(await fs.readFile(path.join(root, 'shared/licenses/SurfSense-LICENSE.txt'), 'utf8'));
  entries.push(`Inter 4.1 (https://github.com/rsms/inter), files ${SERVICE_FONTS.join(', ')} in service/fonts/ (and the WOFF2 faces inside panel/main.js), unmodified.\nEmbedded in generated Word documents, web pages, infographics and PDFs. The upstream license file follows verbatim.\n`);
  entries.push(await fs.readFile(path.join(root, 'shared/fonts/Inter-LICENSE.txt'), 'utf8'));
  // Keep upstream notice wording intact without carrying whitespace-only diff errors.
  return entries.join(SEPARATOR).replace(/[ \t]+$/gm, '') + '\n';
}

async function inventory(directory) {
  let bytes = 0;
  let files = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const child = await inventory(full); bytes += child.bytes; files += child.files;
    } else { bytes += (await fs.stat(full)).size; files += 1; }
  }
  return { bytes, files };
}

for (const target of targets) {
  const directory = path.join(root, target.folder);
  await fs.mkdir(path.join(directory, 'panel'), { recursive: true });
  await fs.mkdir(path.join(directory, 'service/fonts'), { recursive: true });
  const node = {
    absWorkingDir: root, bundle: true, platform: 'node', format: 'esm', target: 'node22', minify: true, legalComments: 'eof', metafile: true,
    define: { __STUDIO_TARGET__: JSON.stringify(target), __STUDIO_FONTS__: JSON.stringify('./fonts/'), __STUDIO_WORKER__: JSON.stringify('./infographic-worker.js') },
    // The document libraries are CommonJS and require Node built-ins at runtime.
    banner: { js: "import { createRequire as __studioRequire } from 'node:module'; const require = __studioRequire(import.meta.url);" },
    alias: { 'brotli/decompress.js': './shared/service/builders/no-brotli.mjs' },
  };
  const [panel, service, worker] = await Promise.all([
    // The panel bundles its two font faces (base64); see shared/panel/fonts.js.
    build({ absWorkingDir: root, entryPoints: ['shared/panel/main.js'], outfile: path.join(directory, 'panel/main.js'), bundle: true, platform: 'browser', format: 'iife', target: 'es2022', minify: true, legalComments: 'eof', metafile: true, loader: { '.woff2': 'base64' } }),
    build({ ...node, entryPoints: ['shared/service/main.mjs'], outfile: path.join(directory, 'service/main.js') }),
    // AntV Infographic runs in its own thread; see shared/service/builders/infographic-worker.mjs.
    build({ ...node, entryPoints: ['shared/service/builders/infographic-worker.mjs'], outfile: path.join(directory, 'service/infographic-worker.js') }),
  ]);
  for (const file of SERVICE_FONTS) await fs.copyFile(path.join(root, 'shared/fonts', file), path.join(directory, 'service/fonts', file));
  // Each distributed folder carries the project license and attribution notice.
  for (const file of ['LICENSE', 'NOTICE']) await fs.copyFile(path.join(root, file), path.join(directory, file));
  for (const file of ['index.html', 'styles.css', 'icon.svg']) {
    await fs.copyFile(path.join(root, 'shared/panel', file), path.join(directory, 'panel', file));
  }
  const manifest = {
    name, version, private: true, type: 'module', description, license: 'Apache-2.0',
    studioPlatform: { os: target.platform, arch: target.arch },
    openchamber: {
      ...openchamber,
      contributes: {
        ...openchamber.contributes,
        panel: { ...openchamber.contributes.panel, icon: 'panel/icon.svg', entry: 'panel/index.html' },
        service: { ...openchamber.contributes.service, entry: 'service/main.js' },
      },
    },
  };
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'THIRD-PARTY-LICENSES.txt'), await licenses(bundledInputs(panel, service, worker)));
  const size = await inventory(directory);
  if (size.bytes > 40 * 1024 * 1024 || size.files > 500) throw new Error(`${target.folder} exceeds the inspected extension extraction limits.`);
  console.log(`${target.folder}: ${size.bytes} expanded bytes, ${size.files} files. Runtime validation is separate from a successful build.`);
}
