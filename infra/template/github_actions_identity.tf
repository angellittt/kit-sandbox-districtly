# Lets GitHub Actions authenticate to Azure via OIDC (no stored client secret/password) to
# push images to the Container Registry and deploy the App Service. See deploy-api.yml, which
# consumes this identity's client_id/tenant_id/subscription_id as the AZURE_CLIENT_ID/
# AZURE_TENANT_ID/AZURE_SUBSCRIPTION_ID secrets on the matching GitHub Environment.
resource "azurerm_user_assigned_identity" "github_actions" {
  name                = "${var.project_name}-${var.environment_name}-github-actions"
  resource_group_name = azurerm_resource_group.resource_group.name
  location            = var.location
}

# The subject scopes this credential to one specific GitHub Environment (var.github_actions_environment),
# not the whole repo or branch — this is what lets GitHub Environment approval rules actually gate
# who can assume this identity. The environment must exist on the GitHub repo (Settings > Environments)
# with the same name; GitHub auto-creates it on first workflow run if it doesn't, but with no
# protection rules, so create/configure it up front for anything beyond a dev environment.
resource "azurerm_federated_identity_credential" "github_actions" {
  name                = "${var.project_name}-${var.environment_name}-github-actions"
  resource_group_name = azurerm_resource_group.resource_group.name
  parent_id           = azurerm_user_assigned_identity.github_actions.id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = "https://token.actions.githubusercontent.com"
  subject             = "repo:${var.github_organization}/${var.github_repository}:environment:${var.github_actions_environment}"
}

resource "azurerm_role_assignment" "github_actions_acr_push" {
  scope                = azurerm_container_registry.container_registry.id
  role_definition_name = "AcrPush"
  principal_id         = azurerm_user_assigned_identity.github_actions.principal_id
}

resource "azurerm_role_assignment" "github_actions_app_service_contributor" {
  scope                = azurerm_linux_web_app.app_service.id
  role_definition_name = "Website Contributor"
  principal_id         = azurerm_user_assigned_identity.github_actions.principal_id
}
