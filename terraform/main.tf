terraform {
  required_version = ">= 1.5.0"

  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
  }
}

provider "kubernetes" {
  config_path    = var.kubeconfig_path
  config_context = var.kube_context
}

resource "kubernetes_namespace_v1" "kijani_staging" {
  metadata {
    name = var.staging_namespace

    labels = {
      environment = "staging"
      project     = "kijanikiosk"
      managed-by  = "terraform"
    }
  }
}

resource "kubernetes_namespace_v1" "kijani_production" {
  metadata {
    name = var.production_namespace

    labels = {
      environment = "production"
      project     = "kijanikiosk"
      managed-by  = "terraform"
    }
  }
}
