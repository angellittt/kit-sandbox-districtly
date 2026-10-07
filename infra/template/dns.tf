# Part of the OPTIONAL transactional-email module — see communication.tf.
# Creates the DNS records Azure Communication Services needs to verify domain
# ownership (a TXT record for domain+SPF, two CNAME records for DKIM), then
# triggers and polls verification via scripts/verify_email_domain.sh.

locals {
  # one() on a splat is safe whether or not the domain resource exists (count=0
  # or 1) — returns null when disabled instead of erroring on a [0] index.
  vr = one(azurerm_email_communication_service_domain.email_domain[*].verification_records[0])

  # var.email_domain (e.g. "mail.dev.example.com") as a name relative to the zone
  # (e.g. "mail.dev"), which is what azurerm_dns_* records expect.
  relative_domain = trimsuffix(trimsuffix(var.email_domain, "."), ".${var.dns_zone_name}")
}

resource "azurerm_dns_txt_record" "email_verification" {
  count               = var.enable_transactional_email ? 1 : 0
  name                = local.relative_domain
  zone_name           = var.dns_zone_name
  resource_group_name = var.dns_resource_group_name
  ttl                 = 3600

  record {
    value = local.vr.domain[0].value
  }
  record {
    value = local.vr.spf[0].value
  }
}

resource "azurerm_dns_cname_record" "dkim" {
  count               = var.enable_transactional_email ? 1 : 0
  name                = "selector1-azurecomm-prod-net._domainkey.${local.relative_domain}"
  zone_name           = var.dns_zone_name
  resource_group_name = var.dns_resource_group_name
  ttl                 = 3600
  record              = local.vr.dkim[0].value
}

resource "azurerm_dns_cname_record" "dkim2" {
  count               = var.enable_transactional_email ? 1 : 0
  name                = "selector2-azurecomm-prod-net._domainkey.${local.relative_domain}"
  zone_name           = var.dns_zone_name
  resource_group_name = var.dns_resource_group_name
  ttl                 = 3600
  record              = local.vr.dkim2[0].value
}

# Triggers verification for each DNS record type via the Azure CLI after the DNS records are
# created. Polls for up to 6 minutes (36 x 10s) and exits with a warning rather than a hard
# failure if verification hasn't completed, since propagation can occasionally lag. The
# association resource below depends on this so it only runs once DNS is verified.
# If you need to rerun this script, you can use terraform taint on this resource and tf apply again
resource "null_resource" "email_domain_verification" {
  count = var.enable_transactional_email ? 1 : 0

  triggers = {
    email_domain_id = azurerm_email_communication_service_domain.email_domain[0].id
  }

  provisioner "local-exec" {
    command = "${path.module}/scripts/verify_email_domain.sh '${azurerm_email_communication_service_domain.email_domain[0].id}'"
  }

  depends_on = [
    azurerm_dns_txt_record.email_verification,
    azurerm_dns_cname_record.dkim,
    azurerm_dns_cname_record.dkim2,
  ]
}

resource "azurerm_communication_service_email_domain_association" "email_domain_association" {
  count                    = var.enable_transactional_email ? 1 : 0
  communication_service_id = azurerm_communication_service.communication_service[0].id
  email_service_domain_id  = azurerm_email_communication_service_domain.email_domain[0].id

  depends_on = [null_resource.email_domain_verification]
}
