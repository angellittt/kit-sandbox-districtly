# OPTIONAL MODULE — disabled by default (var.enable_transactional_email = false).
#
# Provisions Azure Communication Services for sending transactional email (e.g.
# password resets, notifications) from a custom domain you already own. Domain
# verification (SPF/DKIM DNS records + polling Azure until they verify) lives in
# dns.tf and scripts/verify_email_domain.sh.
#
# Enable by setting enable_transactional_email = true, plus email_domain,
# dns_zone_name, and dns_resource_group_name, in your environment's module call
# (see infra/main.tf). Requires an Azure DNS zone for the domain to already exist
# — this module doesn't provision one.

resource "azurerm_email_communication_service" "email_communication_service" {
  count               = var.enable_transactional_email ? 1 : 0
  name                = "${var.project_name}-${var.environment_name}"
  resource_group_name = azurerm_resource_group.resource_group.name
  data_location       = var.communication_service_data_location
}

resource "azurerm_email_communication_service_domain" "email_domain" {
  count             = var.enable_transactional_email ? 1 : 0
  name              = var.email_domain
  email_service_id  = azurerm_email_communication_service.email_communication_service[0].id
  domain_management = "CustomerManaged"
}

resource "azurerm_communication_service" "communication_service" {
  count               = var.enable_transactional_email ? 1 : 0
  name                = "${var.project_name}-${var.environment_name}"
  resource_group_name = azurerm_resource_group.resource_group.name
  data_location       = var.communication_service_data_location
}
