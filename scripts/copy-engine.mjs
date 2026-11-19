// Copies the Stockfish 19 lite single-threaded WASM build (GPLv3, stockfish.js by Nathan Rugg)
// into public/engine/ together with its licence. Runs before dev/build.
import { copyFileSync, mkdirSync } from 'node:fs';
const src = new URL('../node_modules/stockfish/', import.meta.url);
const dst = new URL('../public/engine/', import.meta.url);
mkdirSync(dst, { recursive: true });
for (const f of ['bin/stockfish-19-lite-single.js', 'bin/stockfish-19-lite-single.wasm', 'Copying.txt']) {
  copyFileSync(new URL(f, src), new URL(f.split('/').pop(), dst));
}
console.log('engine copied to public/engine/');
