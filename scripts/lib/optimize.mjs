// Сжатие PNG (палитра + zlib 9) — скриншоты в репозитории должны быть лёгкими.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

export async function optimizeDir(dir) {
  let before = 0;
  let after = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const r = await optimizeDir(p);
      before += r.before;
      after += r.after;
    } else if (e.name.endsWith('.png')) {
      const buf = await readFile(p);
      const out = await sharp(buf).png({ palette: true, quality: 82, effort: 9, compressionLevel: 9 }).toBuffer();
      before += buf.length;
      after += Math.min(buf.length, out.length);
      if (out.length < buf.length) await writeFile(p, out);
    }
  }
  return { before, after };
}
