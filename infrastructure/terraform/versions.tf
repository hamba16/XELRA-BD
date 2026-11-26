terraform {
  required_version = ">= 1.10.0, < 2.0.0"
  required_providers {
    supabase = {
      source  = "supabase/supabase"
      version = "1.11.1"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.29.0"
    }
    netlify = {
      source  = "netlify/netlify"
      version = "0.4.4"
    }
  }
  # Supply an encrypted, access-controlled S3 backend at init; never commit state.
  backend "s3" {}
}
provider "supabase" {}   # SUPABASE_ACCESS_TOKEN
provider "cloudflare" {} # CLOUDFLARE_API_TOKEN
provider "netlify" {}    # NETLIFY_TOKEN
