# KijaniKiosk Capstone

KijaniKiosk is an infrastructure-first DevOps capstone that integrates
reproducible Kubernetes environments, environment-specific
configuration, container-based CI/CD, staged release promotion,
Prometheus monitoring, asynchronous receipt processing, and governed
AI-assisted operations.

The central operational problem is the lack of a controlled
staging-to-production delivery path for `kk-payments`. The capstone
introduces an isolated staging environment, validates an immutable
application image there automatically, requires an explicit human
approval before production promotion, and promotes the exact same
artifact rather than rebuilding it.

## Track

**Track A --- Infrastructure-First**

The detailed scope and success criteria are documented in
[`docs/scope.md`](docs/scope.md).

## Table of Contents

- [Track](#track)
- [Architecture](#architecture)
- [Repository Structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
  - [1. Clone the repository](#1-clone-the-repository)
  - [2. Start Minikube](#2-start-minikube)
  - [3. Create the Python
    environment](#3-create-the-python-environment)
  - [4. Provision Kubernetes namespaces with
    Terraform](#4-provision-kubernetes-namespaces-with-terraform)
  - [5. Export Docker Hub credentials for
    Ansible](#5-export-docker-hub-credentials-for-ansible)
  - [6. Configure staging with
    Ansible](#6-configure-staging-with-ansible)
  - [7. Configure production with
    Ansible](#7-configure-production-with-ansible)
  - [8. Prepare Jenkins Kubernetes access and
    credentials](#8-prepare-jenkins-kubernetes-access-and-credentials)
  - [9. Configure the Jenkins Pipeline
    job](#9-configure-the-jenkins-pipeline-job)
  - [10. Configure automatic GitHub delivery
    triggering](#10-configure-automatic-github-delivery-triggering)
  - [10. Start the local receipt-processing
    subsystem](#10-start-the-local-receipt-processing-subsystem)
  - [11. Start the Minikube-to-host S3
    relay](#11-start-the-minikube-to-host-s3-relay)
  - [12. Deploy Prometheus
    monitoring](#12-deploy-prometheus-monitoring)
  - [13. Open Prometheus locally](#13-open-prometheus-locally)
  - [14. Verify application metrics](#14-verify-application-metrics)
  - [15. Verify the Prometheus alert
    lifecycle](#15-verify-the-prometheus-alert-lifecycle)
- [How to Verify the System](#how-to-verify-the-system)
- [Current Verified State](#current-verified-state)
- [Known Limitations](#known-limitations)

## Architecture

![KijaniKiosk Capstone Architecture](docs/architecture.png)

KijaniKiosk uses a local-first Track A architecture that integrates
infrastructure as code, configuration management, containerized CI/CD,
Kubernetes orchestration, asynchronous receipt processing, monitoring,
and governed AI-assisted engineering.

The delivery workflow begins in the separate `kijanikiosk-payments`
application repository. A push to `main` sends a GitHub webhook through
ngrok to the local Jenkins controller. Jenkins loads its pipeline
definition from the `kijani-capstone` repository, checks out the
application source, runs the containerized lint/test/build stages,
produces an immutable Docker image tagged using the application semantic
version and Git short SHA, and deploys it first to staging. After
rollout and health/version verification, production deployment is
protected by a manual approval gate. When approved, Jenkins promotes the
exact same immutable image to production without rebuilding it.

The implemented system maps to the capstone layers as follows:

- **Infrastructure layer --- Terraform:** provisions the
  `kijani-staging` and `kijani-project` Kubernetes namespaces.
- **Configuration layer --- Ansible:** configures each namespace with
  environment-specific `kk-payments` ConfigMaps and Docker Hub
  image-pull credentials.
- **Delivery layer --- Jenkins + Docker Hub:** checks out
  `kijani-capstone` and the separate `kijanikiosk-payments`
  application repository, runs linting/tests/builds in Docker, creates
  an immutable SemVer + Git SHA image, pushes or reuses that release
  in Docker Hub, deploys it automatically to staging, enforces rollout
  and smoke-test gates, pauses for human production approval, and
  promotes the same image to production.
- **Runtime layer --- Kubernetes on Minikube:** runs the shared
  `kk-payments` Deployment and Service definitions in staging and
  production, with environment differences supplied through ConfigMaps
  and release identity rendered by the pipeline.
- **Observability layer --- Prometheus:** runs in `kijani-staging`,
  discovers all staging `kk-payments` Pods through Kubernetes service
  discovery, scrapes each Pod's `/metrics` endpoint, and evaluates the
  committed `KKPaymentsHighErrorRate` rule when non-2xx `/payments`
  responses exceed 20% for at least one minute.
- **Integration layer --- Serverless Framework +
  serverless-s3-local:** provides the asynchronous staging
  receipt-processing chain: `kk-payments` publishes to
  `kk-payments-receipts-staging`, `processReceiptUpload` processes the
  object and writes to `kk-receipts-processed-staging`, and the
  processed object triggers `notifyReceipt`.
- **Traceability layer --- structured JSON logs + correlation IDs:**
  connects the synchronous payment request to downstream receipt
  processing so a transaction can be followed across service
  boundaries.
- **Intelligence/governance layer --- AI-assisted engineering:**
  records substantive AI-assisted decisions in
  `docs/ai-governance-log.md`, including the recommendation, human
  review, final decision, and observed outcome.

## Repository Structure

```text
kijani-capstone/
├── README.md
├── Jenkinsfile
├── requirements.txt
├── docs/
│   ├── architecture.png
│   ├── architecture.svg
│   ├── ai-governance-log.md
│   └── scope.md
├── jenkins/
│   ├── Dockerfile
│   └── Dockerfile.capstone-agent
├── terraform/
│   ├── main.tf
│   ├── variables.tf
│   └── outputs.tf
├── ansible/
│   ├── playbook.yml
│   ├── inventory/
│   │   └── local.yml
│   └── group_vars/
│       ├── staging.yml
│       └── production.yml
├── k8s/
│   ├── kk-payments-deployment.yaml
│   └── kk-payments-service.yaml
├── monitoring/
│   ├── prometheus.yml
│   ├── alerts.yml
│   ├── prometheus-rbac.yaml
│   ├── prometheus-deployment.yaml
│   └── prometheus-service.yaml
└── serverless/
    └── kk-receipts/
        ├── serverless.yml
        ├── package.json
        └── handlers/
            ├── receipts.js
            ├── processor.js
            └── notifier.js
```

`kijani-capstone` is the orchestration and infrastructure repository.
Application source is intentionally maintained separately in
`kijanikiosk-payments` and is checked out by Jenkins during delivery.

Terraform state, Python virtual environments, Serverless build output,
installed Node modules, and local environment files are runtime
artifacts and are excluded from version control.

## Prerequisites

The verified local setup requires:

- Git
- Docker
- Minikube
- `kubectl`
- Terraform 1.5+
- Ansible
- Python 3 with virtual-environment support
- Node.js and npm
- Serverless Framework v3
- AWS CLI
- `socat`
- a Docker Hub account with access to `lewis0648/kk-payments`
- a Docker Hub access token
- a local Jenkins controller with Docker Pipeline support

The Ansible Kubernetes modules use the Python Kubernetes client pinned
in `requirements.txt`:

```text
kubernetes==36.0.3
```

The serverless subsystem uses `serverless-offline` and
`serverless-s3-local`.

### Jenkins-specific prerequisites

Jenkins is treated as an **existing CI prerequisite**, not as
infrastructure provisioned by this repository. This avoids replacing or
conflicting with an engineer's existing Jenkins jobs, credentials,
plugins, and persistent data.

The verified Jenkins environment requires:

- a working Jenkins controller;
- the **Docker Pipeline** plugin;
- the **Generic Webhook Trigger** plugin;
- Docker CLI access from the controller;
- `kubectl` available to the controller;
- the host Docker socket mounted at `/var/run/docker.sock`;
- Docker network connectivity to the Minikube network;
- the custom ephemeral build-agent image
  `kijanikiosk-capstone-agent:22`;
- Jenkins global environment variable `DOCKER_GID`, set to the numeric
  group ID that owns `/var/run/docker.sock`;
- Jenkins credential `dockerhub-credentials` as **Username with
  password**, where the password is a Docker Hub access token;
- Jenkins credential `minikube-kubeconfig` as a **Secret file**;
- Jenkins credential `kijani-webhook-token` as **Secret text**.

The repository includes two reference Dockerfiles:

- `jenkins/Dockerfile` documents the verified Jenkins controller
  extensions used locally (Docker CLI and `kubectl`);
- `jenkins/Dockerfile.capstone-agent` builds the Node/Docker/`kubectl`
  agent image used by the `Jenkinsfile`.

An engineer with an existing Jenkins installation does not need to
replace it with the provided controller image; the controller only needs
equivalent capabilities.

Build the capstone agent with:

```bash
docker build   -f jenkins/Dockerfile.capstone-agent   -t kijanikiosk-capstone-agent:22   jenkins
```

Determine the host Docker socket group:

```bash
stat -c '%g' /var/run/docker.sock
```

Store that numeric value in **Manage Jenkins → System → Global
properties → Environment variables** as:

```text
DOCKER_GID=<host-docker-socket-group-id>
```

The Jenkinsfile uses this value with `--group-add` so the pipeline agent
can access the mounted Docker socket without committing a
machine-specific group ID.

## Setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd kijani-capstone
```

### 2. Start Minikube

```bash
minikube start
```

Verify:

```bash
minikube status
kubectl config current-context
```

Expected context:

```text
minikube
```

### 3. Create the Python environment

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

### 4. Provision Kubernetes namespaces with Terraform

```bash
terraform -chdir=terraform init
terraform -chdir=terraform validate
terraform -chdir=terraform plan
terraform -chdir=terraform apply
```

Terraform manages:

```text
kijani-staging
kijani-project
```

Verify:

```bash
terraform -chdir=terraform output
terraform -chdir=terraform state list

kubectl get namespace kijani-staging --show-labels
kubectl get namespace kijani-project --show-labels
```

### 5. Export Docker Hub credentials for Ansible

```bash
export DOCKERHUB_USERNAME='lewis0648'
export DOCKERHUB_TOKEN='<your-docker-hub-access-token>'
```

Do not commit the token.

Ansible uses these values to create the `kijani-registry-credentials`
image-pull Secret in each namespace.

### 6. Configure staging with Ansible

```bash
ansible-playbook \
  -i ansible/inventory/local.yml \
  ansible/playbook.yml \
  -e deploy_env=staging
```

The staging ConfigMap contains values including:

```text
PORT=3001
DB_HOST=postgres-staging.kijani.internal
DB_PORT=5432
LOG_LEVEL=debug
MAX_CONNECTIONS=10
NODE_ENV=staging
RECEIPT_BUCKET=kk-payments-receipts-staging
AWS_REGION=af-south-1
S3_ENDPOINT=http://<minikube-host-gateway>:4570
```

Ansible derives the Minikube host gateway dynamically rather than
committing a machine-specific IP.

Verify:

```bash
kubectl get configmap kk-payments-config \
  -n kijani-staging \
  -o yaml

kubectl get secret kijani-registry-credentials \
  -n kijani-staging
```

The Secret type should be:

```text
kubernetes.io/dockerconfigjson
```

### 7. Configure production with Ansible

```bash
ansible-playbook \
  -i ansible/inventory/local.yml \
  ansible/playbook.yml \
  -e deploy_env=production
```

Production contains environment-specific values including:

```text
PORT=3001
DB_HOST=postgres-prod.kijani.internal
DB_PORT=5432
LOG_LEVEL=warn
MAX_CONNECTIONS=10
NODE_ENV=production
```

Verify:

```bash
kubectl get configmap kk-payments-config \
  -n kijani-project \
  -o yaml

kubectl get secret kijani-registry-credentials \
  -n kijani-project
```

An unchanged rerun of either environment configuration should remain
idempotent:

```text
changed=0
failed=0
```

### 8. Prepare Jenkins Kubernetes access and credentials

The checked-in Kubernetes Deployment is intentionally a reusable release
template rather than a deployable historical release. It contains:

```text
lewis0648/kk-payments:PIPELINE_REQUIRED
PIPELINE_VERSION_REQUIRED
```

Jenkins renders those placeholders with the immutable release image and
application version selected for the current run.

Create a self-contained Minikube kubeconfig on the host:

```bash
kubectl config view   --minify   --raw   --flatten   > /tmp/jenkins-minikube-kubeconfig
```

Store that file in Jenkins as a **Secret file** credential with ID:

```text
minikube-kubeconfig
```

Store the Docker Hub username and access token as **Username with
password**:

```text
dockerhub-credentials
```

Generate a webhook token:

```bash
openssl rand -hex 24
```

Store it as a Jenkins **Secret text** credential:

```text
kijani-webhook-token
```

Do not commit or publish the token.

Ensure the Jenkins controller and its Docker-based pipeline agents can
reach the Minikube Docker network. The verified pipeline agent runs
with:

```text
--network minikube
```

### 9. Configure the Jenkins Pipeline job

Create a Pipeline job named, for example:

```text
kijani-capstone-pipeline
```

Configure:

```text
Definition: Pipeline script from SCM
SCM: Git
Repository URL: https://github.com/Lewis-mbui/kijani-capstone.git
Branch Specifier: */main
Script Path: Jenkinsfile
```

The `Jenkinsfile` checks out `kijanikiosk-payments/main` separately
during execution.

The pipeline performs:

1.  **Checkout** --- checks out `kijani-capstone` and
    `kijanikiosk-payments`.
2.  **Prepare Release** --- derives `<semver>-<git-short-sha>` from the
    application repository.
3.  **Docker Test** --- runs linting, Jest tests, and the TypeScript
    build through the Docker `test` target.
4.  **Build Image** --- builds the production image once.
5.  **Verify Image** --- confirms the expected immutable image exists
    locally.
6.  **Push Image** --- publishes a new immutable Docker Hub tag or
    reuses the existing immutable tag.
7.  **Deploy Staging** --- renders the shared Kubernetes Deployment with
    the release image/version and applies it to `kijani-staging`.
8.  **Verify Staging Rollout** --- waits for rollout completion and
    verifies the deployed image.
9.  **Smoke Test Staging** --- checks `/health` and confirms the
    expected release version.
10. **Production Approval** --- pauses for explicit human approval.
11. **Deploy Production** --- promotes the exact same image to
    `kijani-project`.
12. **Verify Production Rollout** --- confirms the approved image is
    running.
13. **Smoke Test Production** --- validates production health and
    version.

Run the job once after first configuring it so Jenkins registers the
`GenericTrigger` declared in the Jenkinsfile.

### 10. Configure automatic GitHub delivery triggering

The application repository --- **not the capstone repository** --- is
the source of delivery events.

Expose the local Jenkins controller to GitHub using an HTTPS tunnel such
as ngrok:

```bash
ngrok http 8080
```

In the `kijanikiosk-payments` GitHub repository, create a webhook for
**push events** with a payload URL in this form:

```text
https://<ngrok-host>/generic-webhook-trigger/invoke?token=<webhook-token>
```

Use:

```text
Content type: application/json
Events: Just the push event
Active: enabled
```

The token must match the value stored in Jenkins credential
`kijani-webhook-token`.

The Jenkinsfile extracts:

```text
repository.full_name
ref
```

and only accepts the exact combination:

```text
Lewis-mbui/kijanikiosk-payments
refs/heads/main
```

Therefore, pushes to feature branches reach the webhook but are filtered
out without starting the delivery pipeline. A merge into
`kijanikiosk-payments/main` produces a push event that starts Jenkins
automatically.

This behavior has been verified end to end: a feature-branch push
produced a GitHub/ngrok delivery without a Jenkins build, while a
subsequent merge to `main` started the pipeline automatically and the
release was successfully promoted through staging and production.

> The ngrok endpoint is environment-specific and may change between
> sessions. Update the GitHub webhook URL when the public endpoint
> changes.

### 10. Start the local receipt-processing subsystem

Install dependencies:

```bash
cd serverless/kk-receipts
npm install
```

Start the staging serverless environment:

```bash
serverless offline start --stage staging
```

The stage resolves these buckets:

```text
kk-payments-receipts-staging
kk-receipts-processed-staging
```

The verified receipt chain is:

```text
kk-payments
  -> kk-payments-receipts-staging
  -> processReceiptUpload
  -> kk-receipts-processed-staging
  -> notifyReceipt
```

`generateReceipt` remains available as the HTTP entry point for
standalone receipt generation, but the Kubernetes integration path
writes raw receipt events directly from `kk-payments` into the staging
raw-receipt bucket.

### 11. Start the Minikube-to-host S3 relay

The verified Kubernetes-to-local-S3 path uses a relay on port `4570`.

Discover the Minikube host gateway:

```bash
MINIKUBE_GATEWAY=$(minikube ssh -- "ip route show default" | awk '{print $3}')
```

Start:

```bash
socat \
  TCP-LISTEN:4570,bind="${MINIKUBE_GATEWAY}",reuseaddr,fork \
  TCP:127.0.0.1:4569
```

Leave this running while testing the Kubernetes receipt integration.

Verify:

```bash
curl "http://${MINIKUBE_GATEWAY}:4570"
```

A successful response should return S3-compatible XML.

> `serverless.yml` currently declares `custom.s3.host: 0.0.0.0`, while
> the verified integration path still uses the `socat` relay. This seam
> should be revalidated during the clean-room reproducibility test so
> the final documentation reflects the behavior of the installed plugin
> version exactly.

### 12. Deploy Prometheus monitoring

Prometheus runs in `kijani-staging` and uses a namespace-scoped
ServiceAccount/Role to discover staging Pods.

The canonical Prometheus configuration is stored in:

```text
monitoring/prometheus.yml
monitoring/alerts.yml
```

Create or update the Kubernetes ConfigMap directly from those source
files:

```bash
kubectl create configmap prometheus-config \
  -n kijani-staging \
  --from-file=prometheus.yml=monitoring/prometheus.yml \
  --from-file=alerts.yml=monitoring/alerts.yml \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -
```

Apply the RBAC, Deployment, and Service:

```bash
kubectl apply -f monitoring/prometheus-rbac.yaml
kubectl apply -f monitoring/prometheus-deployment.yaml
kubectl apply -f monitoring/prometheus-service.yaml
```

Verify Prometheus:

```bash
kubectl rollout status \
  deployment/prometheus \
  -n kijani-staging \
  --timeout=120s

kubectl get pods \
  -n kijani-staging \
  -l app=prometheus

kubectl logs \
  -n kijani-staging \
  deployment/prometheus \
  --tail=50
```

The current Prometheus image is pinned to:

```text
prom/prometheus:v3.13.2
```

Prometheus stores data in ephemeral Pod storage in this local capstone
implementation; no persistent volume is configured.

### 13. Open Prometheus locally

```bash
kubectl port-forward \
  -n kijani-staging \
  service/prometheus \
  9090:9090
```

Open:

```text
http://localhost:9090
```

The `kk-payments-staging` scrape job should discover all three
application Pods individually.

Verify using PromQL:

```promql
up{job="kk-payments-staging"}
```

Expected: three result series, each with value `1`.

The verified target set showed three independently scraped staging Pods
and **3/3 UP**.

### 14. Verify application metrics

The current `kk-payments` application exposes `/metrics` using
Prometheus-compatible exposition format.

Verify through Kubernetes:

```bash
kubectl exec \
  -n kijani-staging \
  deployment/kk-payments \
  -- wget -qO- \
  http://kk-payments:3001/metrics \
  | grep kk_payments_http_requests_total
```

The custom request counter uses these labels:

```text
method
route
status_code
```

Example PromQL:

```promql
kk_payments_http_requests_total
```

Aggregate by response status:

```promql
sum by (status_code) (
  kk_payments_http_requests_total
)
```

Convert the counter into a request rate:

```promql
sum by (route) (
  rate(kk_payments_http_requests_total[1m])
)
```

### 15. Verify the Prometheus alert lifecycle

The committed rule is:

```text
KKPaymentsHighErrorRate
```

It fires when more than **20%** of recent `/payments` requests are
non-2xx continuously for at least **1 minute**.

The alert expression is based on:

```text
rate(non-2xx /payments requests)
--------------------------------
rate(all /payments requests)
```

To generate controlled staging failures, first port-forward the staging
Service:

```bash
kubectl port-forward \
  -n kijani-staging \
  service/kk-payments \
  3001:3001
```

Then generate sustained rejected payment requests:

```bash
for i in $(seq 1 160); do
  curl -s \
    -o /dev/null \
    -X POST \
    http://127.0.0.1:3001/payments \
    -H 'Content-Type: application/json' \
    -d '{"amount":0,"currency":"KES"}'

  sleep 0.5
done
```

In Prometheus, observe:

```text
INACTIVE -> PENDING -> FIRING
```

The alert has been verified reaching **FIRING** with:

```text
alertname="KKPaymentsHighErrorRate"
environment="staging"
service="kk-payments"
severity="warning"
```

After the failing traffic stops and the one-minute rate window clears,
the alert returns to inactive. This full firing-and-recovery lifecycle
has been demonstrated.

## How to Verify the System

### Verify infrastructure

```bash
terraform -chdir=terraform output
terraform -chdir=terraform state list

kubectl get namespace kijani-staging --show-labels
kubectl get namespace kijani-project --show-labels
```

Terraform state should contain both namespace resources.

### Verify environment isolation

```bash
kubectl get configmap kk-payments-config \
  -n kijani-staging \
  -o jsonpath='{.data.DB_HOST}{" | "}{.data.NODE_ENV}{"\n"}'

kubectl get configmap kk-payments-config \
  -n kijani-project \
  -o jsonpath='{.data.DB_HOST}{" | "}{.data.NODE_ENV}{"\n"}'
```

Expected:

```text
postgres-staging.kijani.internal | staging
postgres-prod.kijani.internal | production
```

### Verify Kubernetes rollouts

```bash
kubectl rollout status deployment/kk-payments \
  -n kijani-staging \
  --timeout=120s

kubectl rollout status deployment/kk-payments \
  -n kijani-project \
  --timeout=120s

kubectl get pods -n kijani-staging -l app=kk-payments
kubectl get pods -n kijani-project -l app=kk-payments
```

Each environment should contain three ready replicas.

### Verify build-once promotion

```bash
kubectl get deployment kk-payments \
  -n kijani-staging \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'

kubectl get deployment kk-payments \
  -n kijani-project \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'

kubectl exec \
  -n kijani-staging \
  deploy/kk-payments \
  -- printenv APP_VERSION

kubectl exec \
  -n kijani-project \
  deploy/kk-payments \
  -- printenv APP_VERSION
```

The image and `APP_VERSION` should identify the same approved release in
both namespaces.

### Verify staging health and correlation IDs

```bash
kubectl port-forward \
  -n kijani-staging \
  service/kk-payments \
  3001:3001
```

Then:

```bash
curl -i \
  -H 'X-Correlation-ID: demo-001' \
  http://127.0.0.1:3001/health
```

The response should include:

```text
x-correlation-id: demo-001
```

and the JSON body should contain:

```text
"status":"ok"
"correlationId":"demo-001"
```

### Verify the Kubernetes-to-serverless receipt chain

With the staging serverless environment and relay running:

```bash
curl -i \
  -X POST \
  http://127.0.0.1:3001/payments \
  -H 'Content-Type: application/json' \
  -H 'X-Correlation-ID: k8s-receipt-e2e-002' \
  -d '{"amount":1500,"currency":"KES"}'
```

Application logs should contain:

```text
payment.created
receipt.published
```

Downstream serverless logs should contain:

```text
receipt.processing_started
receipt.processed
receipt.notification_dispatched
```

with the same correlation ID.

Inspect processed receipt objects:

```bash
aws --no-sign-request \
  --endpoint-url http://localhost:4569 \
  s3 ls \
  s3://kk-receipts-processed-staging/
```

Then inspect a selected object:

```bash
aws --no-sign-request \
  --endpoint-url http://localhost:4569 \
  s3 cp \
  s3://kk-receipts-processed-staging/<processed-object-key> \
  -
```

The processed object should preserve the transaction data and
correlation ID and include:

```text
status=processed
processedAt=<timestamp>
```

### Verify Prometheus targets

With the Prometheus port-forward running, query:

```promql
up{job="kk-payments-staging"}
```

Expected: three series with value `1`.

### Verify Prometheus alert configuration

Open the Prometheus **Alerts** page and confirm
`KKPaymentsHighErrorRate` is loaded.

During the deliberate error test, it should transition to `FIRING`;
after the errors stop and the rate window expires, it should return to
inactive.

## Current Verified State

At the current implementation milestone:

- Terraform manages `kijani-staging` and `kijani-project`.
- Ansible configures staging and production from one playbook with
  environment-specific variable files.
- Ansible has been verified idempotent on unchanged reruns.
- Staging and production have distinct `DB_HOST`, `LOG_LEVEL`, and
  `NODE_ENV` values.
- Docker Hub image-pull credentials are created through Ansible rather
  than committed.
- The same Kubernetes Deployment and Service definitions are reused
  for staging and production.
- The Deployment defines three replicas, rolling updates,
  readiness/liveness probes, and CPU/memory requests and limits.
- The checked-in Deployment uses explicit Jenkins release placeholders
  rather than a stale image tag.
- `kk-payments` uses Node.js 22 and a multi-stage production
  Dockerfile.
- Jenkins derives releases from application SemVer plus the
  application Git short SHA.
- Jenkins runs containerized linting, six automated tests, TypeScript
  compilation, and the production image build.
- Jenkins publishes new immutable Docker Hub tags and reuses existing
  immutable tags rather than overwriting them.
- Jenkins automatically deploys and validates staging.
- The production approval gate appears only after staging rollout and
  smoke validation succeed.
- Jenkins promotes the exact same image to production without
  rebuilding it.
- Pushes to `kijanikiosk-payments/main` automatically trigger the
  delivery pipeline through GitHub → ngrok → Generic Webhook Trigger.
- Feature-branch webhook deliveries are filtered and do not start the
  deployment pipeline.
- Production rollout verification and production smoke testing are
  implemented.
- The metrics-enabled release `1.1.0-4c6e4f6` has been delivered
  successfully through the full pipeline.
- `kk-payments` exposes Prometheus-compatible `/metrics`.
- Prometheus discovers all three staging Pods independently using
  Kubernetes Pod service discovery.
- The `kk-payments-staging` scrape pool has been verified with **3/3
  targets UP**.
- Prometheus ingests `kk_payments_http_requests_total` with Pod,
  route, method, and status labels.
- `KKPaymentsHighErrorRate` is committed and has been deliberately
  driven from inactive to pending to **FIRING**, then observed
  recovering after the failing traffic stopped.
- `kk-payments` emits structured JSON logs and preserves correlation
  IDs.
- Staging receives the receipt bucket, AWS region, and local S3
  endpoint through Ansible configuration.
- Kubernetes-hosted `kk-payments` publishes raw receipt events into
  `kk-payments-receipts-staging`.
- `processReceiptUpload` writes processed receipt objects into
  `kk-receipts-processed-staging`.
- `notifyReceipt` emits the final structured receipt-notification
  event.
- A staging transaction has been traced end to end through the receipt
  chain using one correlation ID.
- The AI governance log contains the completed human-reviewed
  AI-assisted engineering entries required for the capstone.

The Track A implementation is feature-complete across infrastructure,
runtime configuration, delivery, receipt integration, monitoring,
automated delivery triggering, and AI governance. The project is now in
final reproducibility, validation, peer/self-review, and submission
preparation.

## Known Limitations

This capstone is intentionally **production-approaching**, not a
customer-ready production platform.

Deliberately out of scope:

- managed Kubernetes such as Amazon EKS;
- multi-region high availability and disaster recovery;
- external secrets-management platforms such as HashiCorp Vault;
- a complete production observability platform spanning metrics, logs,
  traces, dashboards, and distributed alert management.

Current implementation limitations:

- **Ingress is not currently part of the capstone runtime path.**
  Jenkins smoke tests use in-cluster Service DNS, while local
  verification uses `kubectl port-forward`.
- **Prometheus data is ephemeral.** The current Deployment has no
  persistent volume, so metric history is lost if the Prometheus Pod
  is recreated.
- **No Alertmanager notification route is configured.** The committed
  rule is evaluated and demonstrated in the Prometheus UI, but it does
  not send email, Slack, PagerDuty, or another external notification.
- **The error-rate rule is intentionally demo-oriented.** A real
  production threshold/window would be based on an agreed SLO and
  expected traffic volume rather than the capstone's 20%-for-1-minute
  threshold.
- **Local S3 networking remains environment-specific.** The verified
  Minikube integration uses a `socat` relay to expose the local S3
  emulator.
- **The payment endpoint waits for receipt publication.** A production
  payments service would normally introduce a more durable
  asynchronous boundary such as an outbox or queue with
  retry/dead-letter behavior.
- **Jenkins is a local containerized installation with host
  Docker-socket access.** Production CI would use stronger worker
  isolation and credential boundaries.
- **The GitHub webhook depends on a local ngrok tunnel.** The public
  endpoint can change between sessions and must be updated in the
  `kijanikiosk-payments` webhook configuration when it changes.
- **Docker socket access remains host-dependent.** The Jenkinsfile no
  longer hard-codes a socket group ID, but each Jenkins host must
  expose `/var/run/docker.sock` and set `DOCKER_GID` to the group that
  owns that socket.
- **The deliberate staging pipeline-failure demonstration is still
  pending.** The final evidence should prove that a failed staging
  validation prevents the production approval gate.
- **The destructive clean-room reproduction test is still pending.**
  The project must still be rebuilt from the README after deleting
  local Minikube/S3 state to identify undocumented dependencies.
- **Peer review and final presentation artifacts are still pending.**

These gaps are documented deliberately rather than being presented as
production-ready capabilities.
