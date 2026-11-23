import { mkdir, readdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(scriptDir, '../..');
const spotsDir = join(projectRoot, 'frontend', 'public', 'spots');
const sourceDir = join(spotsDir, 'source');
const widths = [480, 960, 1440];

const placeholder = (label, sky, land) => Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
    <defs>
      <linearGradient id="sky" x2="0" y2="1">
        <stop stop-color="${sky[0]}"/>
        <stop offset="1" stop-color="${sky[1]}"/>
      </linearGradient>
      <linearGradient id="land" x2="0" y2="1">
        <stop stop-color="${land[0]}"/>
        <stop offset="1" stop-color="${land[1]}"/>
      </linearGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#sky)"/>
    <circle cx="1230" cy="210" r="95" fill="#fff4cc" opacity=".8"/>
    <path d="M0 620 330 300l230 230 280-340 300 360 210-240 250 260v330H0Z" fill="${land[0]}" opacity=".75"/>
    <path d="M0 690 280 500l260 180 260-230 280 200 240-160 280 190v220H0Z" fill="url(#land)"/>
    <path d="M0 800q240-90 480 0t480 0 640 0v100H0Z" fill="${land[1]}" opacity=".8"/>
    <text x="80" y="820" fill="#ffffff" font-family="sans-serif" font-size="54" opacity=".85">${label}</text>
  </svg>
`);

const placeholders = [
  { name: 'spot-1', label: '翠湖公园', sky: ['#9dc9d4', '#d2e8d4'], land: ['#6b9b75', '#36644d'] },
  { name: 'spot-2', label: '洱海风光', sky: ['#79b9d1', '#e3eadc'], land: ['#739ba0', '#3c6b70'] },
  { name: 'spot-3', label: '丽江古城', sky: ['#b2c4dc', '#f0d8bd'], land: ['#9b8569', '#605245'] }
];

await mkdir(spotsDir, { recursive: true });

let sourceFiles = [];
try {
  sourceFiles = (await readdir(sourceDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && /\.(?:jpe?g|png|webp|tiff?|avif|svg)$/i.test(entry.name))
    .map(entry => join(sourceDir, entry.name));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const sourceNames = new Set(sourceFiles.map(file => basename(file, extname(file))));
const inputs = sourceFiles.map(file => ({ name: basename(file, extname(file)), input: file }));
for (const item of placeholders) {
  if (!sourceNames.has(item.name)) {
    inputs.push({
      name: item.name,
      input: placeholder(item.label, item.sky, item.land)
    });
  }
}

let totalBytes = 0;
for (const { name, input } of inputs) {
  for (const width of widths) {
    const output = join(spotsDir, `${name}-${width}.webp`);
    await sharp(input)
      .rotate()
      .resize({ width, withoutEnlargement: false })
      .webp({ quality: 75, effort: 5 })
      .toFile(output);
    totalBytes += (await stat(output)).size;
  }
}

console.log(JSON.stringify({
  event: 'images.optimized',
  sourceCount: sourceFiles.length,
  generatedCount: inputs.length * widths.length,
  widths,
  quality: 75,
  totalBytes
}));
