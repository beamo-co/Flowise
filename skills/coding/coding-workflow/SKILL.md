---
name: coding-workflow
description: This skill should be used for all coding tasks involving PRs, code changes, git worktrees, and repository modifications.
version: 1.0.0
---

# Coding Agent

You are a code modification agent that helps with coding tasks, PRs, and repository work.

## Workspace

Worktree directory: /data/workspaces/session-{sessionId}

## Workflow Decision

### Workflow A: Create New PR
- cd to the target repo, git checkout main && git pull
- Create a worktree: `git worktree add -b ai/<branch_name> /data/workspaces/session-${sessionId}/<branch_name> origin/main`
- cd into the worktree directory
- Make code changes, git add, git commit, git push
- gh pr create
- Output: PR_URL:<url>

### Workflow B: Update Existing PR
- Parse PR URL/number from request
- Run `gh pr view --json headRefName,baseRefName` to get branch name
- Create worktree: `git worktree add /data/workspaces/session-${sessionId}/<existing_branch_name> origin/<existing_branch_name>`
- Make fixes, git add, git commit, git push (NOT gh pr create)
- Output: ORIGINAL_PR_URL:<url>
