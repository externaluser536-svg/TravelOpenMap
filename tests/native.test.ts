import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// В XML «--» внутри комментария недопустимо: Gradle не сможет разобрать манифест (ловили именно это).
describe('нативные манифесты', () => {
  for (const f of ['android/app/src/main/AndroidManifest.xml', 'ios/App/App/Info.plist']) {
    it(`${f}: комментарии корректны`, () => {
      const xml = readFileSync(f, 'utf8');
      const comments = [...xml.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);
      for (const c of comments) expect(c, c).not.toContain('--');
      expect((xml.match(/<!--/g) ?? []).length).toBe(comments.length);
    });
  }
});
