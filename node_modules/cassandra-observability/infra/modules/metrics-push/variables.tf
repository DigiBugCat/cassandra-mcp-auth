variable "account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "zone_id" {
  description = "Cloudflare zone ID"
  type        = string
}

variable "domain" {
  description = "Root domain"
  type        = string
}

variable "subdomain" {
  description = "Subdomain for the metrics push endpoint"
  type        = string
  default     = "vm-push"
}
