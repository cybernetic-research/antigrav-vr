// Builds music/index.json from the audio files in music/ so the game can list
// them (a static server can't list directories).  Usage: node tools/make-music-index.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'music');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(mp3|m4a|ogg|opus|wav|flac)$/i.test(f)).sort() : [];
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ tracks: files.map((file) => ({ file, title: file.replace(/\.[^.]+$/, '') })) }, null, 1));
console.log(`music/index.json: ${files.length} track(s)`);
