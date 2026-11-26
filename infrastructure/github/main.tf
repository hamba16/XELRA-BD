terraform {
  required_version = ">= 1.10.0, < 2.0.0"
  required_providers {
    github = {
      source  = "integrations/github"
      version = "6.13.0"
    }
  }
  backend "s3" {}
}
variable "github_owner" { type = string }
variable "repository_name" {
  type    = string
  default = "XELRA"
}
provider "github" { owner = var.github_owner } # GITHUB_TOKEN environment only.
resource "github_repository" "app" {
  name                   = var.repository_name
  description            = "Dreniak operations platform"
  visibility             = "private"
  has_issues             = true
  has_wiki               = false
  has_projects           = false
  allow_merge_commit     = false
  allow_rebase_merge     = false
  allow_squash_merge     = true
  delete_branch_on_merge = true
  lifecycle { prevent_destroy = true }
}
resource "github_repository_vulnerability_alerts" "app" {
  repository = github_repository.app.name
  enabled    = true
}
resource "github_actions_repository_permissions" "app" {
  repository      = github_repository.app.name
  allowed_actions = "selected"
  enabled         = true
  allowed_actions_config {
    github_owned_allowed = true
    verified_allowed     = true
    patterns_allowed     = ["supabase/setup-cli@*"]
  }
}
resource "github_actions_variable" "operations_disabled" {
  repository    = github_repository.app.name
  variable_name = "INFRA_OPERATIONS_ENABLED"
  value         = "false"
  lifecycle { ignore_changes = [value] }
}
resource "github_actions_variable" "release_disabled" {
  repository    = github_repository.app.name
  variable_name = "APP_RELEASE_ENABLED"
  value         = "false"
  lifecycle { ignore_changes = [value] }
}
output "repository_url" { value = github_repository.app.html_url }
