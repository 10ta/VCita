import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { sha1Hex } from '../src/lib/sha1';
import { gitBlobSha } from '../src/sync/files';

describe('纯 JS SHA-1', () => {
  it('与 Node crypto 一致（覆盖分块边界）', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 100_000]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff);
      expect(sha1Hex(bytes)).toBe(createHash('sha1').update(bytes).digest('hex'));
    }
  });

  it('没有 crypto.subtle 时 gitBlobSha 仍然正确', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
      expect(await gitBlobSha('中文 émoji 🎓\n')).toBe(
        createHash('sha1').update(`blob ${Buffer.byteLength('中文 émoji 🎓\n')}\0中文 émoji 🎓\n`).digest('hex'),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
