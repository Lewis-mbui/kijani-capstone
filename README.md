# KijaniKiosk Capstone

KijaniKiosk is an infrastructure-first DevOps capstone that integrates reproducible Kubernetes environments, environment-specific configuration, container-based CI/CD, staged release promotion, Prometheus monitoring, asynchronous receipt processing, and governed AI-assisted operations.

The central operational problem is the lack of a controlled staging-to-production delivery path for `kk-payments`. The capstone introduces an isolated staging environment, validates an immutable application image there automatically, requires an explicit human approval before production promotion, and promotes the exact same artifact rather than rebuilding it.

## Track

**Track A — Infrastructure-First**

The detailed scope and success criteria are documented in [`docs/scope.md`](docs/scope.md).

## Architecture

![KijaniKiosk Capstone Architecture](docs/architecture.png)

The implemented system currently consists of these major layers:

- **Terraform** provisions the `kijani-staging` and `kijani-project` Kubernetes namespaces.
- **Ansible** configures each namespace with environment-specific `kk-payments` configuration and Docker Hub image-pull credentials.
- **Jenkins** checks out this orchestration repository plus the separate `kijanikiosk-payments` application repository, tests the application in Docker, builds an immutable SemVer + Git SHA image, pushes or reuses that image in Docker Hub, deploys it automatically to staging, runs rollout and smoke-test gates, pauses for human production approval, and promotes the same image to production.
- **Kubernetes on Minikube** runs the same `kk-payments` Deployment and Service definitions in staging and production, with environment differences supplied through ConfigMaps.
- **Prometheus** runs in `kijani-staging`, discovers all staging `kk-payments` Pods through Kubernetes service discovery, scrapes each Pod's `/metrics` endpoint, and evaluates a committed high-error-rate alert.
- **Serverless Framework + serverless-s3-local** provide the asynchronous staging receipt-processing chain.
- **Structured JSON logs and correlation IDs** connect the synchronous payment request to downstream receipt processing.
- **AI-assisted operational analysis and governance** remain the next planned intelligence-layer milestone.

> **Architecture diagram status:** the diagram captures the overall intended topology, but it still needs a final refresh before submission so that the exact implemented receipt-handler names and Prometheus alert threshold match the current repository.

## Repository Structure

```text
kijani-capstone/
├── README.md
├── Jenkinsfile
├── requirements.txt
├── docs/
│   ├── architecture.png
│   └── scope.md
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

Terraform state files are local runtime artifacts and are excluded by `.gitignore`; they are not part of the intended repository source.

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

The Ansible Kubernetes modules use the Python Kubernetes client pinned in `requirements.txt`:

```text
kubernetes==36.0.3
```

The serverless subsystem uses `serverless-offline` and `serverless-s3-local`.

### Jenkins-specific prerequisites

The verified Jenkins environment also requires:

- the host Docker socket mounted into the Jenkins controller;
- the custom build-agent image `kijanikiosk-capstone-agent:22`;
- Docker network connectivity to the Minikube network;
- Jenkins credential `dockerhub-credentials` as **Username with password**, where the password is a Docker Hub access token;
- Jenkins credential `minikube-kubeconfig` as a **Secret file**;
- `kubectl` available to the Jenkins environment;
- a Docker socket supplemental group matching the local host socket GID.

The current Jenkinsfile contains a local numeric `--group-add` value for the Docker socket. That value is machine-specific and must be documented or derived during the final clean-room reproducibility pass.

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

Ansible uses these values to create the `kijani-registry-credentials` image-pull Secret in each namespace.

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

Ansible derives the Minikube host gateway dynamically rather than committing a machine-specific IP.

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

An unchanged rerun of either environment configuration should remain idempotent:

```text
changed=0
failed=0
```

### 8. Prepare Jenkins Kubernetes access

The checked-in Kubernetes Deployment is intentionally a reusable template rather than a deployable historical release. It contains:

```text
lewis0648/kk-payments:PIPELINE_REQUIRED
PIPELINE_VERSION_REQUIRED
```

Jenkins renders these placeholders with the current immutable release image and application version.

Create a self-contained Minikube kubeconfig on the host:

```bash
kubectl config view \
  --minify \
  --raw \
  --flatten \
  > /tmp/jenkins-minikube-kubeconfig
