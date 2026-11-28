// Copies the single sources of truth into public/ before serve/build:
//   docs/guide/*.md       → public/guide/        (rendered by the docs pages)
//   docs/screenshots/*.png → public/screenshots/
//   apps/web/public/logo.svg → public/logo.svg
// The copies are git-ignored; edit the originals.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = fileURLToPath(new URL('..', import.meta.url));
const root = join(site, '../..');
const copyDir = (from, to, ext) => {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from).filter((n) => n.endsWith(ext)))
    copyFileSync(join(from, f), join(to, f));
};
copyDir(join(root, 'docs/guide'), join(site, 'public/guide'), '.md');
copyDir(join(root, 'docs/screenshots'), join(site, 'public/screenshots'), '.png');
copyFileSync(join(root, 'apps/web/public/logo.svg'), join(site, 'public/logo.svg'));
console.log('Synced guides, screenshots and logo into apps/site/public');
