resource "azurerm_key_vault" "key_vault" {
  name                        = "${var.project_name}-${var.environment_name}-${var.globally_unique_suffix}"
  resource_group_name         = azurerm_resource_group.resource_group.name
  location                    = var.location
  tenant_id                   = data.azurerm_client_config.current.tenant_id
  sku_name                    = var.key_vault_sku_name
  soft_delete_retention_days  = 7
  purge_protection_enabled    = false
  enable_rbac_authorization   = true
  enabled_for_disk_encryption = true

}

# Each email must match the user's Azure AD `mail` attribute exactly, and every
# listed user must exist in the tenant, otherwise this data source errors and
# fails the apply.
data "azuread_users" "developers" {
  mails = var.key_vault_developers
}
data "azuread_users" "admins" {
  mails = var.key_vault_administrators
}


# Allows admins to manage the vault and add role assignments
resource "azurerm_role_assignment" "admin_vault_role" {
  for_each             = toset(data.azuread_users.admins.object_ids)
  scope                = azurerm_key_vault.key_vault.id
  role_definition_name = "Key Vault Data Access Administrator"
  principal_id         = each.key
}
# Allow admins to read/set secrets
resource "azurerm_role_assignment" "admin_vault_secrets_role" {
  for_each             = toset(data.azuread_users.admins.object_ids)
  scope                = azurerm_key_vault.key_vault.id
  role_definition_name = "Key Vault Administrator"
  principal_id         = each.key
}

# Allows all developers to read/set secrets, certificates and keys. Cannot manage key vault resources or manage role assignments
resource "azurerm_role_assignment" "developers_secrets_role" {
  for_each             = toset(data.azuread_users.developers.object_ids)
  scope                = azurerm_key_vault.key_vault.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = each.key
  depends_on           = [azurerm_role_assignment.admin_vault_role]
}

# The vault uses RBAC, so writing a secret is a data-plane action that
# Contributor and Owner don't grant. When Postgres is on, Terraform writes the
# admin password into the vault (postgresql.tf), so every identity that runs
# Terraform gets Key Vault Secrets Officer here.
#
# List those identities in terraform_runner_object_ids (e.g. the CI service
# principal plus anyone who applies by hand). Left empty, it falls back to
# whoever is running Terraform right now, so the grant moves to each new caller
# and the previous one loses it.
#
# Runners already in key_vault_developers are skipped, since that same
# assignment would fail with RoleAssignmentExists. IDs are lowercased first so
# a GUID that differs only in case still counts as the same identity.
locals {
  declared_runner_ids  = length(var.terraform_runner_object_ids) > 0 ? var.terraform_runner_object_ids : [data.azurerm_client_config.current.object_id]
  terraform_runner_ids = toset([for id in local.declared_runner_ids : lower(id)])
  developer_ids        = toset([for id in data.azuread_users.developers.object_ids : lower(id)])
}

resource "azurerm_role_assignment" "terraform_runner_secrets_officer" {
  for_each             = var.enable_postgresql ? setsubtract(local.terraform_runner_ids, local.developer_ids) : toset([])
  scope                = azurerm_key_vault.key_vault.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = each.key
}

# Azure RBAC can take several minutes to take effect, so a secret written right
# after a role assignment is created can still get a 403. A fixed sleep can be
# too short, so this polls the vault via the Azure CLI until the current runner
# can actually write secrets (see scripts/wait_for_key_vault_access.sh). The
# script first checks the CLI is signed in as the same identity as Terraform.
# The triggers rerun the check whenever the set of vault role holders or the
# identity running Terraform changes, not just on the first apply.
resource "null_resource" "key_vault_rbac_propagation" {
  count = var.enable_postgresql ? 1 : 0

  triggers = {
    key_vault_id = azurerm_key_vault.key_vault.id
    caller       = lower(data.azurerm_client_config.current.object_id)
    runners      = join(",", sort(keys(azurerm_role_assignment.terraform_runner_secrets_officer)))
    developers   = join(",", sort(keys(azurerm_role_assignment.developers_secrets_role)))
    admins       = join(",", sort(keys(azurerm_role_assignment.admin_vault_secrets_role)))
  }

  provisioner "local-exec" {
    command = "${path.module}/scripts/wait_for_key_vault_access.sh '${azurerm_key_vault.key_vault.name}' '${data.azurerm_client_config.current.object_id}'"
  }

  depends_on = [
    azurerm_role_assignment.terraform_runner_secrets_officer,
    azurerm_role_assignment.developers_secrets_role,
    azurerm_role_assignment.admin_vault_secrets_role,
  ]
}
