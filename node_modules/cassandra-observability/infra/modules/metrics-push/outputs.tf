output "client_id" {
  description = "CF Access service token client ID — set as VM_PUSH_CLIENT_ID in Workers"
  value       = cloudflare_zero_trust_access_service_token.vm_push.client_id
}

output "client_secret" {
  description = "CF Access service token client secret — set as VM_PUSH_CLIENT_SECRET in Workers"
  value       = cloudflare_zero_trust_access_service_token.vm_push.client_secret
  sensitive   = true
}

output "push_url" {
  description = "Full URL for metrics push — set as VM_PUSH_URL in Workers"
  value       = "https://${var.subdomain}.${var.domain}/api/v1/import/prometheus"
}
