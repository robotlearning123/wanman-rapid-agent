# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-13

### Added

- `withRetry()` utility (`src/utils/retry.mjs`) — exponential backoff for transient API failures
- Retry support in `FetcherTool` — transient GitHub API errors are retried up to 3 times
- Retry support in `ClassifierTool` — transient Vertex AI errors are retried up to 3 times
- `createRunStorage()` (`src/tools/storage.mjs`) — optional Google Cloud Storage run-report persistence
- GCS run reports: configure `GCS_BUCKET` and `GCS_PREFIX` to write JSON triage reports to Cloud Storage
- `@google-cloud/storage` and `google-auth-library` dependencies for GCS integration
- Test coverage expanded to 133 tests (all passing)

### Project Stats

| Metric | Value |
|--------|-------|
| Source files | 9 |
| Test files | 9 |
| Tests | 133 (all passing) |
| Dependencies | 3 (`@octokit/rest`, `@google-cloud/storage`, `google-auth-library`) |
| Dev dependencies | 1 (`c8`) |
| CI | GitHub Actions (Node 18, 20) |
| Line coverage | 99.64% |
| Branch coverage | 96.96% |

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

[0.2.0]: https://github.com/robotlearning123/wanman-rapid-agent/releases/tag/v0.2.0
[0.1.0]: https://github.com/robotlearning123/wanman-rapid-agent/releases/tag/v0.1.0
