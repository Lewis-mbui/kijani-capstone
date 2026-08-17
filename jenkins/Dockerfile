FROM docker:cli AS docker-cli

FROM jenkins/jenkins:lts-jdk21

ARG KUBECTL_VERSION=v1.35.1

USER root

# Docker CLI for building and pushing container images through
# the host Docker socket.
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

# kubectl version is pinned to match the local Minikube cluster.
RUN curl -fsSLo /usr/local/bin/kubectl \
  "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
  && chmod +x /usr/local/bin/kubectl \
  && kubectl version --client

USER jenkins
