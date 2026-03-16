# Use Worktree - Coding Skill

## Overview

This skill guides the coding agent on how to safely work with repositories using Git worktrees.

## When to Use

Use this skill when:
- Working on code changes that need to be isolated
- Creating a PR from a feature branch
- Working on multiple features simultaneously
- Need to run tests without affecting main branch

## Instructions

### Creating a Worktree

1. Always create a new worktree for each job/task
2. Use the workspace manager to create worktrees
3. Worktrees should be created under `/data/workspaces/job-{job-id}`

### Best Practices

- Never commit directly to main or master branch
- Create feature branches for all changes
- Keep worktrees clean - remove after use unless retention is requested
- Run tests in the worktree before creating PR

### Code Review Guidelines

- Review code changes thoroughly
- Check for:
  - Code quality and readability
  - Security vulnerabilities
  - Performance implications
  - Test coverage
- Provide constructive feedback
