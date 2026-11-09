// Copies Tesseract worker, WASM core and ita/eng models into public/ocr so OCR runs
// fully self-hosted (no CDN, works offline once cached).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const out = join(import.meta.dirname, '..', 'public', 'ocr');
const pkgDir = (name, from = require) => dirname(from.resolve(`${name}/package.json`));
// the WASM core must be the exact one tesseract.js depends on
const tesseractDir = pkgDir('tesseract.js');
const coreDir = pkgDir('tesseract.js-core', createRequire(join(tesseractDir, 'package.json')));

mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });

cpSync(join(tesseractDir, 'dist', 'worker.min.js'), join(out, 'worker.min.js'));
// LSTM-only builds are smaller; tesseract.js picks (relaxed) SIMD when the browser supports it
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
  cpSync(join(coreDir, f), join(out, 'core', f));
}
for (const lang of ['ita', 'eng']) {
  const src = join(pkgDir(`@tesseract.js-data/${lang}`), '4.0.0_best_int', `${lang}.traineddata.gz`);
  const dst = join(out, 'lang', `${lang}.traineddata.gz`);
  if (!existsSync(dst)) cpSync(src, dst);
}
console.log('OCR assets → public/ocr');
