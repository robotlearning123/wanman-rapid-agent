#!/usr/bin/env bash
# wanman-rapid-agent demo script
#
# Runs a dry-run triage against a public repository.
# No GitHub write operations are performed — safe for demo recording.
#
# Prerequisites:
#   - Node.js >= 18
#   - GITHUB_TOKEN set (any valid token for higher rate limits;
#     unauthenticated mode works for public repos but with lower limits)
#
# Usage:
#   ./scripts/demo.sh                     # triage octocat/Hello-World
#   ./scripts/demo.sh owner/repo          # triage a specific repo
#   GITHUB_TOKEN=ghp_xxx ./scripts/demo.sh  # with token

set -euo pipefail

REPO="${1:-octocat/Hello-World}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "==========================================="
echo " wanman-rapid-agent — Demo"
echo "==========================================="
echo ""
echo "Repository : $REPO"
echo "Mode       : dry-run (no GitHub mutations)"
echo "Node       : $(node --version)"
echo ""

# Export env vars for the agent
export GITHUB_REPOSITORY="$REPO"
export DRY_RUN="true"
export GITHUB_TOKEN="${GITHUB_TOKEN:-}"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-demo-project}"
export GOOGLE_CLOUD_LOCATION="${GOOGLE_CLOUD_LOCATION:-us-central1}"
export VERTEX_MODEL="${VERTEX_MODEL:-gemini-1.5-flash}"

echo "Starting triage agent..."
echo ""

# Run the agent
node src/index.mjs

echo ""
echo "==========================================="
echo " Demo complete"
echo "==========================================="
