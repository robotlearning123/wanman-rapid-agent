# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-05-14

### Added

- Idempotent triage — `skipLabeled` config (default: true) skips issues that already have a `priority:P*` label
- `hasPriorityLabel()` helper in responder for detecting existing priority labels
- `validateConfig()` — startup validation for `GITHUB_TOKEN`, `GOOGLE_CLOUD_PROJECT`, and `GOOGLE_APPLICATION_CREDENTIALS`; collects all missing vars before throwing for a clear single error message
- Concurrent issue classification with configurable concurrency (`CONCURRENCY` env var, default 3, max 20); zero-dependency worker pool with per-issue error isolation
- 31 new tests across triage, config validation, and responder modules (175 total)

### Fixed

- Comment template in `buildComment()` now uses actual repo URL via `GITHUB_REPOSITORY` env var instead of hardcoded `your-org` placeholder
- `buildComment()` accepts optional `{ repo }` parameter for dynamic link generation

### Project Stats

| Metric | Value |
|--------|-------|
| Source files | 9 |
| Test files | 11 |
| Tests | 175 (all passing) |
| Dependencies | 3 (`@octokit/rest`, `@google-cloud/storage`, `google-auth-library`) |
| Dev dependencies | 3 (`c8`, `eslint`, `eslint-plugin-n`) |
| CI | GitHub Actions (Node 18, 20), plus local lint gate |

## [0.1.1] - 2026-05-13

### Added

- `withRetry` utility — exponential backoff with configurable delays, custom retry predicate, and retry event callback
- `StorageTool` — Cloud Storage run-report sink; writes JSON triage reports to GCS when `GCS_BUCKET` is configured
- `google-auth-library` and `@google-cloud/storage` production dependencies for GCS persistence
- Retry/backoff integration in `FetcherTool`, `ClassifierTool`, and `TriageAgent` for resilient API calls
- `GCS_BUCKET` and `GCS_PREFIX` configuration for Cloud Storage output
- ESLint 9 flat config with `npm run lint` and `npm run lint:fix`
- 8 new tests for retry utility and storage tool; expanded triage/classifier/fetcher coverage

### Changed

- README.md updated with retry and GCS storage documentation
- HACKATHON.md updated with v0.1.1 feature checklist
- Existing unused-symbol lint warnings cleaned up so the lint gate is warning-free

### Project Stats

| Metric | Value |
|--------|-------|
| Source files | 9 |
| Test files | 10 |
| Tests | 148 (all passing) |
| Dependencies | 3 (`@octokit/rest`, `@google-cloud/storage`, `google-auth-library`) |
| Dev dependencies | 3 (`c8`, `eslint`, `eslint-plugin-n`) |
| CI | GitHub Actions (Node 18, 20), plus local lint gate |

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

[0.1.2]: https://github.com/robotlearning123/wanman-rapid-agent/releases/tag/v0.1.2
[0.1.1]: https://github.com/robotlearning123/wanman-rapid-agent/releases/tag/v0.1.1
[0.1.0]: https://github.com/robotlearning123/wanman-rapid-agent/releases/tag/v0.1.0
