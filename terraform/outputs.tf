output "staging_namespace" {
  description = "Name of the provisioned KijaniKiosk staging namespace."
  value       = kubernetes_namespace_v1.kijani_staging.metadata[0].name
}
