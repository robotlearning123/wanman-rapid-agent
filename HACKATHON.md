# Google Cloud Rapid Agent Hackathon — Submission

**Project**: wanman-rapid-agent
**URL**: https://rapid-agent.devpost.com/
**Built with**: wanman agent matrix (autonomous CEO + dev + devops agents)

## What We Built

An autonomous multi-agent system that triages GitHub issues using Google Cloud Vertex AI. The system fetches open issues, classifies them by priority/area/severity via the Vertex AI Gemini model, and applies labels and summary comments automatically.

## Google Cloud Integration

- **Vertex AI API** — classifies issues using Gemini with structured JSON output
- **Cloud Storage API + SDK** — stores optional JSON run reports for audit trails and demo evidence
- **Service Account auth** — production-grade IAM with least-privilege roles
- **Region-configurable** — works in any Vertex AI region (default: us-central1)

## Devpost Submission Text

### Project Description

**wanman-rapid-agent** is an autonomous GitHub issue triage agent powered by Google Cloud Vertex AI. It watches a repository, fetches open issues, and uses Gemini to classify each one by priority (P0–P4), area (bug/feature/docs/infra), and severity (critical/major/minor). Labels and triage summary comments are applied automatically.

The system is built as a multi-agent pipeline: a Fetcher tool pulls issues via the GitHub API, a Classifier tool sends them to Vertex AI for structured analysis, and a Responder tool writes the results back to GitHub. The entire flow is orchestrated by a TriageAgent that handles batching, error recovery, and dry-run safety mode.

Built entirely by an autonomous agent matrix (wanman v0.4.0) — a CEO agent decomposes the project into tasks, dispatches dev and devops agents, and coordinates delivery without human coding.

### How We Used Google Cloud

We use the **Vertex AI API** to classify GitHub issues. Each issue (title + body) is sent to the Gemini model with a structured prompt that returns priority, area, and severity labels. Authentication uses a GCP service account with the `aiplatform.user` role. When `GCS_BUCKET` is configured, the app also uses the Google Cloud Storage SDK to save each run report as JSON under `GCS_PREFIX`, giving judges a durable audit artifact for the autonomous triage flow. The system is designed to be model-agnostic — the classifier tool can be swapped for any Vertex AI model without changing the orchestration layer.

### Setup Instructions

See [README.md](./README.md) for full setup, including GCP project creation, service account configuration, and environment variable reference.

### Demo

```bash
# Dry run (safe — no labels applied)
export GITHUB_TOKEN="ghp_..."
export GITHUB_REPOSITORY="myorg/myrepo"
export GOOGLE_CLOUD_PROJECT="my-project"
export GOOGLE_APPLICATION_CREDENTIALS="./gcp-key.json"
npm start

# Live mode
export DRY_RUN="false"
npm start
```

## Deliverables Checklist

- [x] Working multi-agent system with Google Cloud calls (Vertex AI + Cloud Storage SDK)
- [x] Cloud Storage SDK run-report artifact path
- [x] Real use case — autonomous GitHub issue triage
- [x] README with architecture diagram, setup, and usage guide
- [x] Test suite (node --test, 148 tests, all passing)
- [x] Devpost-ready submission writeup (this file)
- [x] Demo recording (docs/demo.txt)
