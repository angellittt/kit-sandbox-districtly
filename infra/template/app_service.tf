resource "azurerm_service_plan" "app_service_plan" {
  name                = "${var.project_name}-${var.environment_name}-${var.globally_unique_suffix}"
  resource_group_name = azurerm_resource_group.resource_group.name
  location            = var.location
  os_type             = "Linux"
  sku_name            = var.app_service_plan_sku
}

resource "azurerm_linux_web_app" "app_service" {
  name                = "${var.project_name}-${var.environment_name}-${var.globally_unique_suffix}"
  resource_group_name = azurerm_resource_group.resource_group.name
  location            = var.location
  service_plan_id     = azurerm_service_plan.app_service_plan.id

  identity {
    type = "SystemAssigned"
  }

  site_config {
    container_registry_use_managed_identity = true
    health_check_path                       = "/api/v1/healthcheck"
    application_stack {
      docker_image_name   = "${var.project_name}:latest"
      docker_registry_url = "https://${azurerm_container_registry.container_registry.login_server}"
    }
  }

  # Always-on filesystem logging so `az webapp log tail`/Kudu have something to show
  # for debugging, independent of the optional enable_monitoring module (which streams
  # to Log Analytics instead and is off by default). Azure rotates these once the size
  # cap is hit, so this is short-lived, in-place debugging, not a durable log store.
  logs {
    application_logs {
      file_system_level = "Information"
    }
    http_logs {
      file_system {
        retention_in_days = 7
        retention_in_mb   = 35
      }
    }
  }

  app_settings = merge(
    {
      "STORAGE_ACCOUNT_NAME"   = azurerm_storage_account.storage_account.name
      "STORAGE_CONTAINER_NAME" = azurerm_storage_container.storage_container.name
      "STORAGE_BLOB_ENDPOINT"  = azurerm_storage_account.storage_account.primary_blob_endpoint
      "DOCKER_ENABLE_CI"       = true
    },
    var.enable_postgresql ? {
      "POSTGRESQL_HOST"     = azurerm_postgresql_flexible_server.postgresql[0].fqdn
      "POSTGRESQL_USER"     = var.postgresql_admin_username
      "POSTGRESQL_DB"       = var.project_name
      "POSTGRESQL_PASSWORD" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.postgresql_password[0].id})"
    } : {}
  )

  lifecycle {
    /*
    *  Only the docker image tag is ignored, since that's updated directly by the
    *  deploy pipeline (`az webapp config container set` / azure/webapps-deploy)
    *  outside of terraform. Everything else in app_settings, including the Key
    *  Vault secret references above, is terraform-managed so `terraform apply`
    *  actually keeps them in sync instead of silently drifting.
    */
    ignore_changes = [
      site_config[0].application_stack[0].docker_image_name
    ]
  }
}

resource "azurerm_role_assignment" "app_service_acr_pull" {
  scope                = azurerm_container_registry.container_registry.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_linux_web_app.app_service.identity[0].principal_id
}

resource "azurerm_role_assignment" "app_service_key_vault_secrets" {
  scope                = azurerm_key_vault.key_vault.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_web_app.app_service.identity[0].principal_id
}
