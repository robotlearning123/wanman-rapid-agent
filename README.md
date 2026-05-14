# wanman-rapid-agent

Autonomous multi-agent system that triages GitHub issues using Google Cloud Vertex AI. Built for the [Google Cloud Rapid Agent Hackathon](https://rapid-agent.devpost.com/).

## What It Does

wanman-rapid-agent connects to a GitHub repository, fetches open issues, classifies them by priority / area / severity using Vertex AI, and applies labels automatically. It supports three modes: standalone CLI, GitHub Action (scheduled or event-driven), and real-time webhook server. When `GCS_BUCKET` is configured, each run also writes a JSON report to Google Cloud Storage for auditability and demo evidence.

## Architecture

```
                          ┌──────────────────┐
                          │   GitHub API     │
                          │  (Octokit REST)  │
                          └────────┬─────────┘
                                   │ fetch issues / apply labels
                                   ▼
┌──────────┐    ┌──────────────────────────────┐    ┌─────────────────┐
│  CLI /   │───▶│       TriageAgent            │───▶│  Vertex AI      │
│  GitHub  │    │  (orchestration + workflow)   │    │  (classify +    │
│  Action  │    │                              │    │   summarize)    │
└──────────┘    └──────────────────────────────┘    └─────────────────┘
       ▲                   │
       │          ┌────────┼────────┬────────┐
       │          ▼        ▼        ▼        ▼
       │     ┌────────┐┌────────┐┌──────────┐┌───────────────┐
       │     │ Fetcher ││Classifier││Responder ││ Cloud Storage │
       │     │ Tool    ││ Tool     ││ Tool     ││ Report Sink   │
       │     └─────────┘└──────────┘└──────────┘└───────────────┘
       │
┌──────┴──────────┐
│  Webhook Server │  ← real-time triage on issue events
│  (HMAC verify)  │
└─────────────────┘
```

### Directory Layout

```
src/
  index.mjs            Entry point — CLI bootstrap
  webhook.mjs          GitHub webhook handler — HMAC verification + real-time triage
  agents/
    base.mjs           AgentBase — abstract state machine, events, error handling
    triage.mjs         TriageAgent — main orchestration loop
  tools/
    fetcher.mjs        GitHub issue fetcher (Octokit)
    classifier.mjs     Vertex AI classification (priority/area/severity)
    responder.mjs      Auto-label and comment on issues
    storage.mjs        Cloud Storage run-report persistence
  utils/
    logger.mjs         Structured JSON logger (stderr)
    retry.mjs          Exponential backoff helper
test/
  *.test.mjs           Node.js test runner suite (257 tests)
```

### Agent Flow

1. **Fetch** — Pull open issues from the target GitHub repository via Octokit, with retry for transient failures and rate limit awareness
2. **Classify** — Send each issue body + title to Vertex AI for structured classification, with retry for transient failures. Input is sanitized to strip control characters and prevent token inflation.
3. **Respond** — Apply priority/area/severity labels; post a triage summary comment
4. **Report** — Log results, optionally persist a JSON run report to Google Cloud Storage, and exit with appropriate status code

## Prerequisites

- **Node.js** 18+ (ESM support required)
- **Google Cloud account** with Vertex AI API and Cloud Storage API enabled
- **GitHub Personal Access Token** with `repo` scope (or `public_repo` for public repos)
- **npm** for dependency management

## Google Cloud Setup

### 1. Create a GCP Project

```bash
export PROJECT_ID="your-project-id"
gcloud projects create $PROJECT_ID
gcloud config set project $PROJECT_ID
```

### 2. Enable APIs

```bash
gcloud services enable aiplatform.googleapis.com
gcloud services enable cloudresourcemanager.googleapis.com
gcloud services enable storage.googleapis.com
```

### 3. Create a Service Account

```bash
export SA_NAME="rapid-agent-sa"
gcloud iam service-accounts create $SA_NAME \
  --display-name="Rapid Agent Service Account"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/storage.objectCreator"
```

### 4. Generate a Key File

```bash
gcloud iam service-accounts keys create ./gcp-key.json \
  --iam-account="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
```

> **Important:** Never commit `gcp-key.json` to version control. It is already listed in `.gitignore`.

### 5. Configure Environment Variables

```bash
export GOOGLE_CLOUD_PROJECT="your-project-id"
export GOOGLE_APPLICATION_CREDENTIALS="./gcp-key.json"
export GOOGLE_CLOUD_LOCATION="us-central1"  # or your preferred region
```

## Installation

```bash
git clone https://github.com/robotlearning123/wanman-rapid-agent.git
cd wanman-rapid-agent
npm install
```

## Configuration

All configuration is via environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | Yes | — | GitHub PAT with repo access |
| `GITHUB_REPOSITORY` | No | `example/repo` | Target repo(s) — comma-separated for multi-repo (`org/r1,org/r2`) |
| `GOOGLE_CLOUD_PROJECT` | Yes | — | GCP project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | Yes | — | Path to service account key JSON |
| `GOOGLE_CLOUD_LOCATION` | No | `us-central1` | Vertex AI region |
| `GCS_BUCKET` | No | — | Cloud Storage bucket for run-report JSON artifacts |
| `GCS_PREFIX` | No | `triage-runs` | Cloud Storage object prefix for run reports |
| `VERTEX_MODEL` | No | `gemini-1.5-flash` | Vertex AI model name for classification |
| `DRY_RUN` | No | `true` | Set to `false` to apply labels and post comments |
| `CONCURRENCY` | No | `3` | Max parallel issue classifications (1–20) |
| `RATE_LIMIT_THRESHOLD` | No | `100` | GitHub API remaining requests threshold to trigger throttling |
| `RATE_LIMIT_DELAY_MS` | No | `1000` | Delay (ms) when rate limit threshold is reached |
| `WEBHOOK_SECRET` | No | — | GitHub webhook secret for HMAC-SHA256 signature verification |

## Usage

### CLI (dry run — labels are printed but not applied)

```bash
export GITHUB_TOKEN="ghp_..."
export GITHUB_REPOSITORY="myorg/myrepo"
export GOOGLE_CLOUD_PROJECT="my-project"
export GOOGLE_APPLICATION_CREDENTIALS="./gcp-key.json"
export DRY_RUN="true"

npm start
```

### CLI (live mode)

```bash
export DRY_RUN="false"
npm start
```

### GitHub Action

```yaml
name: Issue Triage
on:
  issues:
    types: [opened, edited]
  schedule:
    - cron: '0 */6 * * *'  # every 6 hours

jobs:
  triage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm start
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          GOOGLE_CLOUD_PROJECT: ${{ secrets.GOOGLE_CLOUD_PROJECT }}
          GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.GCP_KEY_JSON }}
          GOOGLE_CLOUD_LOCATION: us-central1
          DRY_RUN: "false"
```

### Webhook Server (real-time triage)

For real-time triage on issue events, run the webhook server:

```js
import { startWebhookServer } from './src/webhook.mjs';

const triageConfig = {
  repo: 'myorg/myrepo',
  token: process.env.GITHUB_TOKEN,
  gcpProject: process.env.GOOGLE_CLOUD_PROJECT,
  dryRun: false,
};

startWebhookServer({
  port: 3000,
  secret: process.env.WEBHOOK_SECRET,
  triageConfig,
});
```

Or use `createWebhookHandler()` to integrate with any Node.js HTTP server (Express, Fastify, etc.):

```js
import { createWebhookHandler } from './src/webhook.mjs';

const handler = createWebhookHandler({ secret, triageConfig });
// handler.handleRequest(req, res) processes incoming webhooks
```

Configure the webhook in your GitHub repo settings:
1. **Payload URL**: `http://your-server:3000/`
2. **Content type**: `application/json`
3. **Secret**: the value of `WEBHOOK_SECRET`
4. **Events**: Issues

The handler validates HMAC-SHA256 signatures with constant-time comparison, filters for `issues.opened` and `issues.edited` events, and dispatches through the same TriageAgent pipeline.

## Testing

```bash
npm test
npm run lint
```

The test suite uses the [Node.js built-in test runner](https://nodejs.org/api/test.html) (`node --test`) and covers:

- Agent core: TriageAgent initialization and run lifecycle
- Classifier: Vertex AI response parsing and label mapping
- Fetcher: GitHub API pagination and error handling
- Storage: Cloud Storage run-report persistence
- Retry: exponential backoff behavior for transient failures
- Logger: structured output format
- Integration: end-to-end dry-run flow
- Webhook: HMAC signature verification, event filtering, payload extraction, HTTP response paths

## How It Uses Google Cloud

wanman-rapid-agent calls the **Vertex AI API** to classify GitHub issues:

- **Model**: Gemini (configured via `VERTEX_MODEL`; defaults to `gemini-1.5-flash`)
- **Input**: Issue title + body + labels
- **Output**: Structured JSON with `priority` (P0–P4), `area` (bug/feature/docs/infra), and `severity` (critical/major/minor)
- **Auth**: Service account key via `GOOGLE_APPLICATION_CREDENTIALS`

It also uses the **Google Cloud Storage SDK** when `GCS_BUCKET` is set:

- **Bucket**: `GCS_BUCKET`
- **Object path**: `${GCS_PREFIX}/<owner-repo>/<timestamp>.json`
- **Payload**: run configuration, total/classified/labeled/commented/error counts, per-issue details, and persistence metadata

The system is designed so the AI layer is swappable — replace the classifier tool to use a different model or provider without changing the agent orchestration.

## Built With

- **Runtime**: Node.js 18+ (ESM)
- **GitHub Integration**: [Octokit](https://github.com/octokit/octokit.js)
- **AI**: Google Cloud Vertex AI
- **Testing**: [Node.js test runner](https://nodejs.org/api/test.html) (built-in, zero dependencies)
- **Linting**: ESLint 9 flat config
- **Agent Orchestration**: wanman agent matrix (CEO + dev + devops agents)

## License

MIT
