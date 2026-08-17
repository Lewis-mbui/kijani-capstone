# AI Governance Log

This log records the use of AI-assisted engineering during the KijaniKiosk capstone. Each entry documents the task delegated to AI, the context supplied, the resulting output, the human review performed, shortcomings identified, and changes made before the output was accepted or applied.

The purpose of this log is not to treat AI output as authoritative. AI-assisted recommendations are reviewed against observed system behaviour, repository state, command output, and project requirements before being incorporated into the capstone.

---

## Entry 1 — Jenkins Delivery Pipeline Engineering

**Date:** 2026-08-16

**Tool used:** ChatGPT

**Task description:**  
Design and troubleshoot the Jenkins delivery pipeline for the KijaniKiosk capstone so that `kk-payments` could be tested in Docker, built once as an immutable SemVer + Git SHA image, published to Docker Hub, deployed automatically to staging, validated there, and only then promoted to production after explicit human approval.

**What was provided to the AI:**  
The current `kijani-capstone` repository structure, the separate `kijanikiosk-payments` repository, the existing local Jenkins setup running in Docker, the Minikube cluster configuration, the custom Jenkins controller image, the custom Node-based build agent, the Kubernetes manifests, the Dockerfile, Jenkins console output from failed and successful builds, and the capstone requirement that production approval must only appear after a successful staging smoke test.

**What the AI produced:**  
The AI proposed a staged Jenkins architecture using a dedicated containerized build agent containing Node.js, Docker CLI, `kubectl`, Git, and `curl`. It helped construct the Jenkinsfile stages for checkout, release-version derivation, Docker-based testing, production-image build, immutable image publication, staging deployment, staging rollout verification, staging smoke testing, production approval, production deployment, production rollout verification, and production smoke testing. It also proposed using a flattened Minikube kubeconfig stored as a Jenkins secret-file credential and Docker Hub credentials stored in Jenkins.

**What it got right:**  
The AI correctly separated the Jenkins controller from build execution by using a dedicated build-agent container. It correctly preserved the build-once promotion model by deriving the release tag from the application SemVer and application Git short SHA, then promoting the same image from staging to production rather than rebuilding it. It also correctly placed the production approval gate after the staging smoke test and added explicit verification that the image running in Kubernetes matched the image produced by the pipeline. The recommendation to store Docker Hub credentials and the Minikube kubeconfig in Jenkins credentials rather than in Git was also appropriate.

**What it got wrong:**  
The initial solution assumed that mounting `/var/run/docker.sock` into Jenkins and the build-agent container would be sufficient for Docker access. In practice, the Jenkins user and later the ephemeral build-agent user did not have permission to access the socket because they were missing the host socket's group ID. The AI also initially suggested updating the running Kubernetes Deployment using `kubectl set image`, while the checked-in Deployment manifest still contained an older concrete image tag. That would have allowed a later direct `kubectl apply` to silently roll the environment back to the stale release. In addition, the early pipeline cleanup logic attempted to run a shell command in the global `post` block even when the Docker agent had failed to start, which caused a secondary `MissingContextVariableException`.

**What I changed before applying the output:**  
I verified the Docker socket ownership and added the host Docker socket group to both the Jenkins controller and the capstone build agent instead of weakening socket permissions with `chmod 666`. I kept Jenkins attached to both the CI network and the Minikube network so that it could reach the Kubernetes API. I changed the Deployment manifest to use explicit `PIPELINE_REQUIRED` and `PIPELINE_VERSION_REQUIRED` placeholders instead of a historical image tag, then changed Jenkins to render the immutable image and application version into a temporary manifest before applying it. I also verified the full pipeline incrementally through multiple builds before adding later stages. The final implementation was accepted only after Jenkins successfully completed the staging rollout, staging smoke test, manual approval gate, production rollout verification, and production smoke test.

---

## Entry 2 — Kubernetes-to-Serverless Runtime Integration

**Date:** 2026-08-16

**Tool used:** ChatGPT

**Task description:**  
Integrate the Kubernetes-hosted `kk-payments` service in the `kijani-staging` namespace with the local Week 10 serverless receipt-processing chain. A successful payment needed to publish a raw receipt object to `kk-payments-receipts-staging`, trigger `processReceiptUpload`, create a processed object in `kk-receipts-processed-staging`, and preserve the same correlation ID across the workflow.

**What was provided to the AI:**  
The current `kijani-capstone` and `kijanikiosk-payments` configuration, the Serverless Framework staging configuration, Minikube networking information, the local S3rver endpoint, Ansible-managed `RECEIPT_BUCKET`, `S3_ENDPOINT`, and `AWS_REGION` values, Kubernetes environment-variable output, application logs, S3 bucket listings, `curl` and `wget` connectivity tests from both the host and Kubernetes Pods, and Serverless/S3rver terminal logs produced during failed requests.

**What the AI produced:**  
The AI helped design and troubleshoot the path between the Kubernetes application and the host-based S3 emulator. It proposed exposing the local S3 service to Minikube through a host-accessible endpoint, configuring that endpoint through the staging Ansible variables, verifying network connectivity from inside a `kk-payments` Pod, and testing the integration with an end-to-end payment request. It also helped define verification steps for checking `receipt.published` application logs and retrieving the resulting processed receipt object from the staging processed-receipt bucket.

