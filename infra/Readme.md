# Infrastructure

## Prerequisites

- Install terraform by following their [installation steps](https://developer.hashicorp.com/terraform/install).
- Install azure cli by following their [installation steps](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli?view=azure-cli-latest)
- Make sure your azure user has all required permissions (or ask an admin for them).
  - With `enable_postgresql = true`, Terraform writes the Postgres admin password into each environment's Key Vault. The vault uses RBAC, and Contributor or Owner can't write secrets there, so Terraform gives every identity that runs it **Key Vault Secrets Officer** on each env's vault. That means the runner must be allowed to create role assignments (Owner, User Access Administrator, or Role Based Access Control Administrator). Anyone already in `key_vault_developers` keeps that assignment and no new one is added.
  - List the object ID of each identity that runs `terraform apply` (the CI service principal, plus anyone who applies by hand) in `terraform_runner_object_ids`. If you leave it empty, the role goes to whoever ran the last apply, so a second runner takes it away from the first, and the first one's next plan fails with a 403. Get an object ID with `az ad signed-in-user show --query id -o tsv` (users) or `az ad sp show --id <app-id> --query id -o tsv` (service principals).
- Make sure you have a valid subscription id or ask for one. See these [docs on how to find yours](https://learn.microsoft.com/en-us/azure/azure-portal/get-subscription-tenant-id).

## Getting started

If this is the first time you will interact with the project, please run `./setup.sh`.
This script will automatically push the terraform state to Azure by creating a resource group, a storage account, a storage container for you.

You only need to execute this script once. After doing so, you can execute `terraform plan`, `terraform apply`, or `terraform destroy` as you would normally do in any terraform project.

## Resources

The infrastructure is defined in `main.tf` using the `./template` module per environment. The template contains:

| Resource                        | Purpose                                                                                  | Connections                                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resource Group**              | Container for all environment resources                                                  | Parent of all resources                                                                                                                                                                 |
| **Container Registry**          | Stores Docker images for the app                                                         | App Service pulls images from it via managed identity (AcrPull role)                                                                                                                    |
| **App Service Plan**            | Compute plan for the web app                                                             | Hosts the App Service                                                                                                                                                                   |
| **App Service**                 | Runs the application as a Docker container                                               | Pulls images from Container Registry; reads secrets from Key Vault; writes files to Storage; optionally connects to PostgreSQL                                                          |
| **Key Vault**                   | Stores secrets and credentials                                                           | App Service has Key Vault Secrets User role; admins/developers assigned via RBAC                                                                                                        |
| **Storage Account + Container** | Blob storage for file uploads                                                            | App Service has Storage Blob Data Contributor role; connection info injected as app settings                                                                                            |
| **PostgreSQL Flexible Server**  | Managed PostgreSQL database (optional)                                                   | Firewall rule allows Azure services; connection info injected as app settings on App Service                                                                                            |
| **GitHub Actions identity**     | Managed identity + OIDC federated credential, used to deploy without any stored password | Scoped to one GitHub Environment; AcrPush on Container Registry + Website Contributor on App Service (see [`template/github_actions_identity.tf`](template/github_actions_identity.tf)) |

PostgreSQL provisioning is controlled by the `enable_postgresql` variable (default: `false`).

With Postgres on, Terraform waits before writing the password secret until the runner's Key Vault role has taken effect. It checks the vault with the Azure CLI every 10 seconds, for up to 10 minutes, by writing a disabled secret named `terraform-rbac-probe` (left in the vault on purpose; safe to ignore), so `az` must be on your PATH and logged in as the same identity Terraform runs as. The check stops right away, with az's own error, if az is missing, its login has expired, it is signed in as a different identity than Terraform, or it hits any error other than a 403. The check runs on the first apply and again whenever the vault's role holders or the identity running Terraform change. If it times out, run `terraform apply` again.

If someone else later runs Terraform against an existing environment, they need read access to the vault's secrets too, since Terraform reads the password secret back on every plan. Add them to `key_vault_developers` (or `key_vault_administrators`).

## Tests

`pnpm terraform:test` runs `terraform test` in `infra/`. The tests use mocked providers and `plan` only, so they need no Azure login and never create anything. It also reads `terraform graph` to check that the Postgres password secret still waits for the Key Vault access check, since `terraform test` can't see `depends_on`.

## Deploying via GitHub Actions

[`.github/workflows/deploy-api.yml`](../.github/workflows/deploy-api.yml) and [`.github/workflows/fe-web-deployment.yml`](../.github/workflows/fe-web-deployment.yml) deploy on push to `develop`/`qa`/`staging`/`main` (mapped 1:1 to GitHub Environments `develop`/`qa`/`staging`/`production`), or on demand via `workflow_dispatch`.

Each Azure environment provisioned by a `./template` module call needs a matching GitHub Environment (repo Settings > Environments, same name as that module's `github_actions_environment` variable) configured with:

| Name                              | Kind   | Source                                                                                                            |
| --------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `AZURE_CLIENT_ID`                 | secret | `github_actions_identity_client_id` output                                                                        |
| `AZURE_TENANT_ID`                 | secret | `github_actions_identity_tenant_id` output                                                                        |
| `AZURE_SUBSCRIPTION_ID`           | secret | `github_actions_identity_subscription_id` output                                                                  |
| `ACR_NAME`                        | var    | `container_registry_name` output                                                                                  |
| `APP_SERVICE_NAME`                | var    | `app_service_name` output                                                                                         |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | secret | Static Web App's deployment token — `az staticwebapp secrets list --name <name> --query properties.apiKey -o tsv` |
| `VITE_API_BASE_URL`               | secret | Whatever base URL the web app should call for that environment                                                    |

No default database migration step is wired into `deploy-api.yml` — this template ships no ORM/migration tool by default, so a commented-out placeholder step is left for whichever tool a project adds.

## Optional modules

These modules are opt-in and off by default, so they don't block a minimum-viable deployment of the template. Enable them per-environment in `main.tf` once a project actually needs them.

| Module                  | Resources                                                                                                                                                             | Enabled by                                                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Monitoring/alerting** | Log Analytics workspace, 2x Application Insights (api/web), diagnostic settings, exception-spike alerts, health-check alert, 3-location synthetic availability checks | `enable_monitoring = true` + `alert_notification_emails` (see [`template/monitoring.tf`](template/monitoring.tf) and [`../MONITORING.md`](../MONITORING.md))                                             |
| **Transactional email** | Azure Communication Services + custom email domain, with SPF/DKIM verification DNS records and a poll-and-wait verification script                                    | `enable_transactional_email = true` + `email_domain`, `dns_zone_name`, `dns_resource_group_name` (see [`template/communication.tf`](template/communication.tf) and [`template/dns.tf`](template/dns.tf)) |

The transactional email module assumes the project's domain already has an Azure DNS zone — it doesn't provision one.

## Applying changes per environment

Environments are defined as separate module calls in `main.tf`. To apply changes to a specific environment, use `-target`:

```bash
# Plan changes for a specific environment
terraform plan -target=module.dev_environment

# Apply changes to a specific environment
terraform apply -target=module.dev_environment
```

To apply all environments at once:

```bash
terraform apply
```

## Destroying infrastructure per environment

To destroy a specific environment's resources:

```bash
terraform destroy -target=module.dev_environment
```

To destroy all environments:

```bash
terraform destroy
```

> **Warning:** Destroying will permanently delete all resources including databases and storage. Make sure to back up any important data first.

## Using terraform output

Outputs are marked sensitive and must be accessed explicitly. To view all outputs for an environment:

```bash
terraform output -json dev_env_outputs
```

To access a specific nested value:

```bash
terraform output -json dev_env_outputs | jq '.app_service_default_hostname'
```
