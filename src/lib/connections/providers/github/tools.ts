import type { ConnectionToolDefinition, ConnectionCallResult } from '../../types';

const API = 'https://api.github.com';
const TOKEN_KEY = 'GITHUB_TOKEN';

function ok(output: string, details?: Record<string, unknown>): ConnectionCallResult {
  return { success: true, output, details };
}
function err(error: string): ConnectionCallResult {
  return { success: false, output: '', error };
}

async function ghFetch(path: string, token: string, init?: RequestInit): Promise<ConnectionCallResult> {
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    if (!res.ok) return err(`github_${res.status}: ${text.slice(0, 300)}`);
    return ok(text);
  } catch (e) {
    return err(`github_request_failed: ${String(e)}`);
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const githubTools: ConnectionToolDefinition[] = [
  {
    name: 'github.read_file',
    description: 'Read a file from a repo (owner, repo, path, ref?).',
    risk: 'external_read',
    async run(args, secrets) {
      const token = secrets[TOKEN_KEY];
      const { owner, repo, path } = args as Record<string, string>;
      if (!token) return ok(`[mock] github.read_file ${owner}/${repo}:${path}\n# ${repo}\nMock README content for ${owner}/${repo}.`, { mock: true });
      const ref = args.ref ? `?ref=${encodeURIComponent(str(args.ref))}` : '';
      const r = await ghFetch(`/repos/${owner}/${repo}/contents/${path}${ref}`, token);
      if (!r.success) return r;
      try {
        const data = JSON.parse(r.output) as { content?: string; encoding?: string };
        if (data.content && data.encoding === 'base64') {
          return ok(atob(data.content.replace(/\n/g, '')));
        }
      } catch { /* fall through */ }
      return r;
    },
  },
  {
    name: 'github.search_repos',
    description: 'Search repositories (q).',
    risk: 'external_read',
    async run(args, secrets) {
      const token = secrets[TOKEN_KEY];
      const q = str(args.q ?? args.query);
      if (!token) return ok(`[mock] github.search_repos "${q}" → 1 result: example/${q || 'repo'}`, { mock: true });
      return ghFetch(`/search/repositories?q=${encodeURIComponent(q)}`, token);
    },
  },
  {
    name: 'github.list_issues',
    description: 'List issues for a repo (owner, repo, state?).',
    risk: 'external_read',
    async run(args, secrets) {
      const token = secrets[TOKEN_KEY];
      const { owner, repo } = args as Record<string, string>;
      if (!token) return ok(`[mock] github.list_issues ${owner}/${repo} → #1 Example issue (open)`, { mock: true });
      const state = str(args.state) || 'open';
      return ghFetch(`/repos/${owner}/${repo}/issues?state=${state}`, token);
    },
  },
  {
    name: 'github.write_file',
    description: 'Create/update a file (owner, repo, path, content, message, branch?, sha?).',
    risk: 'external_write',
    async run(args, secrets) {
      const token = secrets[TOKEN_KEY];
      const { owner, repo, path } = args as Record<string, string>;
      if (!token) return ok(`[mock] github.write_file ${owner}/${repo}:${path} (would commit)`, { mock: true });
      const body = JSON.stringify({
        message: str(args.message) || `Update ${path}`,
        content: btoa(str(args.content)),
        branch: args.branch ? str(args.branch) : undefined,
        sha: args.sha ? str(args.sha) : undefined,
      });
      return ghFetch(`/repos/${owner}/${repo}/contents/${path}`, token, { method: 'PUT', body });
    },
  },
  {
    name: 'github.create_branch',
    description: 'Create a branch (owner, repo, branch, from_sha).',
    risk: 'external_write',
    async run(args, secrets) {
      const token = secrets[TOKEN_KEY];
      const { owner, repo } = args as Record<string, string>;
      if (!token) return ok(`[mock] github.create_branch ${owner}/${repo}:${str(args.branch)}`, { mock: true });
      const body = JSON.stringify({ ref: `refs/heads/${str(args.branch)}`, sha: str(args.from_sha) });
      return ghFetch(`/repos/${owner}/${repo}/git/refs`, token, { method: 'POST', body });
    },
  },
  {
    name: 'github.open_pr',
    description: 'Open a pull request (owner, repo, title, head, base, body?).',
    risk: 'external_write',
    async run(args, secrets) {
      const token = secrets[TOKEN_KEY];
      const { owner, repo } = args as Record<string, string>;
      if (!token) return ok(`[mock] github.open_pr ${owner}/${repo}: "${str(args.title)}" ${str(args.head)}→${str(args.base)}`, { mock: true });
      const body = JSON.stringify({ title: str(args.title), head: str(args.head), base: str(args.base), body: str(args.body) });
      return ghFetch(`/repos/${owner}/${repo}/pulls`, token, { method: 'POST', body });
    },
  },
  {
    name: 'github.comment_issue',
    description: 'Comment on an issue/PR (owner, repo, number, body).',
    risk: 'external_write',
    async run(args, secrets) {
      const token = secrets[TOKEN_KEY];
      const { owner, repo } = args as Record<string, string>;
      if (!token) return ok(`[mock] github.comment_issue ${owner}/${repo}#${str(args.number)}`, { mock: true });
      const body = JSON.stringify({ body: str(args.body) });
      return ghFetch(`/repos/${owner}/${repo}/issues/${str(args.number)}/comments`, token, { method: 'POST', body });
    },
  },
];
