# KijaniKiosk Capstone

Infrastructure-first KijaniKiosk capstone integrating reproducible infrastructure, container-based CI/CD, Kubernetes deployment, monitoring, serverless receipt processing, and governed AI-assisted operations.

The project addresses the absence of a controlled staging-to-production delivery workflow for `kk-payments`. Changes are intended to be validated automatically in an isolated staging environment before the same immutable container image can be promoted to production through a human approval gate.

## Architecture

![KijaniKiosk Capstone Architecture](docs/architecture.png)

The system follows an infrastructure-first delivery model:

- **Terraform** provisions isolated staging and production Kubernetes namespaces.
- **Ansible** applies environment-specific configuration and Kubernetes registry credentials.
- **Jenkins** will build, test, publish, and promote container images through staging and production.
- **Minikube** hosts the isolated staging and production Kubernetes environments.
- **Docker Hub** will store immutable `kk-payments` container images tagged using semantic version and Git commit SHA.
- **Prometheus** will monitor a meaningful `kk-payments` health signal.
- **Serverless Framework** provides stage-aware asynchronous receipt processing backed by local S3-compatible storage during Track A development.
- **AI-assisted operations** will be used for an operational task with documented human governance.

The detailed project scope is available in [`docs/scope.md`](docs/scope.md).

## Prerequisites

The current infrastructure and runtime setup requires:

- Git
- Docker
- Minikube
- `kubectl`
- Terraform
- Ansible
- Python 3 with virtual environment support
- Docker Hub account with access to the private `lewis0648/kk-payments` repository
- Docker Hub access token
- Node.js and npm
- Serverless Framework v3
- AWS CLI for inspecting the local S3-compatible endpoint

The Ansible Kubernetes modules require the Python Kubernetes client. The tested version for this project is:

```text
kubernetes==36.0.3
```

Python dependencies are recorded in `requirements.txt`.

The serverless receipt subsystem also uses `serverless-offline` and `serverless-s3-local`. Jenkins and Prometheus requirements will be documented as those layers are implemented and verified.

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

`kijani-staging` is the isolated staging environment and `kijani-project` is the production environment.

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

The Kubernetes environments pull the private `kk-payments` image from Docker Hub.

Export the Docker Hub username and access token in the current shell:

```bash
export DOCKERHUB_USERNAME='lewis0648'
export DOCKERHUB_TOKEN='<your-docker-hub-access-token>'
```

Do not store the access token in the repository.

Ansible reads these environment variables and creates a `kubernetes.io/dockerconfigjson` Secret named:

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

1. validates the requested environment,
2. verifies that Terraform has already provisioned the target namespace,
3. creates or updates the environment-specific `kk-payments-config` ConfigMap, and
4. creates or updates the Docker Hub image pull Secret.

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
```

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

Re-running either Ansible configuration without changing its inputs should be idempotent and report:

```text
changed=0
failed=0
```

### 8. Deploy `kk-payments` to staging

The Kubernetes Deployment and Service manifests do not contain a hard-coded namespace. The same manifests are therefore reusable across environments.

Deploy them to staging:

```bash
kubectl apply \
  -f k8s/kk-payments-deployment.yaml \
  -f k8s/kk-payments-service.yaml \
  -n kijani-staging
```

Wait for the Deployment to become healthy:

```bash
kubectl rollout status deployment/kk-payments \
  -n kijani-staging \
  --timeout=120s
```

Verify the workload:

```bash
kubectl get pods \
  -n kijani-staging \
  -l app=kk-payments

kubectl get service kk-payments \
  -n kijani-staging
```

### 9. Deploy `kk-payments` to production

Apply the exact same Kubernetes manifests to the production namespace:

```bash
kubectl apply \
  -f k8s/kk-payments-deployment.yaml \
  -f k8s/kk-payments-service.yaml \
  -n kijani-project
```

Wait for the production Deployment:

```bash
kubectl rollout status deployment/kk-payments \
  -n kijani-project \
  --timeout=120s
```

Verify the workload:

```bash
kubectl get pods \
  -n kijani-project \
  -l app=kk-payments

kubectl get service kk-payments \
  -n kijani-project
