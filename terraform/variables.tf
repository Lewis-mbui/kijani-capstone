variable "kubeconfig_path" {
  description = "Path to the kubeconfig file used to access the Minikube cluster."
  type        = string
  default     = "~/.kube/config"
}

variable "kube_context" {
  description = "Kubernetes context Terraform should use."
  type        = string
  default     = "minikube"
}

variable "staging_namespace" {
  description = "Kubernetes namespace used for the KijaniKiosk staging environment."
  type        = string
  default     = "kijani-staging"
}

variable "production_namespace" {
  description = "Kubernetes namespace used for the KijaniKiosk production environment."
  type        = string
  default     = "kijani-project"
}
