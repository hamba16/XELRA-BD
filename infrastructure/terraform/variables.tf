variable "supabase_organization_id" { type = string }
variable "backup_retention_enabled" {
  type        = bool
  default     = false
  description = "Enable daily/weekly/monthly tier expiry only after an encrypted backup and restore drill pass."
}
variable "supabase_region" {
  type        = string
  description = "Choose the approved provider region explicitly. No default account or region."
}
variable "database_password" {
  type      = string
  sensitive = true
  validation {
    condition     = length(var.database_password) >= 24
    error_message = "Supply a generated password of at least 24 characters using TF_VAR_database_password."
  }
}
variable "cloudflare_account_id" { type = string }
variable "netlify_site_id" {
  type        = string
  description = "ID returned by bootstrap-netlify.mjs; the official provider configures existing sites."
}
variable "name_prefix" {
  type    = string
  default = "xelra"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.name_prefix))
    error_message = "Use 3-31 lowercase letters, digits or hyphens, starting with a letter."
  }
}
variable "app_hostname" {
  type    = string
  default = "xelra.dreniak.com"
  validation {
    condition     = can(regex("^[a-z0-9.-]+\\.[a-z]+$", var.app_hostname))
    error_message = "Provide a DNS hostname, without a scheme or path."
  }
}
