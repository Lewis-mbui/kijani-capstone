# Capstone Scope Document

## Problem Statement

KijaniKiosk currently lacks a controlled staging-to-production delivery workflow for `kk-payments`. The application can be built, containerized, and deployed to Kubernetes, but there is no isolated staging environment where the exact release image can be validated before production, no automated smoke-test gate, and no mandatory production approval step. Monitoring and the Week 10 serverless receipt workflow also operate separately from the deployment path. This capstone will create a reproducible staging environment and integrate container delivery, automated validation, human-controlled promotion, monitoring, and asynchronous receipt processing into one end-to-end workflow.

## Track

**Track A — Infrastructure-First**

## What I Will Build

- **Reproducible staging infrastructure:** Terraform will provision an isolated `kijani-staging` Kubernetes namespace, with Ansible managing environment-specific application configuration.
- **Container-based CI/CD pipeline:** Jenkins will build and test `kk-payments`, create a Docker image tagged using the `<semver>-<git-short-sha>` convention, push it to Docker Hub, and automatically deploy that image to staging.
- **Controlled production promotion:** Jenkins will validate the staging rollout with a smoke test and expose a human approval gate only after validation succeeds, after which the same immutable image will be promoted to production.
- **Multi-environment Kubernetes runtime and monitoring:** The same `kk-payments` Deployment definition will support staging and production using environment-specific configuration, while Prometheus will monitor at least one meaningful application health signal with a committed alert rule.
- **Integrated receipt processing and AI-assisted operations:** Staging `kk-payments` will emit receipt events into the Week 10 serverless receipt chain with structured, correlated logging, and AI-assisted operational analysis will be documented using the required human-review governance process.

## What Is Out of Scope

- **Managed cloud Kubernetes:** EKS or another managed Kubernetes platform will not be introduced because Track A can demonstrate the required multi-environment delivery workflow using local Minikube without adding unrelated cloud networking, IAM, and cost complexity.
- **Production high availability and disaster recovery:** Multi-region deployment, managed database failover, and cross-cluster disaster recovery are excluded because the capstone targets a production-approaching workflow rather than a customer-ready production platform.
- **Full observability and secrets-management platforms:** A complete Prometheus/Grafana/Loki/tracing stack and external secret-management systems such as Vault will not be introduced. The project will instead demonstrate one meaningful monitoring signal and use Kubernetes Secrets and Jenkins credentials to keep the scope focused on delivery automation and integration.

## Success Criteria

1. A merge to `main` causes Jenkins to build and push `lewis0648/kk-payments:<semver>-<git-short-sha>`, automatically deploy that exact image to `kijani-staging`, and successfully complete Kubernetes rollout validation and an HTTP smoke test without manual deployment commands.

2. The production approval gate is presented only after the staging rollout and smoke test succeed. After approval, Jenkins deploys the same immutable image to production and verifies the rollout. A deliberately broken staging deployment prevents production promotion.

3. A KijaniKiosk request can be traced using a correlation ID from `kk-payments` into the serverless receipt-processing workflow through structured logs, while Prometheus exposes the selected `kk-payments` health signal and can demonstrate its configured alert condition.

## Architecture Diagram

The architecture diagram will show the complete flow between GitHub, the local Jenkins CI/CD server, Docker Hub, the Minikube staging and production environments, Terraform, Ansible, Prometheus, `kk-payments`, the serverless receipt chain, and the governed AI-assisted operational analysis workflow.

All connections will identify the information or action crossing the boundary, including Git commits, Docker image pushes and pulls, Kubernetes deployments, HTTP smoke tests, approval-controlled promotion, metrics scraping, receipt/S3 events, structured logs, and AI-assisted incident analysis.