```

Store that file in Jenkins as a **Secret file** credential with ID:

```text
minikube-kubeconfig
```

Store the Docker Hub username and access token in Jenkins with ID:

```text
dockerhub-credentials
```

The Jenkins controller/build agent also needs Docker network connectivity to Minikube.

### 9. Run the delivery pipeline

The Jenkins job uses **Pipeline script from SCM** with this repository and the root `Jenkinsfile`.

A successful run performs:

1. **Checkout** — checks out `kijani-capstone` and the separate `kijanikiosk-payments` repository.
2. **Prepare Release** — derives `<semver>-<git-short-sha>` from the application repository.
3. **Docker Test** — runs linting, Jest tests, and the TypeScript build through the Docker `test` target.
4. **Build Image** — builds the production image once.
5. **Verify Image** — confirms the expected image tag and local image ID.
6. **Push Image** — publishes a new immutable tag to Docker Hub, or reuses it if it already exists.
7. **Deploy Staging** — renders the shared manifest and applies the exact release to `kijani-staging`.
8. **Verify Staging Rollout** — waits for rollout completion and verifies the exact image identity.
9. **Smoke Test Staging** — calls `/health` through Kubernetes Service DNS and verifies both health and release version.
10. **Approve Production** — appears only after staging validation succeeds.
11. **Deploy Production** — promotes the same rendered manifest and same immutable image to `kijani-project`.
12. **Verify Production** — waits for rollout completion and checks the approved image.
13. **Smoke Test Production** — verifies production health and exact release identity.

The core release rule is:

```text
build once -> validate in staging -> approve -> promote the same image
```

A failing test, staging rollout, or staging smoke test stops the pipeline before production approval.

The latest metrics-enabled application release verified through the full pipeline is:

```text
lewis0648/kk-payments:1.1.0-4c6e4f6
```

Future application commits will produce new immutable tags automatically.

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

`generateReceipt` remains available as the HTTP entry point for standalone receipt generation, but the Kubernetes integration path writes raw receipt events directly from `kk-payments` into the staging raw-receipt bucket.

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

> `serverless.yml` currently declares `custom.s3.host: 0.0.0.0`, while the verified integration path still uses the `socat` relay. This seam should be revalidated during the clean-room reproducibility test so the final documentation reflects the behavior of the installed plugin version exactly.

### 12. Deploy Prometheus monitoring

Prometheus runs in `kijani-staging` and uses a namespace-scoped ServiceAccount/Role to discover staging Pods.

The canonical Prometheus configuration is stored in:

```text
monitoring/prometheus.yml
monitoring/alerts.yml
```

Create or update the Kubernetes ConfigMap directly from those source files:

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

Prometheus stores data in ephemeral Pod storage in this local capstone implementation; no persistent volume is configured.

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

The `kk-payments-staging` scrape job should discover all three application Pods individually.

Verify using PromQL:

```promql
up{job="kk-payments-staging"}
```

Expected: three result series, each with value `1`.

The verified target set showed three independently scraped staging Pods and **3/3 UP**.

### 14. Verify application metrics

The current `kk-payments` application exposes `/metrics` using Prometheus-compatible exposition format.

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

It fires when more than **20%** of recent `/payments` requests are non-2xx continuously for at least **1 minute**.

The alert expression is based on:

```text
rate(non-2xx /payments requests)
--------------------------------
rate(all /payments requests)
```

To generate controlled staging failures, first port-forward the staging Service:

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

After the failing traffic stops and the one-minute rate window clears, the alert returns to inactive. This full firing-and-recovery lifecycle has been demonstrated.

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

The image and `APP_VERSION` should identify the same approved release in both namespaces.

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

The processed object should preserve the transaction data and correlation ID and include:

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

Open the Prometheus **Alerts** page and confirm `KKPaymentsHighErrorRate` is loaded.

During the deliberate error test, it should transition to `FIRING`; after the errors stop and the rate window expires, it should return to inactive.

## Current Verified State

At the current implementation milestone:

- Terraform manages `kijani-staging` and `kijani-project`.
- Ansible configures staging and production from one playbook with environment-specific variable files.
- Ansible has been verified idempotent on unchanged reruns.
- Staging and production have distinct `DB_HOST`, `LOG_LEVEL`, and `NODE_ENV` values.
- Docker Hub image-pull credentials are created through Ansible rather than committed.
- The same Kubernetes Deployment and Service definitions are reused for staging and production.
- The Deployment defines three replicas, rolling updates, readiness/liveness probes, and CPU/memory requests and limits.
- The checked-in Deployment uses explicit Jenkins release placeholders rather than a stale image tag.
- `kk-payments` uses Node.js 22 and a multi-stage production Dockerfile.
- Jenkins derives releases from application SemVer plus the application Git short SHA.
- Jenkins runs containerized linting, six automated tests, TypeScript compilation, and the production image build.
- Jenkins publishes new immutable Docker Hub tags and reuses existing immutable tags rather than overwriting them.
- Jenkins automatically deploys and validates staging.
- The production approval gate appears only after staging rollout and smoke validation succeed.
- Jenkins promotes the exact same image to production without rebuilding it.
- Production rollout verification and production smoke testing are implemented.
- The metrics-enabled release `1.1.0-4c6e4f6` has been delivered successfully through the full pipeline.
- `kk-payments` exposes Prometheus-compatible `/metrics`.
- Prometheus discovers all three staging Pods independently using Kubernetes Pod service discovery.
- The `kk-payments-staging` scrape pool has been verified with **3/3 targets UP**.
- Prometheus ingests `kk_payments_http_requests_total` with Pod, route, method, and status labels.
- `KKPaymentsHighErrorRate` is committed and has been deliberately driven from inactive to pending to **FIRING**, then observed recovering after the failing traffic stopped.
- `kk-payments` emits structured JSON logs and preserves correlation IDs.
- Staging receives the receipt bucket, AWS region, and local S3 endpoint through Ansible configuration.
- Kubernetes-hosted `kk-payments` publishes raw receipt events into `kk-payments-receipts-staging`.
- `processReceiptUpload` writes processed receipt objects into `kk-receipts-processed-staging`.
- `notifyReceipt` emits the final structured receipt-notification event.
- A staging transaction has been traced end to end through the receipt chain using one correlation ID.

The infrastructure, runtime, delivery, receipt-integration, and Prometheus monitoring portions of Track A are now implemented. The next planned major milestone is the AI-assisted operations/governance intelligence layer, followed by deliberate pipeline failure-path validation, clean-room reproducibility testing, peer review, and final submission artifacts.

## Known Limitations

This capstone is intentionally **production-approaching**, not a customer-ready production platform.

Deliberately out of scope:

- managed Kubernetes such as Amazon EKS;
- multi-region high availability and disaster recovery;
- external secrets-management platforms such as HashiCorp Vault;
- a complete production observability platform spanning metrics, logs, traces, dashboards, and distributed alert management.

Current implementation limitations:

- **AI governance/intelligence is not yet complete.** A genuine AI-assisted operational task and the required governance log still need to be completed.
- **The architecture diagram needs a final refresh.** Its overall topology is useful, but some serverless labels and the Prometheus alert example do not exactly match the current implementation.
- **Ingress is not currently part of the capstone runtime path.** Jenkins smoke tests use in-cluster Service DNS, while local verification uses `kubectl port-forward`.
- **Prometheus data is ephemeral.** The current Deployment has no persistent volume, so metric history is lost if the Prometheus Pod is recreated.
- **No Alertmanager notification route is configured.** The committed rule is evaluated and demonstrated in the Prometheus UI, but it does not send email, Slack, PagerDuty, or another external notification.
- **The error-rate rule is intentionally demo-oriented.** A real production threshold/window would be based on an agreed SLO and expected traffic volume rather than the capstone's 20%-for-1-minute threshold.
- **Local S3 networking remains environment-specific.** The verified Minikube integration uses a `socat` relay to expose the local S3 emulator.
- **The payment endpoint waits for receipt publication.** A production payments service would normally introduce a more durable asynchronous boundary such as an outbox or queue with retry/dead-letter behavior.
- **Jenkins is a local containerized installation with host Docker-socket access.** Production CI would use stronger worker isolation and credential boundaries.
- **The Jenkins Docker socket group ID is currently machine-specific.** The final reproducibility work should remove or clearly parameterize this assumption.
- **The deliberate staging pipeline-failure demonstration is still pending.** The final evidence should prove that a failed staging validation prevents the production approval gate.
- **The destructive clean-room reproduction test is still pending.** The project must still be rebuilt from the README after deleting local Minikube/S3 state to identify undocumented dependencies.
- **Peer review and final presentation artifacts are still pending.**

These gaps are documented deliberately rather than being presented as production-ready capabilities.
