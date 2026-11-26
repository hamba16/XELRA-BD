resource "cloudflare_r2_bucket_lifecycle" "backups" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.private["backups"].name
  rules = [for tier in [
    { prefix = "db/", seconds = 604800, name = "daily-7-days" },
    { prefix = "weekly/", seconds = 2419200, name = "weekly-4-weeks" },
    { prefix = "monthly/", seconds = 31622400, name = "monthly-12-months" }
    ] : {
    id         = tier.name
    enabled    = var.backup_retention_enabled
    conditions = { prefix = tier.prefix }
    delete_objects_transition = {
      condition = { type = "Age", max_age = tier.seconds }
    }
  }]
}
# Archives and business documents have NO expiry rule. Screenshots require an
# explicit resolved-ticket purge in a later module; age alone is not consent.
