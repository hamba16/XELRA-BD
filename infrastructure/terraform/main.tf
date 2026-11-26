resource "supabase_project" "production" {
  organization_id   = var.supabase_organization_id
  name              = var.name_prefix
  database_password = var.database_password
  region            = var.supabase_region
  lifecycle { prevent_destroy = true }
}

resource "supabase_settings" "production" {
  project_ref     = supabase_project.production.id
  ssl_enforcement = true
  api = jsonencode({
    db_schema            = "api"
    db_extra_search_path = "public,extensions"
    max_rows             = 50
  })
  auth = jsonencode({
    site_url                              = "https://${var.app_hostname}"
    uri_allow_list                        = "https://${var.app_hostname}/auth/callback/"
    disable_signup                        = true
    external_anonymous_users_enabled      = false
    jwt_exp                               = 900
    refresh_token_rotation_enabled        = true
    security_refresh_token_reuse_interval = 10
    mfa_totp_enroll_enabled               = true
    mfa_totp_verify_enabled               = true
  })
  # Azure sign-in and email delivery stay disabled until tenant/SMTP approval.
}

resource "cloudflare_r2_bucket" "private" {
  for_each      = toset(["documents", "screenshots", "archives", "backups"])
  account_id    = var.cloudflare_account_id
  name          = "${var.name_prefix}-${each.key}"
  storage_class = "Standard"
  lifecycle { prevent_destroy = true }
}

resource "cloudflare_r2_managed_domain" "private" {
  for_each    = cloudflare_r2_bucket.private
  account_id  = var.cloudflare_account_id
  bucket_name = each.value.name
  enabled     = false
}

resource "cloudflare_r2_bucket_cors" "browser" {
  for_each    = toset(["documents", "screenshots"])
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.private[each.key].name
  rules = [{
    id = "signed-browser-access"
    allowed = {
      origins = ["https://${var.app_hostname}"]
      methods = ["GET", "HEAD", "PUT"]
      headers = ["content-type", "x-amz-checksum-sha256"]
    }
    expose_headers  = ["ETag"]
    max_age_seconds = 300
  }]
}

resource "cloudflare_pages_project" "standby" {
  account_id        = var.cloudflare_account_id
  name              = "${var.name_prefix}-standby"
  production_branch = "main"
  # Primary static host. Legacy Terraform address/name retained to avoid replacement.
  # Direct upload only; the independent edge Worker is configured under workers/edge.
  lifecycle { prevent_destroy = true }
}

resource "netlify_site_build_settings" "production" {
  site_id                    = var.netlify_site_id
  build_command              = "npm run build && npm run infra:headers"
  publish_directory          = "out"
  production_branch          = "main"
  deploy_previews            = false
  branch_deploy_all_branches = false
  stop_builds                = true
}

resource "cloudflare_pages_domain" "standby" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.standby.name
  name         = var.app_hostname
  # Domain registration only. DNS ownership/validation is still manual per plan.
}

resource "netlify_site_domain_settings" "production" {
  site_id       = var.netlify_site_id
  custom_domain = var.app_hostname
}
