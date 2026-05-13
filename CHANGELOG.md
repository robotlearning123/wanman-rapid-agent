# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-13

### Added

- Multi-agent GitHub issue triage system using Google Cloud Vertex AI
- `TriageAgent` orchestration loop with lifecycle states (idle -> initialized -> running -> stopped/errored)
- `AgentBase` abstract class providing state machine, event emission, and error handling for all agents
- `FetcherTool` — pulls open GitHub issues via Octokit with pagination and DI support
- `ClassifierTool` — sends issues to Vertex AI Gemini for structured classification (priority P0-P4, area, severity)
- `ResponderTool` — applies labels and posts triage summary comments on GitHub issues
- `Logger` utility — structured JSON output to stderr with configurable log levels
- CLI entry point (`src/index.mjs`) with dry-run safety mode (default: labels are logged but not applied)
- GitHub Actions CI workflow (Node 18/20 matrix)
- GitHub Actions workflow example for automated issue triage on schedule
- `.env.example` with all required environment variables documented
- Demo recording (`docs/demo.txt`) — dry-run pipeline against octocat/Hello-World
- Test suite using Node.js built-in test runner — 125 tests, all passing
- Dependency injection seams in tools for testable agent orchestration

### Project Stats

| Metric | Value |
|--------|-------|
| Source files | 7 |
| Test files | 8 |
| Tests | 125 (all passing) |
| Dependencies | 1 (`@octokit/rest`) |
| Dev dependencies | 1 (`c8`) |
| CI | GitHub Actions (Node 18, 20) |

[0.1.0]: https://github.com/robotlearning123/wanman-rapid-agent/releases/tag/v0.1.0
