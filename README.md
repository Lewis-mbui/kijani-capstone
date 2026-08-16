# KijaniKiosk Capstone

Infrastructure-first KijaniKiosk capstone integrating reproducible
infrastructure, container-based CI/CD, Kubernetes deployment,
monitoring, serverless receipt processing, and governed AI-assisted
operations.

The project addresses the absence of a controlled staging-to-production
delivery workflow for `kk-payments`. Changes are intended to be
validated automatically in an isolated staging environment before the
same immutable container image can be promoted to production through a
human approval gate.

## Architecture

![KijaniKiosk Capstone Architecture](docs/architecture.png)

The system follows an infrastructure-first delivery model:

- **Terraform** provisions isolated staging and production Kubernetes
  namespaces.
- **Ansible** applies environment-specific configuration and
  Kubernetes registry credentials.
- **Jenkins** builds and tests `kk-payments`, creates or reuses an
  immutable SemVer + Git SHA image, deploys it automatically to
  staging, runs rollout and health gates, pauses for explicit human
  approval, and promotes the exact same image to production.
- **Minikube** hosts the isolated staging and production Kubernetes
  environments.
- **Docker Hub** stores immutable `kk-payments` container images
  tagged using semantic version and Git commit SHA.
- **Kubernetes** runs the same Deployment and Service definitions in
  both environments; Jenkins renders only the release image and
  `APP_VERSION` placeholders at delivery time.
- **Serverless Framework** provides stage-aware asynchronous receipt
  processing backed by local S3-compatible storage during Track A
  development.
- **Prometheus monitoring** is the next Track A implementation
  milestone.
- **AI-assisted operations and governance** remain a planned
  intelligence-layer milestone.

The detailed project scope is available in
[`docs/scope.md`](docs/scope.md).

## Prerequisites

The current infrastructure and runtime setup requires:

- Git
- Docker
- Minikube
- `kubectl`
- Terraform
- Ansible
- Python 3 with virtual environment support
- Docker Hub account with access to the private
  `lewis0648/kk-payments` repository
- Docker Hub access token
- Node.js and npm
- Serverless Framework v3
- AWS CLI for inspecting the local S3-compatible endpoint
- `socat` for exposing the loopback-only local S3 emulator to Minikube

The Ansible Kubernetes modules require the Python Kubernetes client. The
tested version for this project is:

```text
kubernetes==36.0.3
```

Python dependencies are recorded in `requirements.txt`.

The serverless receipt subsystem also uses `serverless-offline` and
`serverless-s3-local`.

The verified Jenkins setup additionally requires:

- a running Jenkins controller with the Docker Pipeline capability,
- access to the host Docker socket,
- the custom `kijanikiosk-capstone-agent:22` build-agent image,
- Docker network access from the build agent to the Minikube network,
- a Jenkins username/password credential with ID
  `dockerhub-credentials`, and
- a Jenkins secret-file credential with ID `minikube-kubeconfig`.

The custom build agent contains Node.js 22, npm, Git, Docker CLI,
`kubectl`, and `curl`. Prometheus requirements will be added when the
monitoring layer is implemented.

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

Confirm that the cluster is running:

```bash
minikube status
kubectl config current-context
```

The expected Kubernetes context is:

```text
minikube
```

### 3. Create the Python environment

Create and activate an isolated Python virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Install the required Python dependencies:

```bash
python -m pip install -r requirements.txt
```

### 4. Provision Kubernetes environments with Terraform

Initialize and validate the Terraform configuration:

```bash
cd terraform

terraform init
terraform validate
terraform plan
```

Review the plan before applying it:

```bash
terraform apply
```

Terraform provisions and manages two Kubernetes namespaces:

```text
kijani-staging
kijani-project
```

`kijani-staging` is the isolated staging environment and
`kijani-project` is the production environment.

Verify the Terraform-managed infrastructure:

```bash
terraform output

kubectl get namespace kijani-staging --show-labels
kubectl get namespace kijani-project --show-labels

terraform state list
```

Return to the repository root:

```bash
cd ..
```

### 5. Configure Docker Hub credentials

The Kubernetes environments pull the private `kk-payments` image from
Docker Hub.

Export the Docker Hub username and access token in the current shell:

