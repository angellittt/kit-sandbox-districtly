terraform {
  # Floor at the mise.toml pin, so a Terraform run outside mise fails fast
  # instead of applying with an older version.
  required_version = ">= 1.16"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "=4.1.0"
    }
    # Used by local-exec pollers: email domain verification
    # (infra/template/dns.tf) and Key Vault RBAC propagation before the Postgres
    # password secret is written (infra/template/key_vault.tf).
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
  # This is only required when the User, Service Principal, or Identity running Terraform lacks the permissions to register Azure Resource Providers.
  resource_provider_registrations = "none"
}

module "dev_environment" {
  source           = "./template"
  location         = var.location
  project_name     = var.project_name
  subscription_id  = var.subscription_id
  environment_name = "dev"
  swa_location     = "westus2"
  # Set to true if your app needs a postgreSQL database
  enable_postgresql = false
  # Replace with your own email addresses
  key_vault_administrators = ["juan.lopez@ttt.studio", "justin.kuan@ttt.studio"]
  key_vault_developers     = ["sunny.xue@ttt.studio"]
  # Object IDs of everyone who runs terraform apply (CI service principal,
  # admins). Used when enable_postgresql is true; see infra/Readme.md.
  terraform_runner_object_ids = []
  # Optional modules, both opt-in and off by default — see infra/Readme.md.
  # Set to true (plus their required variables) if your project needs them.
  enable_monitoring          = false
  enable_transactional_email = false
  # GitHub Actions OIDC deploy identity — scopes deploy-api.yml/fe-web-deployment.yml's
  # Azure login to this repo's "develop" GitHub Environment. See infra/Readme.md.
  github_organization        = "tttstudios"
  github_repository          = "Fullstack-starter-template"
  github_actions_environment = "develop"
}

output "dev_env_outputs" {
  value     = module.dev_environment
  sensitive = true
}
