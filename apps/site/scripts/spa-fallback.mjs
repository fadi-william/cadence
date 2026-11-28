// GitHub Pages serves 404.html for unknown paths: make it the app shell so deep links (/docs/jira) work.
// .nojekyll stops Pages from hiding files that start with an underscore.
import { copyFileSync, writeFileSync } from 'node:fs';
const out = new URL('../dist/site/browser/', import.meta.url);
copyFileSync(new URL('index.html', out), new URL('404.html', out));
writeFileSync(new URL('.nojekyll', out), '');
// CNAME keeps the custom domain attached to the Pages site.
if (process.env.PAGES_DOMAIN) writeFileSync(new URL('CNAME', out), `${process.env.PAGES_DOMAIN}\n`);
console.log(
  'SPA fallback written (404.html, .nojekyll' + (process.env.PAGES_DOMAIN ? ', CNAME)' : ')'),
);