```bash
export DOCKERHUB_USERNAME='lewis0648'
export DOCKERHUB_TOKEN='<your-docker-hub-access-token>'
```

Do not store the access token in the repository.

Ansible reads these environment variables and creates a
`kubernetes.io/dockerconfigjson` Secret named:

```text
kijani-registry-credentials
```

in each target namespace.

### 6. Configure staging with Ansible

Run:

```bash
ansible-playbook \
  -i ansible/inventory/local.yml \
  ansible/playbook.yml \
  -e deploy_env=staging
```

Ansible:

1.  validates the requested environment,
2.  verifies that Terraform has already provisioned the target
    namespace,
3.  creates or updates the environment-specific `kk-payments-config`
    ConfigMap, and
4.  creates or updates the Docker Hub image pull Secret.

Verify the staging configuration:

```bash
kubectl get configmap kk-payments-config \
  -n kijani-staging \
  -o yaml
```

The staging configuration includes:

```text
PORT=3001
DB_HOST=postgres-staging.kijani.internal
NODE_ENV=staging
RECEIPT_BUCKET=kk-payments-receipts-staging
AWS_REGION=af-south-1
```

For the local Track A integration, Ansible also discovers the Minikube
host gateway dynamically and writes an S3 endpoint into the staging
ConfigMap. On the current Docker-driver Minikube network this resolves
to a value such as:

```text
S3_ENDPOINT=http://192.168.49.1:4570
```

The gateway is discovered at configuration time rather than committed as
a machine-specific address.

Verify the registry Secret metadata without exposing its contents:

```bash
kubectl get secret kijani-registry-credentials \
  -n kijani-staging
```

Its type should be:

```text
kubernetes.io/dockerconfigjson
```

### 7. Configure production with Ansible

Run the same playbook with the production environment selected:

```bash
ansible-playbook \
  -i ansible/inventory/local.yml \
  ansible/playbook.yml \
  -e deploy_env=production
```

Verify the production configuration:

```bash
kubectl get configmap kk-payments-config \
  -n kijani-project \
  -o yaml
```

The production configuration includes:

```text
PORT=3001
DB_HOST=postgres-prod.kijani.internal
NODE_ENV=production
```

Verify the production registry Secret:

```bash
kubectl get secret kijani-registry-credentials \
  -n kijani-project
```

Re-running either Ansible configuration without changing its inputs
should be idempotent and report:

```text
changed=0
failed=0
```

### 8. Prepare Kubernetes delivery

The checked-in Deployment manifest is intentionally **not directly
deployable**. It contains release placeholders:

```text
lewis0648/kk-payments:PIPELINE_REQUIRED
PIPELINE_VERSION_REQUIRED
```

Jenkins replaces those placeholders with the immutable release image and
application version before applying the same rendered Deployment to
staging and, after approval, production.

This prevents a stale image tag in Git from silently rolling an
environment back. Do not run `kubectl apply` directly against
`k8s/kk-payments-deployment.yaml` without first rendering valid release
values.

The Service manifest is namespace-neutral and is reused unchanged in
both environments.

### 9. Configure Jenkins delivery prerequisites

Create or verify the Jenkins credentials:

```text
dockerhub-credentials
minikube-kubeconfig
```

`dockerhub-credentials` contains the Docker Hub username and access
token used only during image publication.

`minikube-kubeconfig` is a Jenkins secret-file credential containing a
kubeconfig that can authenticate to the local Minikube API server. The
Jenkins build agent must also be attached to the Docker `minikube`
network so it can reach the cluster API.

The pipeline uses the custom agent:

```text
kijanikiosk-capstone-agent:22
```

and mounts the host Docker socket so Docker builds can run from the
containerized Jenkins agent.

### 10. Start the Minikube-to-host S3 relay

`serverless-s3-local` binds its S3-compatible endpoint to host loopback
(`127.0.0.1:4569`). Minikube Pods cannot reach that loopback listener
directly.

Start a local TCP relay that exposes the S3 emulator on the Minikube
host gateway:

```bash
MINIKUBE_GATEWAY=$(minikube ssh -- "ip route show default" | awk '{print $3}')

socat \
  TCP-LISTEN:4570,bind="${MINIKUBE_GATEWAY}",reuseaddr,fork \
  TCP:127.0.0.1:4569
```

