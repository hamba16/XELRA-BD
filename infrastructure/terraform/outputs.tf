output "supabase_project_ref" { value = supabase_project.production.id }
output "supabase_url" { value = "https://${supabase_project.production.id}.supabase.co" }
output "r2_endpoint" { value = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com" }
output "r2_buckets" { value = { for k, v in cloudflare_r2_bucket.private : k => v.name } }
output "standby_hostname" { value = cloudflare_pages_project.standby.subdomain }
output "primary_hostname" { value = cloudflare_pages_project.standby.subdomain }
output "netlify_site_id" { value = var.netlify_site_id }
output "standby_domain_status" { value = cloudflare_pages_domain.standby.status }
