# Create PR - Coding Skill

## Overview

This skill guides the coding agent on how to create a Pull Request.

## Prerequisites

- All tests passing
- Code follows project conventions
- Documentation updated if needed

## Steps

### 1. Check Branch Status

```bash
git status
git log --oneline -5
```

### 2. Review Changes

```bash
git diff main
```

### 3. Push Branch

```bash
git push -u origin feature/your-branch-name
```

### 4. Create PR

When creating a PR:
- Use descriptive title
- Explain what changes were made
- Link to any related issues
- Include test results

### 5. PR Template

```markdown
## Summary
[Brief description of changes]

## Test Plan
[How to test these changes]

## Checklist
- [ ] Tests pass
- [ ] Code follows style guidelines
- [ ] Documentation updated
```
