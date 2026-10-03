// 内存版 GitHub：只实现同步引擎用到的几个接口，行为（空仓库 409、非快进 422）与真实 API 一致。
import { gitBlobSha } from '../src/sync/files';
import { base64ToUtf8, utf8ToBase64 } from '../src/sync/github';

type Tree = Record<string, string>; // path → blob sha

export class FakeGitHub {
  blobs = new Map<string, string>();
  trees = new Map<string, Tree>();
  commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  head: string | null = null;
  private n = 0;
  /** 在下一次 updateRef 之前触发一次（模拟其他设备/其他 app 抢先提交） */
  beforeNextUpdateRef: (() => Promise<void>) | null = null;
  requests: string[] = [];

  private id(p: string) {
    return `${p}${++this.n}`;
  }

  async putBlob(text: string) {
    const sha = await gitBlobSha(text);
    this.blobs.set(sha, text);
    return sha;
  }

  /** 直接在远端提交（模拟另一台设备或其他 app） */
  async commitFiles(files: Record<string, string>, message = 'external') {
    const base: Tree = this.head ? { ...this.trees.get(this.commits.get(this.head)!.tree)! } : {};
    for (const [p, text] of Object.entries(files)) base[p] = await this.putBlob(text);
    const t = this.id('tree');
    this.trees.set(t, base);
    const c = this.id('commit');
    this.commits.set(c, { tree: t, parents: this.head ? [this.head] : [], message });
    this.head = c;
    return c;
  }

  files(): Record<string, string> {
    if (!this.head) return {};
    const tree = this.trees.get(this.commits.get(this.head)!.tree)!;
    return Object.fromEntries(Object.entries(tree).map(([p, sha]) => [p, this.blobs.get(sha)!]));
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
    this.requests.push(`${method} ${path}`);
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    let m: RegExpMatchArray | null;

    if (method === 'GET' && path === '') return json(200, { private: true, default_branch: 'main', full_name: 'me/data', html_url: '' });
    if (method === 'GET' && path === '/git/ref/heads/main')
      return this.head ? json(200, { object: { sha: this.head } }) : json(409, { message: 'Git Repository is empty.' });
    if (method === 'GET' && (m = path.match(/^\/git\/commits\/(.+)$/))) return json(200, { tree: { sha: this.commits.get(m[1])!.tree } });
    if (method === 'GET' && (m = path.match(/^\/git\/trees\/(.+)$/))) {
      const tree = this.trees.get(m[1])!;
      return json(200, { truncated: false, tree: Object.entries(tree).map(([p, sha]) => ({ path: p, mode: '100644', type: 'blob', sha })) });
    }
    if (method === 'GET' && (m = path.match(/^\/git\/blobs\/(.+)$/))) return json(200, { encoding: 'base64', content: utf8ToBase64(this.blobs.get(m[1])!) });
    if (method === 'POST' && path === '/git/trees') {
      const base: Tree = { ...this.trees.get(body.base_tree)! };
      for (const e of body.tree) base[e.path] = await this.putBlob(e.content);
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
      const c = await this.commitFiles({ [p]: base64ToUtf8(body.content) }, body.message);
      return json(201, { commit: { sha: c } });
    }
    return json(404, { message: `fake: no route ${method} ${path}` });
  };
}
