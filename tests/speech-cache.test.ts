import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 假的 Audio：记下播放的地址，play 立即成功
const played: string[] = [];
class FakeAudio {
  src: string; onended: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(src: string) { this.src = src; }
  play() { played.push(this.src); return Promise.resolve(); }
  pause() {} load() {} removeAttribute() {}
}

describe('发音缓存', () => {
  beforeEach(async () => {
    vi.resetModules();
    played.length = 0;
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
    const { db } = await import('../src/db/db');
    await db.audio.clear();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('经同站代理下载一次，存进本机；之后播放不再请求', async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }), { headers: { 'content-type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { preloadSpeech, speak } = await import('../src/lib/speech');
    const { db } = await import('../src/db/db');
    preloadSpeech('Bonjour tout le monde.', 'fr');
    await vi.waitFor(async () => expect(await db.audio.count()).toBe(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('./api/tts?q=');
    await speak('Bonjour tout le monde.', 'fr');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(played).toEqual(['blob:x']);
  });

  it('代理不可用（本地开发 404）：不再试代理，退回直连 Google 播放', async () => {
    const fetchMock = vi.fn(async () => new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { preloadSpeech, speak } = await import('../src/lib/speech');
    await speak('Salut.', 'fr');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 直接播放：先试代理地址（Audio 直接播），成功就记住
    expect(played[0]).toContain('api/tts');
    preloadSpeech('Encore une phrase.', 'fr');
    await speak('Encore une phrase.', 'fr');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