```

### 10. Start the staging receipt-processing subsystem

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

The stage-aware Serverless configuration resolves the receipt buckets to:

```text
kk-payments-receipts-staging
kk-receipts-processed-staging
```

The raw receipt bucket is the integration boundary used by `kk-payments`. An S3 `ObjectCreated` event invokes `processReceiptUpload`, which writes the processed receipt to the processed bucket. A second S3 event invokes `notifyReceipt`, which emits the final structured notification log.

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

### 11. Verify the local correlated receipt workflow

The current application implementation publishes receipt events using:

```text
RECEIPT_BUCKET
S3_ENDPOINT
AWS_REGION
```

For the verified host-local integration test, `kk-payments` was started with the staging receipt bucket and the local S3-compatible endpoint. A payment request carrying an explicit correlation ID was then submitted:

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

This host-local test proves the application/serverless event contract before the same S3 endpoint configuration is wired into the Minikube staging workload.

## How to Run the Pipeline

**Work in progress.**

The capstone delivery pipeline will:

1. check out the application source,
2. determine the release version using the `<semver>-<git-short-sha>` convention,
3. build and test `kk-payments`,
4. build the production Docker image,
5. push the immutable image to Docker Hub,
6. deploy that exact image automatically to `kijani-staging`,
7. wait for Kubernetes rollout completion,
8. run a staging HTTP smoke test,
9. expose a human production approval gate only after staging succeeds,
10. promote the same immutable image to production, and
11. verify the production rollout.

A failed staging deployment or smoke test will prevent production promotion.

This section will be replaced with the verified Jenkins procedure once the delivery layer is implemented.

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

The endpoint should return JSON indicating that `kk-payments` is healthy.

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

The endpoint should return JSON indicating that `kk-payments` is healthy.

### Verify structured logging and correlation IDs

The current `kk-payments` application preserves an incoming `X-Correlation-ID` header and returns it in both the response header and JSON response body.

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

Application events are emitted as structured JSON logs containing fields such as `timestamp`, `level`, `service`, `event`, and `correlationId`.

### Verify the end-to-end receipt workflow

After the staging Serverless environment and the receipt-enabled `kk-payments` process are running, submit a payment with a known correlation ID:

```bash
curl -i \
  -X POST \
  http://127.0.0.1:3001/payments \
  -H 'Content-Type: application/json' \
  -H 'X-Correlation-ID: receipt-e2e-001' \
  -d '{"amount":1250,"currency":"KES"}'
```

The application should log `payment.created` followed by `receipt.published`.

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

A successfully processed object contains the original transaction data together with the same `correlationId`, `status: processed`, and a `processedAt` timestamp.

### Current verified state

At the current implementation milestone:

- Terraform manages both Kubernetes namespaces.
- Staging and production configuration is managed by one Ansible playbook.
- Ansible configuration is idempotent.
- Staging and production use different `DB_HOST` and `NODE_ENV` values.
- Both namespaces contain Docker Hub image pull credentials created by Ansible.
- The same Kubernetes Deployment and Service manifests are reused across environments.
- Both Deployments run three healthy `kk-payments` replicas.
- Both `/health` endpoints respond successfully.
- The production Dockerfile has explicit dependency, builder, test, and production stages.
- The Docker test target successfully runs linting, automated tests, and the TypeScript build.
- `kk-payments` emits structured JSON application logs.
- Incoming correlation IDs are preserved in response headers, response bodies, and application logs.
- `kk-payments` can publish a raw receipt event to `kk-payments-receipts-staging`.
- The stage-aware Serverless configuration creates the staging raw and processed receipt buckets in the local S3-compatible environment.
- `processReceiptUpload` consumes the raw receipt event and writes a processed receipt.
- `notifyReceipt` consumes the processed receipt and emits a structured notification event.
- A complete host-local transaction has been traced through `kk-payments`, both S3 buckets, the processor, and the notifier using one correlation ID.

The next integration milestone is to make `kk-payments` running inside the Minikube staging namespace reach the host-local S3-compatible endpoint. Jenkins delivery automation, Prometheus monitoring, and AI-assisted operational verification remain to be implemented.

## Known Limitations

The capstone is currently under active implementation.

The target system is production-approaching rather than a customer-ready production platform. The following are deliberately outside the project scope:

- Managed Kubernetes platforms such as Amazon EKS.
- Multi-region high availability and disaster recovery.
- External secrets-management platforms such as HashiCorp Vault.
- A complete production observability stack incorporating metrics, logs, traces, dashboards, and distributed alert management.

The current implementation also has the following temporary limitations:

- The currently deployed Kubernetes baseline image still reports `v1.0.0-local` from `/health`. The application already supports `APP_VERSION`, and release identity will be wired to immutable `<semver>-<git-short-sha>` images when the Jenkins pipeline is implemented.
- The complete receipt chain has been verified with `kk-payments` running directly on the host. Connectivity from the `kk-payments` Pod inside Minikube to the host-local S3-compatible endpoint has not yet been configured and verified.
- The current payment endpoint waits for receipt publication to succeed before returning success. A production payments system would normally use a more durable decoupling mechanism such as an outbox, queue, or retry-capable event transport.

Additional implementation-specific limitations will be documented as they are discovered.
