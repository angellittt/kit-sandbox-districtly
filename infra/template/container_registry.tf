resource "azurerm_container_registry" "container_registry" {
  name                = "${var.project_name}${var.environment_name}${var.globally_unique_suffix}"
  resource_group_name = azurerm_resource_group.resource_group.name
  location            = var.location
  sku                 = var.container_registry_sku
  admin_enabled       = false
}
