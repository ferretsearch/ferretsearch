import { extname, basename } from 'node:path'
import { Octokit } from '@octokit/rest'
import type { GitHubFile, GitHubIssue, GitHubPR, GitHubRepo } from './types.js'

const RATE_LIMIT_DELAY_MS = 200
const RATE_LIMIT_THRESHOLD = 10
const MAX_CONTENT_BYTES = 100 * 1024
const FILE_BATCH_SIZE = 10

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type RateLimitHeaders = { [key: string]: string | number | undefined }

export class GitHubClient {
  private readonly octokit: Octokit

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token })
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.octokit.rest.users.getAuthenticated()
      return true
    } catch {
      return false
    }
  }

  async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    const { data } = await this.octokit.rest.repos.get({ owner, repo })
    const r = data as {
      full_name?: string
      default_branch?: string
      private?: boolean
      description?: string | null
    }
    return {
      fullName: r.full_name ?? `${owner}/${repo}`,
      defaultBranch: r.default_branch ?? 'main',
      private: r.private ?? false,
      description: r.description ?? null,
    }
  }

  async getReadme(owner: string, repo: string): Promise<string> {
    try {
      const { data } = await this.octokit.rest.repos.getReadme({ owner, repo })
      const d = data as { content?: string; encoding?: string }
      if (d.encoding === 'base64' && d.content) {
        return Buffer.from(d.content.replace(/\n/g, ''), 'base64').toString('utf-8')
      }
      return ''
    } catch {
      return ''
    }
  }

  async *getIssues(owner: string, repo: string): AsyncGenerator<GitHubIssue[]> {
    for await (const response of this.octokit.paginate.iterator(
      this.octokit.rest.issues.listForRepo,
      { owner, repo, state: 'all', per_page: 100 },
    )) {
      await this.handleRateLimit(response.headers as RateLimitHeaders)

      const rawIssues = (response.data as unknown[]).filter((item) => {
        const i = item as { pull_request?: unknown }
        return i.pull_request === undefined
      })

      const issues: GitHubIssue[] = []
      for (const item of rawIssues) {
        const i = item as {
          id?: number
          number?: number
          title?: string
          body?: string | null
          state?: string
          html_url?: string
          user?: { login?: string } | null
          created_at?: string
          updated_at?: string
          labels?: Array<{ name?: string | null } | string>
        }
        const issueNumber = i.number ?? 0
        const comments = await this.fetchIssueComments(owner, repo, issueNumber)

        issues.push({
          id: i.id ?? 0,
          number: issueNumber,
          title: i.title ?? '',
          body: i.body ?? null,
          state: i.state === 'open' ? 'open' : 'closed',
          htmlUrl: i.html_url ?? '',
          user: i.user?.login ?? null,
          createdAt: i.created_at ?? new Date().toISOString(),
          updatedAt: i.updated_at ?? new Date().toISOString(),
          labels: (i.labels ?? [])
            .map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
            .filter(Boolean),
          comments,
        })
      }

      yield issues
    }
  }

  async *getPRs(owner: string, repo: string): AsyncGenerator<GitHubPR[]> {
    for await (const response of this.octokit.paginate.iterator(
      this.octokit.rest.pulls.list,
      { owner, repo, state: 'all', per_page: 100 },
    )) {
      await this.handleRateLimit(response.headers as RateLimitHeaders)

      const prs: GitHubPR[] = []
      for (const item of response.data as unknown[]) {
        const p = item as {
          id?: number
          number?: number
          title?: string
          body?: string | null
          state?: string
          html_url?: string
          user?: { login?: string } | null
          created_at?: string
          updated_at?: string
          merged_at?: string | null
          labels?: Array<{ name?: string | null } | string>
          base?: { ref?: string }
          head?: { ref?: string }
        }
        const prNumber = p.number ?? 0
        const mergedAt = p.merged_at ?? null
        const state: 'open' | 'closed' | 'merged' =
          mergedAt !== null ? 'merged' : p.state === 'open' ? 'open' : 'closed'

        const reviewComments = await this.fetchPRReviewComments(owner, repo, prNumber)

        prs.push({
          id: p.id ?? 0,
          number: prNumber,
          title: p.title ?? '',
          body: p.body ?? null,
          state,
          htmlUrl: p.html_url ?? '',
          user: p.user?.login ?? null,
          createdAt: p.created_at ?? new Date().toISOString(),
          updatedAt: p.updated_at ?? new Date().toISOString(),
          mergedAt,
          labels: (p.labels ?? [])
            .map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
            .filter(Boolean),
          baseBranch: p.base?.ref ?? '',
          headBranch: p.head?.ref ?? '',
          reviewComments,
        })
      }

      yield prs
    }
  }

  async *getFiles(
    owner: string,
    repo: string,
    extensions: string[],
  ): AsyncGenerator<GitHubFile[]> {
    let defaultBranch: string
    try {
      const repo_ = await this.getRepo(owner, repo)
      defaultBranch = repo_.defaultBranch
    } catch {
      return
    }

    let treeItems: Array<{ path?: string; type?: string; sha?: string }>
    try {
      const { data } = await this.octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: defaultBranch,
        recursive: '1',
      })
      treeItems = data.tree as typeof treeItems
    } catch {
      return
    }

    const matching = treeItems.filter((item) => {
      if (item.type !== 'blob' || !item.path || !item.sha) return false
      const ext = extname(item.path)
      return extensions.includes(ext)
    })

    for (let i = 0; i < matching.length; i += FILE_BATCH_SIZE) {
      const batch = matching.slice(i, i + FILE_BATCH_SIZE)
      const files: GitHubFile[] = []

      for (const fileItem of batch) {
        if (!fileItem.path || !fileItem.sha) continue
        try {
          const { data: blob } = await this.octokit.rest.git.getBlob({
            owner,
            repo,
            file_sha: fileItem.sha,
          })
          const b = blob as { content?: string; encoding?: string }
          const rawContent =
            b.encoding === 'base64' && b.content
              ? Buffer.from(b.content.replace(/\n/g, ''), 'base64').toString('utf-8')
              : ''
          const content =
            Buffer.byteLength(rawContent, 'utf-8') > MAX_CONTENT_BYTES
              ? rawContent.slice(0, MAX_CONTENT_BYTES)
              : rawContent

          files.push({
            path: fileItem.path,
            name: basename(fileItem.path),
            content,
            extension: extname(fileItem.path),
            sha: fileItem.sha,
          })
        } catch {
          // skip unreadable files
        }
        await sleep(RATE_LIMIT_DELAY_MS)
      }

      if (files.length > 0) yield files
    }
  }

  async getWiki(owner: string, repo: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.git.getTree({
        owner,
        repo: `${repo}.wiki`,
        tree_sha: 'HEAD',
      })
      const t = data as { tree?: Array<{ path?: string; sha?: string; type?: string }> }
      const homeFile = (t.tree ?? []).find(
        (f) => f.type === 'blob' && (f.path === 'Home.md' || f.path === 'home.md'),
      )
      if (!homeFile?.sha) return null

      const { data: blob } = await this.octokit.rest.git.getBlob({
        owner,
        repo: `${repo}.wiki`,
        file_sha: homeFile.sha,
      })
      const b = blob as { content?: string; encoding?: string }
      if (!b.content || b.encoding !== 'base64') return null
      return Buffer.from(b.content.replace(/\n/g, ''), 'base64').toString('utf-8')
    } catch {
      return null
    }
  }

  private async fetchIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<string[]> {
    try {
      const { data } = await this.octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100,
      })
      return (data as unknown[])
        .map((c) => ((c as { body?: string | null }).body ?? ''))
        .filter(Boolean)
    } catch {
      return []
    }
  }

  private async fetchPRReviewComments(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<string[]> {
    try {
      const { data } = await this.octokit.rest.pulls.listReviewComments({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      })
      return (data as unknown[])
        .map((c) => ((c as { body?: string | null }).body ?? ''))
        .filter(Boolean)
    } catch {
      return []
    }
  }

  private async handleRateLimit(headers: RateLimitHeaders): Promise<void> {
    const raw = headers['x-ratelimit-remaining']
    const remaining = raw !== undefined ? Number(raw) : 100
    if (remaining < RATE_LIMIT_THRESHOLD) {
      const resetRaw = headers['x-ratelimit-reset']
      const resetAt = resetRaw !== undefined ? Number(resetRaw) * 1000 : 0
      const waitMs = Math.max(1000, resetAt - Date.now() + 1000)
      await sleep(waitMs)
    }
  }
}