**What it got right:**  
The AI correctly identified that `127.0.0.1:4569` could not be used by a Kubernetes Pod to reach a service running on the host because loopback inside the Pod refers to the Pod itself. It correctly used `host.minikube.internal` to establish that Minikube could resolve the host and helped identify that the S3 service itself was only listening on `127.0.0.1:4569`. Introducing a host-accessible relay on port `4570` allowed the host and the Kubernetes network to reach the local S3 emulator. The AI also correctly emphasized testing each boundary separately instead of treating a successful HTTP connection as proof that the complete S3 integration worked.

**What it got wrong:**  
The initial configuration using `S3_ENDPOINT=http://host.minikube.internal:4570` was treated as if network reachability would be sufficient for the AWS SDK/S3rver interaction. Although the endpoint became reachable, a real payment request returned HTTP 400 with `The specified bucket does not exist`. The S3rver logs showed `No bucket found for "host.minikube.internal"` and a failed `PUT /kk-payments-receipts-staging/...` request. This demonstrated that S3rver was interpreting the hostname in a way that did not match the assumed addressing behavior. The AI therefore could not determine the correct integration solely from the apparent network topology; the recommendation had to be revised using observed S3rver behavior.

**What I changed before applying the output:**  
I did not treat the successful connection to port `4570` as proof that the integration was complete. I verified the staging bucket independently with the AWS CLI and a direct HTTP request, then compared those successful requests with the failed request generated by `kk-payments`. I used the S3rver logs to identify the hostname-related bucket-resolution problem and adjusted the S3 client configuration so that requests used path-style S3 addressing. After rebuilding and redeploying `kk-payments`, I repeated the real payment request. It returned HTTP 201, and the application emitted `payment.created` followed by `receipt.published` for the same correlation ID. I then retrieved `processed-pay_1786870081216.json` from `kk-receipts-processed-staging` and confirmed that it contained the original payment data, `status: "processed"`, a processing timestamp, and the same `k8s-receipt-e2e-002` correlation ID. I accepted the integration only after this end-to-end verification succeeded.

---

## Entry 3 — Prometheus Monitoring and Alerting

**Date:** 2026-08-16

**Tool used:** ChatGPT

**Task description:**  
Add application-level observability to the KijaniKiosk capstone by exposing Prometheus metrics from `kk-payments`, deploying Prometheus into the staging Kubernetes environment, configuring it to discover and scrape all `kk-payments` Pods, and creating a meaningful alert for an elevated payment error rate.

**What was provided to the AI:**  
The current `kijanikiosk-payments` application code, the Kubernetes Deployment and Service configuration, the `kijani-staging` environment, command output from the application's `/metrics` endpoint, Kubernetes Pod information, Prometheus logs, Prometheus API query results, screenshots from the Prometheus UI, observed request-rate values, and the results of deliberately generating successful and unsuccessful requests while testing the alert.

**What the AI produced:**  
The AI helped introduce Prometheus instrumentation into `kk-payments`, including the `kk_payments_http_requests_total` counter and the `/metrics` endpoint. It then helped construct the Prometheus Kubernetes configuration, namespace-scoped RBAC, Deployment, Service, Pod-discovery configuration, PromQL expressions, and the `KKPaymentsHighErrorRate` alert rule. It also provided a step-by-step validation procedure covering raw application metrics, Prometheus target discovery, PromQL queries, controlled failure generation, and alert-state observation.

**What it got right:**  
The AI correctly recommended application-level metrics rather than relying only on Kubernetes Pod health. It helped configure Prometheus to use Kubernetes Pod discovery so that all three `kk-payments` replicas were scraped independently rather than treating the Service as a single target. This was verified through the `up{job="kk-payments-staging"}` query, which returned three instances with a value of `1`. It also correctly used a counter with method, route, and status-code labels, allowing payment failures to be distinguished from normal health-check traffic. The final alert measures the proportion of non-2xx `/payments` requests rather than simply alerting on the existence of an individual failed request.

**What it got wrong:**  
Some of the initial PromQL suggestions did not immediately produce useful results against the real workload. One query returned no result because the relevant payment traffic did not yet exist in the selected rate window. During investigation, the `/health` request rate was also observed at approximately 0.44–0.47 requests per second because Kubernetes health probes were continuously generating traffic. This showed that a syntactically valid PromQL expression can still be operationally misleading if the workload and labels behind the metric are not understood. The initial monitoring discussion therefore needed refinement so that health-probe traffic was not confused with customer payment traffic and so that the alert could be demonstrated reliably within the capstone environment.

**What I changed before applying the output:**  
I inspected the raw `/metrics` output before deploying Prometheus and generated repeated `/health` requests to confirm that `kk_payments_http_requests_total` actually increased. After deploying Prometheus, I verified the targets through both the UI and API instead of assuming Pod discovery worked. The `up{job="kk-payments-staging"}` query confirmed three healthy Pod targets, and direct queries of `kk_payments_http_requests_total` showed separate series for each replica. I tested PromQL expressions against real generated traffic and distinguished the recurring Kubernetes `/health` probe traffic from `/payments` traffic. I then used a controlled sequence of payment failures to validate the final `KKPaymentsHighErrorRate` rule. I observed the alert transition from inactive to pending and then firing after the configured one-minute duration. After stopping the failure traffic, I confirmed that the calculated error rate fell and the alert returned to inactive. I accepted the monitoring configuration only after demonstrating both the failure and recovery paths.