Leave the relay running while testing the Kubernetes-to-serverless
integration.

Verify the relay from the host:

```bash
curl "http://${MINIKUBE_GATEWAY}:4570"
```

A successful response should return S3-compatible XML rather than
`Connection refused`.

The same gateway address is discovered by Ansible and used for the
staging `S3_ENDPOINT`.

### 11. Start the staging receipt-processing subsystem

The capstone includes the Week 10 receipt workflow under:

```text
serverless/kk-receipts/
```

Install its Node.js dependencies:

```bash
cd serverless/kk-receipts
npm install
```

Start the local serverless environment explicitly in the staging stage:

```bash
serverless offline start --stage staging
```

The stage-aware Serverless configuration resolves the receipt buckets
to:

```text
kk-payments-receipts-staging
kk-receipts-processed-staging
```

The raw receipt bucket is the integration boundary used by
`kk-payments`. An S3 `ObjectCreated` event invokes
`processReceiptUpload`, which writes the processed receipt to the
processed bucket. A second S3 event invokes `notifyReceipt`, which emits
the final structured notification log.

Verify the local S3-compatible buckets from another terminal:

```bash
aws --no-sign-request \
  --endpoint-url http://localhost:4569 \
  --region af-south-1 \
  s3 ls
```

Return to the repository root when finished:

```bash
cd ../..
```

### 12. Verify the host-local correlated receipt workflow

The current application implementation publishes receipt events using:

```text
RECEIPT_BUCKET
S3_ENDPOINT
AWS_REGION
```

For the verified host-local integration test, `kk-payments` was started
with the staging receipt bucket and the local S3-compatible endpoint. A
payment request carrying an explicit correlation ID was then submitted:

```bash
curl -i \
  -X POST \
  http://127.0.0.1:3001/payments \
  -H 'Content-Type: application/json' \
  -H 'X-Correlation-ID: receipt-e2e-001' \
  -d '{"amount":1250,"currency":"KES"}'
```

The same correlation ID must be preserved through:

```text
kk-payments: payment.created
kk-payments: receipt.published
kk-receipts-processor: receipt.processing_started
kk-receipts-processor: receipt.processed
kk-receipts-notifier: receipt.notification_dispatched
processed S3 object
```

This host-local test proves the application/serverless event contract
before the same S3 endpoint configuration is wired into the Minikube
staging workload.

### 13. Verify the Kubernetes-hosted receipt workflow

The first capstone release image verified in staging is:

```text
lewis0648/kk-payments:1.1.0-3dd5ce5
```

The image was built only after the Docker test target completed
successfully, pushed to Docker Hub, and deployed to `kijani-staging`.

Verify the currently running release and integration configuration:

```bash
kubectl exec \
  -n kijani-staging \
  deploy/kk-payments \
  -- printenv APP_VERSION

kubectl exec \
  -n kijani-staging \
  deploy/kk-payments \
  -- printenv RECEIPT_BUCKET

kubectl exec \
  -n kijani-staging \
  deploy/kk-payments \
  -- printenv S3_ENDPOINT
```

For the verified release, the expected application version is:

```text
1.1.0-3dd5ce5
```

Start a staging port-forward:

```bash
kubectl port-forward \
  -n kijani-staging \
  service/kk-payments \
  3001:3001
```

Submit a payment with a known correlation ID:

```bash
curl -i \
  -X POST \
  http://127.0.0.1:3001/payments \
  -H 'Content-Type: application/json' \
  -H 'X-Correlation-ID: k8s-receipt-e2e-002' \
  -d '{"amount":1500,"currency":"KES"}'
```

Verify the Kubernetes application logs:

```bash
kubectl logs \
  -n kijani-staging \
  deployment/kk-payments \
  --tail=50
```

The logs should include both:

```text
payment.created
receipt.published
```

with the same `correlationId`.

The downstream Serverless logs should then include:

```text
receipt.processing_started
receipt.processed
receipt.notification_dispatched
```

with that same correlation ID.

Finally, inspect the processed receipt:

```bash
aws --no-sign-request \
  --endpoint-url http://localhost:4569 \
  s3 ls \
  s3://kk-receipts-processed-staging/
```

and:

```bash
aws --no-sign-request \
  --endpoint-url http://localhost:4569 \
  s3 cp \
  s3://kk-receipts-processed-staging/<processed-object-key> \
  -
```

