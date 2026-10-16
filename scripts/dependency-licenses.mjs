import fs from 'node:fs/promises';
import path from 'node:path';

const exists = file => fs.access(file).then(() => true, () => false);
const isLicense = file => /^(license|licence|copying)(\.|-|$)/i.test(file);
const isNotice = file => /^(notice|copyright)(\.|-|$)/i.test(file);

export async function dependencyLicenses(inputs, root) {
  const packages = new Map();
  for (const input of inputs) {
    const source = input.replaceAll('\\', '/');
    // The last package boundary identifies nested versions, not just their parent.
    const match = [...source.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/g)].at(-1);
    if (!match) continue;
    const directory = path.resolve(root, source.slice(0, match.index + match[0].length));
    if (!packages.has(directory)) packages.set(directory, { name: match[1], inputs: new Set() });
    packages.get(directory).inputs.add(path.resolve(root, source));
  }

  const entries = [];
  for (const [directory, pkg] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    let licenseDirectory = directory;
    if (!await exists(path.join(licenseDirectory, 'package.json'))) {
      // Some dependencies prebundle node_modules without metadata or license files.
      // Use their installed dependency's license and retain original source notices below.
      licenseDirectory = null;
      for (let parent = path.dirname(directory); parent.startsWith(root); parent = path.dirname(parent)) {
        const candidate = path.join(parent, 'node_modules', pkg.name);
        if (await exists(path.join(candidate, 'package.json'))) { licenseDirectory = candidate; break; }
        if (parent === root) break;
      }
      if (!licenseDirectory) throw new Error(`Missing license reference for vendored dependency ${pkg.name}.`);
    }
    const metadata = JSON.parse(await fs.readFile(path.join(licenseDirectory, 'package.json'), 'utf8'));
    const files = (await fs.readdir(licenseDirectory, { withFileTypes: true }))
      .filter(entry => entry.isFile()).map(entry => entry.name).sort();
    let licenses = files.filter(isLicense).map(file => path.join(licenseDirectory, file));
    if (!licenses.length) {
      const vendored = path.join(root, 'shared/licenses', `${pkg.name.replace('/', '__')}-LICENSE.txt`);
      if (await exists(vendored)) licenses = [vendored];
    }
    if (!licenses.length) throw new Error(`Missing license text for bundled dependency ${pkg.name}.`);
    const embedded = licenseDirectory !== directory;
    entries.push(`${pkg.name} ${metadata.version}${embedded ? ' (license reference for vendored copy)' : ''}\n${metadata.license ?? 'See license text'}\n`);
    if (embedded) entries.push(`Vendored source: ${path.relative(root, directory).replaceAll('\\', '/')}\n`);
    for (const file of [...licenses, ...files.filter(isNotice).map(file => path.join(licenseDirectory, file))]) {
      entries.push(await fs.readFile(file, 'utf8'));
    }
    if (embedded) {
      const notices = new Set();
      for (const input of pkg.inputs) {
        // Prebundlers can move imports ahead of the original copyright block.
        for (const [comment] of (await fs.readFile(input, 'utf8')).matchAll(/\/\*[\s\S]*?\*\//g)) {
          if (/copyright|@license|SPDX-License-Identifier/i.test(comment)) notices.add(comment.trim());
        }
      }
      entries.push(...notices);
    }
  }
  return entries;
}
