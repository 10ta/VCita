// GitHub REST API 的最小封装：只用 Git Data API（ref / commit / tree / blob）和一次 Contents API（空仓库初始化）。
// 浏览器直连 api.github.com，令牌只存在本机，不经过任何服务器。

const API = 'https://api.github.com';

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
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${API}/repos/${this.owner}/${this.repo}${path}`, {
        method,
        cache: 'no-store', // 避免拿到浏览器缓存的旧 ref，导致反复冲突
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError(0, '连接不上 GitHub（api.github.com），请检查网络。');
    }
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

  async getBlobText(sha: string): Promise<string> {
    const b = await this.req<{ content: string; encoding: string }>('GET', `/git/blobs/${sha}`);
    return b.encoding === 'base64' ? base64ToUtf8(b.content) : b.content;
  }

  createTree = (baseTree: string, files: Array<{ path: string; content: string }>) =>
    this.req<{ sha: string }>('POST', '/git/trees', {
      base_tree: baseTree,
      tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
    });

  createCommit = (message: string, tree: string, parents: string[]) =>
    this.req<{ sha: string }>('POST', '/git/commits', { message, tree, parents });

  /** 非快进时 GitHub 返回 422，调用方据此重试 */
  updateRef = (branch: string, sha: string) =>
    this.req<unknown>('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha, force: false });

  /** 只在空仓库初始化时用：Git Data API 无法在没有任何提交的仓库上工作 */
  putFile = (path: string, content: string, message: string, branch: string) =>
    this.req<{ commit: { sha: string } }>('PUT', `/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      message,
      content: utf8ToBase64(content),
      branch,
    });
}
