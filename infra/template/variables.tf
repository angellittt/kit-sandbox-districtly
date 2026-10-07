# Keeping env names short to avoid hitting resource name length limits when combined with project_name and random suffix
variable "environment_name" {
  description = "The environment to deploy to (prod, dev, qa, stg)"
  type        = string

  validation {
    condition     = contains(["prod", "dev", "qa", "stg"], var.environment_name)
    error_message = "environment_name must be one of: prod, dev, qa, stg."
  }
}

variable "subscription_id" {
  description = "Azure subscription ID where resources will be created"
  type        = string
}

variable "project_name" {
  description = "Name of the project/client, used for naming resources (3-24 chars, lowercase letters and numbers only)"
  type        = string
}

variable "location" {
  description = "Azure location where resources will be created"
  type        = string
}

variable "swa_location" {
  description = "Azure location for the Static Web App"
  type        = string
  default     = "westus2"

  validation {
    condition     = contains(["westus2", "centralus", "eastus2", "westeurope", "eastasia"], var.swa_location)
    error_message = "swa_location is only available on: westus2, centralus, eastus2, westeurope, eastasia."
  }
}

variable "key_vault_sku_name" {
  description = "SKU name for the Azure Key Vault (standard or premium)"
  type        = string
  default     = "standard"

  validation {
    condition     = contains(["standard", "premium"], var.key_vault_sku_name)
    error_message = "key_vault_sku_name must be one of: standard, premium."
  }
}

variable "container_registry_sku" {
  description = "SKU for the Azure Container Registry (Basic, Standard, Premium)"
  type        = string
  default     = "Basic"

  validation {
    condition     = contains(["Basic", "Standard", "Premium"], var.container_registry_sku)
    error_message = "container_registry_sku must be one of: Basic, Standard, Premium."
  }
}

variable "key_vault_administrators" {
  description = "List of email addresses for Key Vault administrators"
  type        = list(string)
  validation {
    condition     = alltrue([for email in var.key_vault_administrators : can(regex("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$", email))])
    error_message = "Each administrator must be a valid email address."
  }
}

variable "key_vault_developers" {
  description = "List of email addresses for Key Vault developers"
  type        = list(string)
  validation {
    condition     = alltrue([for email in var.key_vault_developers : can(regex("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$", email))])
    error_message = "Each developer must be a valid email address."
  }
}

variable "terraform_runner_object_ids" {
  description = "Object IDs of every identity that runs terraform apply (e.g. the CI service principal and any admins who apply by hand). With Postgres on, each gets Key Vault Secrets Officer on the vault. Empty means only whoever is running Terraform right now."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for id in var.terraform_runner_object_ids : can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", id))])
    error_message = "Each runner must be an Azure AD object ID (a GUID)."
  }
}

variable "globally_unique_suffix" {
  description = "A short string that can be used in resources that need a property that must be globally unique"
  type        = string
  default     = "ttt"
}

variable "enable_postgresql" {
  description = "Whether to provision the PostgreSQL Flexible Server and related configuration"
  type        = bool
  default     = true
}

variable "postgresql_admin_username" {
  description = "Administrator username for the PostgreSQL Flexible Server"
  type        = string
  default     = "psqladmin"
}

variable "postgresql_sku_name" {
  description = "SKU name for the PostgreSQL Flexible Server"
  type        = string
  default     = "B_Standard_B1ms"
}

variable "postgresql_version" {
  description = "PostgreSQL version"
  type        = string
  default     = "16" # Postgresql 17 and 18 are still not supported 
}

variable "postgresql_storage_mb" {
  description = "Storage size in MB for the PostgreSQL Flexible Server"
  type        = number
  default     = 32768
}

variable "app_service_plan_sku" {
  description = "SKU name for the App Service Plan (e.g. B1, B2, P1v2)"
  type        = string
  default     = "B1"
}

variable "storage_account_replication_type" {
  description = "Replication type for the Storage Account (LRS, GRS, RAGRS, ZRS)"
  type        = string
  default     = "LRS"

  validation {
    condition     = contains(["LRS", "GRS", "RAGRS", "ZRS"], var.storage_account_replication_type)
    error_message = "storage_account_replication_type must be one of: LRS, GRS, RAGRS, ZRS."
  }
}

variable "storage_container_name" {
  description = "Name of the blob storage container"
  type        = string
  default     = "uploads"
}

# --- GitHub Actions OIDC deploy identity (see github_actions_identity.tf) ---

variable "github_organization" {
  description = "GitHub organization or user that owns the repository, used to scope the OIDC federated credential's trust subject"
  type        = string
}

variable "github_repository" {
  description = "GitHub repository name (without the org prefix), used to scope the OIDC federated credential's trust subject"
  type        = string
}

variable "github_actions_environment" {
  description = "Name of the GitHub Environment (Settings > Environments) that this Azure environment's deploy workflows run under. Must match the `environment:` value the deploy workflows resolve to for this environment_name."
  type        = string
}

# --- Optional monitoring/alerting module (see monitoring.tf) ---

variable "enable_monitoring" {
  description = "Whether to provision the Log Analytics/Application Insights monitoring module (diagnostic settings, exception-spike alerts, synthetic availability checks). Opt-in: does not block the minimum-viable template."
  type        = bool
  default     = false
}

variable "alert_notification_emails" {
  description = "Email addresses that receive unhandled-exception and availability alert notifications (kept independent of key_vault_administrators/key_vault_developers). Required when enable_monitoring is true."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for email in var.alert_notification_emails : can(regex("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$", email))])
    error_message = "Each notification address must be a valid email address."
  }
}

variable "exception_alert_threshold" {
  description = "Number of unhandled exceptions in the 5-minute window that triggers the exception-spike alert"
  type        = number
  default     = 5
}

variable "log_analytics_daily_quota_gb" {
  description = "Daily ingestion cap for the Log Analytics workspace in GB. Bounds cost if an app sprays exceptions in a loop. Set to -1 for unlimited (prod)."
  type        = number
  default     = 1
}

# --- Optional transactional email module (see communication.tf, dns.tf) ---

variable "enable_transactional_email" {
  description = "Whether to provision Azure Communication Services for sending transactional email, with domain verification (SPF/DKIM). Opt-in: does not block the minimum-viable template."
  type        = bool
  default     = false
}

variable "email_domain" {
  description = "Custom email domain for Azure Communication Services (e.g. mail.dev.example.com). Must be a subdomain of dns_zone_name, not the zone apex (e.g. not example.com itself); the DNS record name derivation in dns.tf doesn't support apex domains. Required when enable_transactional_email is true."
  type        = string
  default     = ""
}

variable "dns_zone_name" {
  description = "Azure DNS zone name for the domain, used to create email verification DNS records. Required when enable_transactional_email is true; the zone must already exist."
  type        = string
  default     = ""
}

variable "dns_resource_group_name" {
  description = "Resource group holding the Azure DNS zone. Required when enable_transactional_email is true."
  type        = string
  default     = ""
}

variable "communication_service_data_location" {
  description = "Data residency region for Azure Communication Services (e.g. \"United States\", \"Europe\", \"Canada\") — see azurerm_communication_service docs for the full list of valid values."
  type        = string
  default     = "United States"
}
