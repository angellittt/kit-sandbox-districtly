resource "random_password" "postgresql_administrator_password" {
  length           = 16
  special          = true
  override_special = "!@#%&*_-"
  min_upper        = 1
  min_lower        = 1
  min_numeric      = 1
  min_special      = 1
}

resource "azurerm_postgresql_flexible_server" "postgresql" {
  count                  = var.enable_postgresql ? 1 : 0
  name                   = "${var.project_name}-${var.environment_name}-${var.globally_unique_suffix}"
  resource_group_name    = azurerm_resource_group.resource_group.name
  location               = var.location
  version                = var.postgresql_version
  administrator_login    = var.postgresql_admin_username
  administrator_password = random_password.postgresql_administrator_password.result
  sku_name               = var.postgresql_sku_name
  storage_mb             = var.postgresql_storage_mb
}


resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_azure_services" {
  count            = var.enable_postgresql ? 1 : 0
  name             = "allow-azure-services"
  server_id        = azurerm_postgresql_flexible_server.postgresql[0].id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# Stored so the App Service can read it via a Key Vault reference
# (@Microsoft.KeyVault(SecretUri=...)) in app_service.tf instead of the
# plaintext administrator_password landing directly in app_settings.
resource "azurerm_key_vault_secret" "postgresql_password" {
  count        = var.enable_postgresql ? 1 : 0
  name         = "POSTGRESQL-PASSWORD"
  value        = random_password.postgresql_administrator_password.result
  key_vault_id = azurerm_key_vault.key_vault.id

  # Wait until the runner's vault role has propagated (key_vault.tf).
  depends_on = [null_resource.key_vault_rbac_propagation]
}