The verified Kubernetes-hosted flow produced a processed object
containing:

```text
correlationId=k8s-receipt-e2e-002
status=processed
```

This proves the current end-to-end seam:

```text
HTTP client
  -> Minikube kk-payments Pod
  -> dynamically discovered Minikube host gateway
  -> socat relay
  -> serverless-s3-local
  -> kk-payments-receipts-staging
  -> processReceiptUpload
  -> kk-receipts-processed-staging
  -> notifyReceipt
```

## How to Run the Pipeline

The delivery pipeline is implemented in the repository `Jenkinsfile` and
has been verified end to end.

The Jenkins job is configured as **Pipeline script from SCM** against
this capstone repository. A pipeline run performs the following stages:

1.  **Checkout** --- checks out the capstone repository and the separate
    `kijanikiosk-payments` application repository.
2.  **Prepare Release** --- reads the application SemVer from
    `package.json`, reads the application Git short SHA, and creates the
    immutable tag `<semver>-<git-short-sha>`.
3.  **Docker Test** --- builds the Docker `test` target, which runs
    linting, Jest tests, and the TypeScript build.
4.  **Build Image** --- builds the production target once using the
    immutable release tag.
5.  **Verify Image** --- verifies the resulting Docker tag and image ID.
6.  **Push Image** --- authenticates to Docker Hub. If the immutable tag
    already exists, the pipeline reuses it rather than republishing it;
    otherwise it pushes the new image.
7.  **Deploy Staging** --- renders the shared Deployment manifest with
    the exact image and `APP_VERSION`, then applies the Deployment and
    Service to `kijani-staging`.
8.  **Verify Staging Rollout** --- waits for `kubectl rollout status`
    and confirms Kubernetes is running the exact expected image.
9.  **Smoke Test Staging** --- calls `/health` through Kubernetes
    Service DNS and requires both `status=ok` and the expected release
    version.
10. **Approve Production** --- appears only after staging validation
    succeeds and requires explicit human approval.
11. **Deploy Production** --- applies the **same rendered manifest and
    same immutable image** to `kijani-project`; the application is not
    rebuilt.
12. **Verify Production** --- waits for the production rollout and
    verifies the deployed image matches the approved image.
13. **Smoke Test Production** --- calls the production `/health`
    endpoint through Service DNS and verifies the exact release version.

The core promotion rule is:

```text
build once -> validate in staging -> approve -> promote the same image
```

A failed test, staging rollout, or staging smoke test stops the pipeline
before the production approval gate.

The pipeline also disables concurrent builds, applies an overall
timeout, retains a bounded build history, and removes its temporary test
image and rendered manifest after each run.

### Triggering the pipeline

Push the completed branch/merge that the Jenkins job tracks, or use
**Build Now** in Jenkins for a manual demonstration run.

During a successful run, allow Jenkins to reach **Approve Production**.
Review the displayed immutable image and staging result, then select
**Deploy to Production**.

The verified delivery milestone promoted release:

```text
lewis0648/kk-payments:1.1.0-b5d1f5d
```

The exact tag will change whenever the `kijanikiosk-payments`
application commit changes.

## How to Verify It Works

### Verify Terraform-managed infrastructure

```bash
terraform -chdir=terraform output
terraform -chdir=terraform state list

kubectl get namespace kijani-staging --show-labels
kubectl get namespace kijani-project --show-labels
```

Terraform state should contain both namespace resources.

### Verify environment-specific configuration

Check staging:

```bash
kubectl get configmap kk-payments-config \
  -n kijani-staging \
  -o jsonpath='{.data.DB_HOST}{" | "}{.data.NODE_ENV}{"\n"}'
```

Expected:

```text
postgres-staging.kijani.internal | staging
```

Check production:

```bash
kubectl get configmap kk-payments-config \
  -n kijani-project \
  -o jsonpath='{.data.DB_HOST}{" | "}{.data.NODE_ENV}{"\n"}'
```

Expected:

```text
postgres-prod.kijani.internal | production
```

### Verify registry credentials exist

```bash
kubectl get secret kijani-registry-credentials \
  -n kijani-staging

kubectl get secret kijani-registry-credentials \
  -n kijani-project
```

Both Secrets should have type:

