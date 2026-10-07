
data "azurerm_client_config" "current" {}

resource "azurerm_resource_group" "resource_group" {
  name     = "${var.project_name}_${var.environment_name}"
  location = var.location
}

