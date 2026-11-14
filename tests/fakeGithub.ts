// 内存版 GitHub：只实现同步引擎用到的几个接口，行为（空仓库 409、非快进 422）与真实 API 一致。
import { gunzipSync } from 'node:zlib';
import { gitBlobShaBytes } from '../src/sync/files';
import { base64ToBytes, bytesToBase64 } from '../src/sync/github';

type Tree = Record<string, string>; // path → blob sha

export class FakeGitHub {
  blobs = new Map<string, Uint8Array>();
  trees = new Map<string, Tree>();
  commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  head: string | null = null;
  private n = 0;
  /** 在下一次 updateRef 之前触发一次（模拟其他设备/其他 app 抢先提交） */
  beforeNextUpdateRef: (() => Promise<void>) | null = null;
  requests: string[] = [];
  /** 模拟国内：直连 api.github.com 连不上 */
  directDown = false;
  /** 本站转发函数是否部署了 */
  proxyUp = true;
  viaProxy = 0;

  private id(p: string) {
    return `${p}${++this.n}`;
  }

  async putBlob(content: string | Uint8Array) {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const sha = await gitBlobShaBytes(bytes);
    this.blobs.set(sha, bytes);
    return sha;
  }

  /** 仓库里的实际路径（含 .json.gz 后缀） */
  paths(): string[] {
    if (!this.head) return [];
    return Object.keys(this.trees.get(this.commits.get(this.head)!.tree)!);
  }

  /** 直接在远端提交（模拟另一台设备或其他 app） */
  async commitFiles(files: Record<string, string | Uint8Array>, message = 'external') {
    const base: Tree = this.head ? { ...this.trees.get(this.commits.get(this.head)!.tree)! } : {};
    for (const [p, text] of Object.entries(files)) base[p] = await this.putBlob(text);
    const t = this.id('tree');
    this.trees.set(t, base);
    const c = this.id('commit');
    this.commits.set(c, { tree: t, parents: this.head ? [this.head] : [], message });
    this.head = c;
    return c;
  }

  /** 各文件的文本：.json.gz 解压后以去掉 .gz 的路径为键（同名旧 .json 也在时以 .gz 为准） */
  files(): Record<string, string> {
    if (!this.head) return {};
    const tree = this.trees.get(this.commits.get(this.head)!.tree)!;
    const out: Record<string, string> = {};
    for (const [p, sha] of Object.entries(tree)) if (!p.endsWith('.gz')) out[p] = new TextDecoder().decode(this.blobs.get(sha)!);
    for (const [p, sha] of Object.entries(tree)) if (p.endsWith('.gz')) out[p.slice(0, -3)] = gunzipSync(this.blobs.get(sha)!).toString('utf8');
    return out;
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // 本站转发 ./api/gh?p=/repos/...：测试里可以开关
    let url = new URL(String(input), 'http://site.test/');
    if (url.pathname.endsWith('/api/gh')) {
      if (!this.proxyUp) return new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
      this.viaProxy++;
      url = new URL(url.searchParams.get('p')!, 'https://api.github.com');
    } else if (this.directDown) throw new TypeError('Failed to fetch');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
    this.requests.push(`${method} ${path}`);
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
    let m: RegExpMatchArray | null;

    if (method === 'GET' && path === '') return json(200, { private: true, default_branch: 'main', full_name: 'me/data', html_url: '' });
    if (method === 'GET' && path === '/git/ref/heads/main')
      return this.head ? json(200, { object: { sha: this.head } }) : json(409, { message: 'Git Repository is empty.' });
    if (method === 'GET' && (m = path.match(/^\/git\/commits\/(.+)$/))) return json(200, { tree: { sha: this.commits.get(m[1])!.tree } });
    if (method === 'GET' && (m = path.match(/^\/git\/trees\/(.+)$/))) {
      const tree = this.trees.get(m[1])!;
      return json(200, { truncated: false, tree: Object.entries(tree).map(([p, sha]) => ({ path: p, mode: '100644', type: 'blob', sha })) });
    }
    if (method === 'GET' && (m = path.match(/^\/git\/blobs\/(.+)$/))) return json(200, { encoding: 'base64', content: bytesToBase64(this.blobs.get(m[1])!) });
    if (method === 'POST' && path === '/git/blobs') return json(201, { sha: await this.putBlob(base64ToBytes(body.content)) });
    if (method === 'POST' && path === '/git/trees') {
      const base: Tree = { ...this.trees.get(body.base_tree)! };
      for (const e of body.tree) {
        if (e.sha === null) delete base[e.path];
        else if (e.sha) { if (!this.blobs.has(e.sha)) return json(422, { message: 'bad sha' }); base[e.path] = e.sha; }
        else base[e.path] = await this.putBlob(e.content);
      }
      const t = this.id('tree');
      this.trees.set(t, base);
      return json(201, { sha: t });
    }
    if (method === 'POST' && path === '/git/commits') {
      const c = this.id('commit');
      this.commits.set(c, { tree: body.tree, parents: body.parents, message: body.message });
      return json(201, { sha: c });
    }
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      if (this.beforeNextUpdateRef) {
        const f = this.beforeNextUpdateRef;
        this.beforeNextUpdateRef = null;
        await f();
      }
      const c = this.commits.get(body.sha)!;
      if (c.parents[0] !== this.head) return json(422, { message: 'Update is not a fast forward' });
      this.head = body.sha;
      return json(200, {});
    }
    if (method === 'PUT' && (m = path.match(/^\/contents\/(.+)$/))) {
      const p = decodeURIComponent(m[1]);
      const c = await this.commitFiles({ [p]: base64ToBytes(body.content) }, body.message);
      return json(201, { commit: { sha: c } });
    }
    return json(404, { message: `fake: no route ${method} ${path}` });
  };
}