```text
kubernetes.io/dockerconfigjson
```

### Verify Kubernetes rollouts

```bash
kubectl rollout status deployment/kk-payments \
  -n kijani-staging \
  --timeout=120s

kubectl rollout status deployment/kk-payments \
  -n kijani-project \
  --timeout=120s
```

Both environments should contain three ready `kk-payments` Pods:

```bash
kubectl get pods -n kijani-staging -l app=kk-payments
kubectl get pods -n kijani-project -l app=kk-payments
```

### Verify runtime environment isolation

```bash
kubectl exec \
  -n kijani-staging \
  deploy/kk-payments \
  -- printenv NODE_ENV

kubectl exec \
  -n kijani-project \
  deploy/kk-payments \
  -- printenv NODE_ENV
```

Expected:

```text
staging
production
```

### Verify staging application health

Start a local port-forward:

```bash
kubectl port-forward \
  -n kijani-staging \
  service/kk-payments \
  3001:3001
```

From another terminal:

```bash
curl -s http://127.0.0.1:3001/health
```

The endpoint should return JSON indicating that `kk-payments` is
healthy.

### Verify production application health

Start a separate port-forward:

```bash
kubectl port-forward \
  -n kijani-project \
  service/kk-payments \
  3002:3001
```

From another terminal:

```bash
curl -s http://127.0.0.1:3002/health
```

The endpoint should return JSON indicating that `kk-payments` is
healthy.

### Verify structured logging and correlation IDs

The current `kk-payments` application preserves an incoming
`X-Correlation-ID` header and returns it in both the response header and
JSON response body.

Example:

```bash
curl -i \
  -H 'X-Correlation-ID: demo-001' \
  http://127.0.0.1:3001/health
```

The response should include:

```text
x-correlation-id: demo-001
```

and a JSON body containing:

```text
"correlationId":"demo-001"
```

Application events are emitted as structured JSON logs containing fields
such as `timestamp`, `level`, `service`, `event`, and `correlationId`.

### Verify the end-to-end receipt workflow

After the staging Serverless environment and the receipt-enabled
`kk-payments` process are running, submit a payment with a known
correlation ID:

```bash
curl -i \
  -X POST \
  http://127.0.0.1:3001/payments \
  -H 'Content-Type: application/json' \
  -H 'X-Correlation-ID: receipt-e2e-001' \
  -d '{"amount":1250,"currency":"KES"}'
```

The application should log `payment.created` followed by
`receipt.published`.

The serverless processor should then log:

```text
receipt.processing_started
receipt.processed
```

and the notifier should log:

```text
receipt.notification_dispatched
```

All of those events should contain the same correlation ID.

List the processed receipt objects:

```bash
aws --no-sign-request \
  --endpoint-url http://localhost:4569 \
  s3 ls \
  s3://kk-receipts-processed-staging/
```

Inspect a processed object:

```bash
aws --no-sign-request \
  --endpoint-url http://localhost:4569 \
  s3 cp \
  s3://kk-receipts-processed-staging/<processed-object-key> \
  -
```

A successfully processed object contains the original transaction data
together with the same `correlationId`, `status: processed`, and a
`processedAt` timestamp.

### Verify pipeline promotion

After a successful Jenkins run, confirm both namespaces use the same
immutable image:

```bash
kubectl get deployment kk-payments   -n kijani-staging   -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'

kubectl get deployment kk-payments   -n kijani-project   -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

Confirm the release identity inside each environment:

```bash
kubectl exec   -n kijani-staging   deploy/kk-payments   -- printenv APP_VERSION

