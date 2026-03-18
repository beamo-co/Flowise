#!/bin/bash
set -e

# Authenticate gh CLI with GH_TOKEN if provided
if [ -n "$GH_TOKEN" ]; then
    echo "$GH_TOKEN" | gh auth login --hostname github.com --token-stdin 2>/dev/null || true
    gh auth setup-git 2>/dev/null || true
fi

exec node dist/index.js
