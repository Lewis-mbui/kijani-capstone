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
- `socat` for exposing the loopback-only local S3 emulator to Minikube

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
RECEIPT_BUCKET=kk-payments-receipts-staging
AWS_REGION=af-south-1
```

For the local Track A integration, Ansible also discovers the Minikube host gateway dynamically and writes an S3 endpoint into the staging ConfigMap. On the current Docker-driver Minikube network this resolves to a value such as:

```text
S3_ENDPOINT=http://192.168.49.1:4570
```

The gateway is discovered at configuration time rather than committed as a machine-specific address.

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

### 10. Start the Minikube-to-host S3 relay

`serverless-s3-local` binds its S3-compatible endpoint to host loopback (`127.0.0.1:4569`). Minikube Pods cannot reach that loopback listener directly.

Start a local TCP relay that exposes the S3 emulator on the Minikube host gateway:

```bash
MINIKUBE_GATEWAY=$(minikube ssh -- "ip route show default" | awk '{print $3}')

socat \
  TCP-LISTEN:4570,bind="${MINIKUBE_GATEWAY}",reuseaddr,fork \
  TCP:127.0.0.1:4569
```

Leave the relay running while testing the Kubernetes-to-serverless integration.

Verify the relay from the host:

```bash
curl "http://${MINIKUBE_GATEWAY}:4570"
```

A successful response should return S3-compatible XML rather than `Connection refused`.

The same gateway address is discovered by Ansible and used for the staging `S3_ENDPOINT`.

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

### 12. Verify the host-local correlated receipt workflow

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

### 13. Verify the Kubernetes-hosted receipt workflow

The first capstone release image verified in staging is:

```text
lewis0648/kk-payments:1.1.0-3dd5ce5
```

The image was built only after the Docker test target completed successfully, pushed to Docker Hub, and deployed to `kijani-staging`.

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

The verified Kubernetes-hosted flow produced a processed object containing:

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
- The production Dockerfile has explicit dependency, builder, test, and production stages.
- The Docker test target successfully runs linting, automated tests, and the TypeScript build.
- `kk-payments` emits structured JSON logs and preserves correlation IDs.
- A SemVer + Git SHA release image, `1.1.0-3dd5ce5`, was built, verified locally, pushed to Docker Hub, and deployed successfully to staging.
- Staging receives `RECEIPT_BUCKET`, `AWS_REGION`, and a dynamically derived `S3_ENDPOINT` through Ansible-managed configuration.
- `serverless-s3-local` provides stage-aware raw and processed receipt buckets.
- A `socat` relay exposes the host-loopback S3 emulator to the Minikube network without hard-coding the gateway in the repository.
- `kk-payments` running inside Minikube successfully publishes raw receipt events to `kk-payments-receipts-staging`.
- `processReceiptUpload` consumes the raw event and writes a processed receipt.
- `notifyReceipt` consumes the processed receipt and emits a structured notification event.
- One Kubernetes-hosted transaction has been traced end to end with `correlationId=k8s-receipt-e2e-002`.

The next implementation steps will be reassessed against the capstone guide before proceeding. Ingress exposure, Jenkins delivery automation, Prometheus monitoring, and the AI governance/intelligence layer remain pending.

## Known Limitations

The capstone is currently under active implementation.

The target system is production-approaching rather than a customer-ready production platform. The following are deliberately outside the project scope:

- Managed Kubernetes platforms such as Amazon EKS.
- Multi-region high availability and disaster recovery.
- External secrets-management platforms such as HashiCorp Vault.
- A complete production observability stack incorporating metrics, logs, traces, dashboards, and distributed alert management.

The current implementation also has the following temporary limitations:

- Release identity is currently injected manually during staging deployment. Jenkins has not yet automated build-once/push/promote behavior for the immutable `<semver>-<git-short-sha>` image.
- The Minikube-to-host S3 connection currently depends on a local `socat` relay because `serverless-s3-local` binds to host loopback. This is suitable for the local Track A demonstration but would be replaced by a routable managed object-store endpoint in production.
- The current payment endpoint waits for receipt publication to succeed before returning success. A production payments system would normally use a more durable decoupling mechanism such as an outbox, queue, or retry-capable event transport.
- The current production image is still based on Node.js 18 and emits an AWS SDK runtime support warning. Runtime hardening should move the image to Node.js 22 before final submission.

Additional implementation-specific limitations will be documented as they are discovered.