kubectl exec   -n kijani-project   deploy/kk-payments   -- printenv APP_VERSION
```

For a successful promotion, the staging image, production image, staging
`APP_VERSION`, and production `APP_VERSION` must all identify the same
approved release.

The Jenkins console log should also show:

```text
Staging smoke test PASSED.
```

before the production approval stage, followed by:

```text
Production smoke test PASSED.
```

after promotion.

### Current verified state

At the current implementation milestone:

- Terraform manages both Kubernetes namespaces: `kijani-staging` and
  `kijani-project`.
- One Ansible playbook configures both environments and has been
  verified idempotent with `changed=0` and `failed=0` on an unchanged
  rerun.
- Staging and production use different `DB_HOST` and `NODE_ENV`
  values.
- Both namespaces contain Ansible-managed Docker Hub image pull
  credentials.
- The same Kubernetes Deployment and Service definitions are reused
  across environments.
- The Deployment defines three replicas, rolling updates, readiness
  and liveness probes, and CPU/memory requests and limits.
- The checked-in Deployment uses explicit pipeline placeholders
  instead of a stale release image.
- The `kk-payments` production image uses Node.js 22 and a multi-stage
  Docker build.
- Jenkins derives immutable releases using `<semver>-<git-short-sha>`.
- Jenkins runs containerized linting, six automated tests, the
  TypeScript build, and the production image build.
- Existing immutable Docker Hub tags are reused instead of
  overwritten.
- Jenkins renders and deploys the shared manifest automatically to
  staging.
- Jenkins verifies staging rollout completion and checks that the
  deployed image exactly matches the release image.
- The staging smoke test verifies both application health and the
  exact expected version.
- The production approval gate is offered only after the staging smoke
  test passes.
- After approval, Jenkins promotes the exact same immutable image to
  `kijani-project` without rebuilding it.
- Jenkins verifies the production rollout, exact image identity, and
  production `/health` response.
- Build #9 captured the human approval gate in the Jenkins UI, and the
  subsequent completed pipeline run verified the production rollout
  and smoke test.
- `kk-payments` emits structured JSON logs and preserves correlation
  IDs.
- Staging receives `RECEIPT_BUCKET`, `AWS_REGION`, and a dynamically
  derived local `S3_ENDPOINT` through Ansible-managed configuration.
- `serverless-s3-local` provides stage-aware raw and processed receipt
  buckets.
- A `socat` relay exposes the host-loopback S3 emulator to the
  Minikube network without committing a machine-specific gateway
  address.
- Kubernetes-hosted `kk-payments` successfully publishes raw receipt
  events to `kk-payments-receipts-staging`.
- `processReceiptUpload` consumes the raw event and writes a processed
  receipt.
- `notifyReceipt` consumes the processed receipt and emits a
  structured notification event.
- A Kubernetes-hosted transaction has been traced end to end through
  the receipt chain with one correlation ID.

The core infrastructure, runtime integration, serverless integration,
and staging-to-production delivery path are now implemented. The next
Track A technical milestone is Prometheus monitoring, followed by the AI
governance/intelligence layer and final failure-path/reproducibility
validation.

## Known Limitations

This capstone is intentionally **production-approaching**, not a
customer-ready production platform.

The following are deliberately outside the project scope:

- Managed Kubernetes platforms such as Amazon EKS.
- Multi-region high availability and disaster recovery.
- External secrets-management platforms such as HashiCorp Vault.
- A complete production observability platform combining metrics,
  logs, traces, dashboards, and distributed alert management.

Current implementation limitations are:

- **Monitoring is not yet implemented.** Track A still requires at
  least one committed Prometheus alert rule on a meaningful
  `kk-payments` health signal.
- **The AI intelligence/governance layer is not yet complete.** A
  genuine operational AI task and the required eight-field governance
  log still need to be documented.
- **Ingress is not currently part of the capstone runtime path.**
  Verification and smoke tests currently use Kubernetes Service DNS
  inside the cluster or local `kubectl port-forward`.
- **Local S3 connectivity requires a `socat` relay.**
  `serverless-s3-local` binds to host loopback, so the relay exposes
  it to the Minikube network. A production deployment would use a
  routable managed object-store endpoint.
- **The payment endpoint currently waits for receipt publication.** A
  production payments service would normally use a more durable
  asynchronous boundary such as an outbox, queue, retry policy, and
  dead-letter handling.
- **Jenkins is a local containerized installation.** Its Docker socket
  access, Minikube network attachment, kubeconfig, and credentials are
  suitable for this local capstone environment but would require
  stronger isolation and credential management in a production CI
  platform.
- **The clean-room reproduction test is still pending.** Before
  submission, the documented setup must be validated after destroying
  the local Minikube/S3 state so that undocumented dependencies can be
  found and removed.
- **The deliberate staging failure-path demonstration is still
  pending.** The final evidence must show that a staging failure
  prevents the production approval/promotion path.

These limitations are tracked deliberately rather than being presented
as production-ready capabilities.
