terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

# CF Access application — service token auth (machine-to-machine)
resource "cloudflare_zero_trust_access_application" "vm_push" {
  zone_id                    = var.zone_id
  name                       = "vm-push-metrics"
  domain                     = "${var.subdomain}.${var.domain}"
  type                       = "self_hosted"
  session_duration           = "24h"
  auto_redirect_to_identity  = false
  http_only_cookie_attribute = false
}

# Service token for Workers to authenticate
resource "cloudflare_zero_trust_access_service_token" "vm_push" {
  account_id = var.account_id
  name       = "vm-push-metrics-service-token"
}

# Policy — only allow the service token
resource "cloudflare_zero_trust_access_policy" "service_token" {
  application_id = cloudflare_zero_trust_access_application.vm_push.id
  zone_id        = var.zone_id
  name           = "Service token access"
  precedence     = 1
  decision       = "non_identity"

  include {
    service_token = [cloudflare_zero_trust_access_service_token.vm_push.id]
  }
}
