# KijaniKiosk Capstone

Infrastructure-first KijaniKiosk capstone integrating reproducible infrastructure, container-based CI/CD, Kubernetes deployment, monitoring, serverless receipt processing, and governed AI-assisted operations.

The project addresses the absence of a controlled staging-to-production delivery workflow for `kk-payments`. Changes will be validated automatically in an isolated staging environment before the same immutable container image can be promoted to production through a human approval gate.

## Architecture

![KijaniKiosk Capstone Architecture](docs/architecture.png)

The system follows an infrastructure-first delivery model:

- **Terraform** provisions the Kubernetes staging environment.
- **Ansible** applies environment-specific staging configuration.
- **Jenkins** will build, test, publish, and promote container images through staging and production.
- **Minikube** hosts the isolated staging and production Kubernetes environments.
- **Docker Hub** will store immutable `kk-payments` container images tagged using semantic version and Git commit SHA.
- **Prometheus** will monitor a meaningful `kk-payments` health signal.
- **Serverless Framework** will provide asynchronous receipt processing.
- **AI-assisted operations** will be used for an operational task with documented human governance.

The detailed project scope is available in [`docs/scope.md`](docs/scope.md).

## Prerequisites

The current infrastructure setup requires:

- Git
- Docker
- Minikube
- `kubectl`
- Terraform
- Ansible
- Python 3 with virtual environment support

The Ansible Kubernetes modules also require the Python Kubernetes client. The tested version for this project is:

```text
kubernetes==36.0.3
```

Additional Jenkins, Serverless Framework, Prometheus, and Docker Hub requirements will be documented as those layers are implemented and verified.

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

### 4. Provision the staging namespace with Terraform

```bash
cd terraform
terraform init
terraform validate
terraform plan
terraform apply
```

Terraform provisions the isolated Kubernetes namespace:

```text
kijani-staging
```

Verify it:

```bash
terraform output
kubectl get namespace kijani-staging --show-labels
```

Return to the repository root:

```bash
cd ..
```

### 5. Configure the staging environment with Ansible

Run:

```bash
ansible-playbook \
  -i ansible/inventory/local.yml \
  ansible/playbook.yml
```

Ansible first verifies that Terraform has provisioned `kijani-staging` and then creates the environment-specific `kk-payments-config` ConfigMap.

Verify the configuration:

```bash
kubectl get configmap kk-payments-config \
  -n kijani-staging \
  -o yaml
```

The staging configuration includes:

```text
DB_HOST=postgres-staging.kijani.internal
NODE_ENV=staging
```

Running the Ansible playbook again without configuration changes should be idempotent and report:

```text
changed=0
failed=0
```

## How to Run the Pipeline

**Work in progress.**

The capstone delivery pipeline will build and test `kk-payments`, produce an immutable Docker image tagged using the `<semver>-<git-short-sha>` convention, push it to Docker Hub, deploy it automatically to staging, run rollout and smoke-test validation, and expose a human approval gate before production promotion.

This section will be updated when the delivery layer has been implemented and verified.

## How to Verify It Works

The infrastructure layer can currently be verified with:

```bash
terraform -chdir=terraform output
kubectl get namespace kijani-staging --show-labels
kubectl get configmap kk-payments-config -n kijani-staging -o yaml
```

A successful infrastructure setup demonstrates that:

1. `kijani-staging` exists and is managed by Terraform.
2. The namespace is labelled as the staging KijaniKiosk environment.
3. `kk-payments-config` exists inside `kijani-staging`.
4. The staging configuration uses `postgres-staging.kijani.internal`.
5. Re-running the Ansible configuration without changes is idempotent.

End-to-end application, pipeline, monitoring, and serverless verification commands will be added as those layers are completed.

## Known Limitations

The capstone is currently under active implementation.

The target system is production-approaching rather than a customer-ready production platform. The following are deliberately outside the project scope:

- Managed Kubernetes platforms such as Amazon EKS.
- Multi-region high availability and disaster recovery.
- External secrets-management platforms such as HashiCorp Vault.
- A complete production observability stack incorporating metrics, logs, traces, dashboards, and distributed alert management.

Additional implementation-specific limitations will be documented as they are discovered.
