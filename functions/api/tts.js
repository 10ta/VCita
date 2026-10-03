// Cloudflare Pages Function：/api/tts?q=&tl= → Google TTS（服务端发请求，不受浏览器来源限制）
export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const q = u.searchParams.get('q');
  const tl = u.searchParams.get('tl') || 'en';
  if (!q || q.length > 200) return new Response('bad request', { status: 400 });
  const r = await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(q)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://translate.google.com/' },
  });
  return new Response(r.body, {
    status: r.status,
    headers: { 'Content-Type': r.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': r.ok ? 'public, max-age=86400' : 'no-store' },
  });
}
