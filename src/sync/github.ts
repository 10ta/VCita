// GitHub REST API 的最小封装：只用 Git Data API（ref / commit / tree / blob）和一次 Contents API（空仓库初始化）。
// 先直连 api.github.com；连不上（国内网络常见）时改走本站转发 ./api/gh（CF Pages / Vercel 部署时随站点发布），
// 并记住 1 天。令牌保存在本机；走转发时会经过你自己部署的那个函数（不记录、不保存）。

const API = 'https://api.github.com';
/** 本站转发：/api/gh?p=/repos/owner/repo/... */
const PROXY = './api/gh';
const ROUTE_KEY = 'vcita-gh-route';
const ROUTE_TTL = 24 * 3600_000;
/** 第一次（还不知道哪条路通）直连等多久算连不上 */
const PROBE_TIMEOUT = 8000;
type Route = 'direct' | 'proxy';
let route: Route | null = null;
function rememberedRoute(): Route | null {
  if (route) return route;
  try {
    const r = JSON.parse(localStorage.getItem(ROUTE_KEY) ?? 'null') as { route: Route; at: number } | null;
    if (r && Date.now() - r.at < ROUTE_TTL) return r.route;
  } catch { /* 没有 localStorage（测试、隐私模式） */ }
  return null;
}
function setRoute(r: Route) {
  route = r;
  try { localStorage.setItem(ROUTE_KEY, JSON.stringify({ route: r, at: Date.now() })); } catch { /* 同上 */ }
}
/** 测试用：忘掉选过的路 */
export const resetRoute = () => { route = null; try { localStorage.removeItem(ROUTE_KEY); } catch { /* 同上 */ } };
const proxyUrl = (p: string) => `${PROXY}?p=${encodeURIComponent(p)}`;

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RepoInfo {
  private: boolean;
  default_branch: string;
  full_name: string;
  html_url: string;
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}

function explain(status: number, apiMessage: string): string {
  if (status === 401) return '令牌无效或已过期，请重新生成并填写。';
  if (status === 403)
    return /rate limit/i.test(apiMessage)
      ? 'GitHub API 调用次数超限，请稍后再试。'
      : '令牌没有这个仓库的写入权限（需要 Contents: Read and write）。';
  if (status === 404) return '找不到这个仓库，或者令牌没有授权访问它。';
  return `GitHub 返回 ${status}${apiMessage ? `：${apiMessage}` : ''}`;
}

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToUtf8(b64: string): string {
  return new TextDecoder().decode(base64ToBytes(b64));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ''));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** "owner/repo" 或完整 URL → { owner, repo } */
export function parseRepo(input: string): { owner: string; repo: string } | null {
  const m = input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export class GitHub {
  constructor(
    private owner: string,
    private repo: string,
    private token: string,
  ) {}

  /** 按选好的路发请求；还不知道哪条路通时先直连，连不上再试本站转发 */
  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    const full = `/repos/${this.owner}/${this.repo}${path}`;
    const init = (signal?: AbortSignal): RequestInit => ({
      method,
      cache: 'no-store', // 避免拿到浏览器缓存的旧 ref，导致反复冲突
      signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const viaProxy = async () => {
      const r = await fetch(proxyUrl(full), init());
      // 没部署转发函数时，静态站点会把 /api/gh 当成页面返回 HTML
      if (!(r.headers.get('content-type') ?? '').includes('json')) throw new Error('no proxy');
      return r;
    };
    const known = rememberedRoute();
    if (known === 'proxy') {
      try { return await viaProxy(); } catch { /* 转发不通了：再试直连 */ }
    }
    const ctrl = known === 'direct' ? null : new AbortController();
    const timer = ctrl ? setTimeout(() => ctrl.abort(), PROBE_TIMEOUT) : undefined;
    try {
      const r = await fetch(`${API}${full}`, init(ctrl?.signal));
      if (known !== 'direct') setRoute('direct');
      return r;
    } catch {
      if (known !== 'proxy') {
        try { const r = await viaProxy(); setRoute('proxy'); return r; } catch { /* 两条路都不通 */ }
      }
      throw new GitHubError(0, '连接不上 GitHub：直连 api.github.com 和本站转发都不通，请检查网络。');
    } finally {
      clearTimeout(timer);
    }
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.send(method, path, body);
    if (!res.ok) {
      let msg = '';
      try {
        msg = ((await res.json()) as { message?: string }).message ?? '';
      } catch {
        /* 非 JSON 响应 */
      }
      throw new GitHubError(res.status, explain(res.status, msg));
    }
    return (await res.json()) as T;
  }

  getRepo = () => this.req<RepoInfo>('GET', '');

  /** 分支不存在或仓库为空时返回 null */
  async getHead(branch: string): Promise<string | null> {
    try {
      const r = await this.req<{ object: { sha: string } }>('GET', `/git/ref/heads/${encodeURIComponent(branch)}`);
      return r.object.sha;
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 404 || e.status === 409)) return null;
      throw e;
    }
  }

  getCommitTree = async (sha: string) => (await this.req<{ tree: { sha: string } }>('GET', `/git/commits/${sha}`)).tree.sha;

  getTreeRecursive = (sha: string) =>
    this.req<{ tree: TreeEntry[]; truncated: boolean }>('GET', `/git/trees/${sha}?recursive=1`);

  async getBlobBytes(sha: string): Promise<Uint8Array> {
    const b = await this.req<{ content: string; encoding: string }>('GET', `/git/blobs/${sha}`);
    return b.encoding === 'base64' ? base64ToBytes(b.content) : new TextEncoder().encode(b.content);
  }

  async getBlobText(sha: string): Promise<string> {
    return new TextDecoder().decode(await this.getBlobBytes(sha));
  }

  /** 上传一个二进制文件（.json.gz），返回 blob SHA */
  createBlob = async (bytes: Uint8Array) =>
    (await this.req<{ sha: string }>('POST', '/git/blobs', { content: bytesToBase64(bytes), encoding: 'base64' })).sha;

  /** sha 为 null 表示删掉这个路径（迁移时删旧的 .json） */
  createTree = (baseTree: string, entries: Array<{ path: string; sha: string | null }>) =>
    this.req<{ sha: string }>('POST', '/git/trees', {
      base_tree: baseTree,
      tree: entries.map((f) => ({ path: f.path, mode: '100644', type: 'blob', sha: f.sha })),
    });

  createCommit = (message: string, tree: string, parents: string[]) =>
    this.req<{ sha: string }>('POST', '/git/commits', { message, tree, parents });

  /** 非快进时 GitHub 返回 422，调用方据此重试 */
  updateRef = (branch: string, sha: string) =>
    this.req<unknown>('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha, force: false });

  /** 只在空仓库初始化时用：Git Data API 无法在没有任何提交的仓库上工作 */
  putFile = (path: string, content: Uint8Array, message: string, branch: string) =>
    this.req<{ commit: { sha: string } }>('PUT', `/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      message,
      content: bytesToBase64(content),
      branch,
    });
}
