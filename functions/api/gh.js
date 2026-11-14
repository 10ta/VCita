// CF Pages Function：/api/gh?p=/repos/owner/repo/... → api.github.com（GitHub 同步的转发，直连不通时才用）。
// 只放行同步用到的接口；令牌在请求头里原样转给 GitHub，这里不记录、不保存。与 api/gh.js 相同
const ALLOW = /^\/repos\/[\w.-]+\/[\w.-]+(\/git\/(ref|refs|commits|trees|blobs)(\/[^?#]*)?|\/contents\/[^?#]+)?(\?recursive=1)?$/;
const METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT']);
const PASS = ['authorization', 'accept', 'x-github-api-version', 'content-type'];

export async function onRequest({ request }) {
  const p = new URL(request.url).searchParams.get('p') || '';
  if (!ALLOW.test(p) || p.includes('..') || !METHODS.has(request.method)) return json(400, { message: 'not allowed' });
  const headers = { 'User-Agent': 'VCita-sync' };
  for (const h of PASS) { const v = request.headers.get(h); if (v) headers[h] = v; }
  const r = await fetch(`https://api.github.com${p}`, {
    method: request.method,
    headers,
    body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
  });
  return new Response(r.body, {
    status: r.status,
    headers: { 'Content-Type': r.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' },
  });
}

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
