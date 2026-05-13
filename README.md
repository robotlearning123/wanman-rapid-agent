# wanman-rapid-agent

Autonomous multi-agent system that triages GitHub issues using Google Cloud Vertex AI. Built for the [Google Cloud Rapid Agent Hackathon](https://rapid-agent.devpost.com/).

## What It Does

wanman-rapid-agent connects to a GitHub repository, fetches open issues, classifies them by priority / area / severity using Vertex AI, and applies labels automatically. It runs as a standalone CLI or as a GitHub Action. When `GCS_BUCKET` is configured, each run also writes a JSON report to Google Cloud Storage for auditability and demo evidence.

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
                          │
                 ┌────────┼────────┐
                 ▼        ▼        ▼
            ┌────────┐┌────────┐┌──────────┐
            │ Fetcher ││Classifier││Responder │
            │ Tool    ││ Tool     ││ Tool     │
            └─────────┘└──────────┘└──────────┘
```

### Directory Layout

```
src/
  index.mjs            Entry point — CLI bootstrap
  agents/
    triage.mjs         TriageAgent — main orchestration loop
  tools/
    fetcher.mjs        GitHub issue fetcher (Octokit)
    classifier.mjs     Vertex AI classification (priority/area/severity)
    responder.mjs      Auto-label and comment on issues
  utils/
    logger.mjs         Structured JSON logger (stderr)
test/
  *.test.mjs           Node.js test runner suite
```

### Agent Flow

1. **Fetch** — Pull open issues from the target GitHub repository via Octokit
2. **Classify** — Send each issue body + title to Vertex AI for structured classification
3. **Respond** — Apply priority/area/severity labels; post a triage summary comment
4. **Report** — Log results and exit with appropriate status code

## Prerequisites

- **Node.js** 18+ (ESM support required)
- **Google Cloud account** with Vertex AI API enabled
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
```

### 3. Create a Service Account

```bash
export SA_NAME="rapid-agent-sa"
gcloud iam service-accounts create $SA_NAME \
  --display-name="Rapid Agent Service Account"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
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
git clone https://github.com/your-org/wanman-rapid-agent.git
cd wanman-rapid-agent
npm install
```

## Configuration

All configuration is via environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | Yes | — | GitHub PAT with repo access |
| `GITHUB_REPOSITORY` | No | `example/repo` | Target repository (`owner/repo`) |
| `GOOGLE_CLOUD_PROJECT` | Yes | — | GCP project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | Yes | — | Path to service account key JSON |
| `GOOGLE_CLOUD_LOCATION` | No | `us-central1` | Vertex AI region |
| `GCS_BUCKET` | No | — | Cloud Storage bucket for run-report JSON artifacts |
| `GCS_PREFIX` | No | `triage-runs` | Cloud Storage object prefix for run reports |
| `DRY_RUN` | No | `true` | Set to `false` to apply labels and post comments |

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

## Testing

```bash
npm test
```

The test suite uses the [Node.js built-in test runner](https://nodejs.org/api/test.html) (`node --test`) and covers:

- Agent core: TriageAgent initialization and run lifecycle
- Classifier: Vertex AI response parsing and label mapping
- Fetcher: GitHub API pagination and error handling
- Logger: structured output format
- Integration: end-to-end dry-run flow

## How It Uses Google Cloud

wanman-rapid-agent calls the **Vertex AI API** to classify GitHub issues:

- **Model**: Gemini (configured via `GOOGLE_CLOUD_LOCATION`)
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
- **Agent Orchestration**: wanman agent matrix (CEO + dev + devops agents)

## License

MIT
