import fs from 'node:fs';
import path from 'node:path';
const assets = path.resolve('dist/assets');
const galleryMarkers = ['data-ui-gallery', '示例数据，不连接真实业务'];
if (!fs.existsSync(assets)) throw new Error('Run the production build first.');
for (const name of fs.readdirSync(assets)) {
  if (!/\.(?:js|css)$/.test(name)) continue;
  const source = fs.readFileSync(path.join(assets, name), 'utf8');
  if (/UiGallery|ui-gallery/i.test(name) || galleryMarkers.some(marker => source.includes(marker))) {
    throw new Error(`Development Gallery leaked into production assets: ${name}`);
  }
}
console.log('Production assets exclude the development UI Gallery.');
