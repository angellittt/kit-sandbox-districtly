# Offline tests (mocked providers, plan only) for the Key Vault access the
# identity running Terraform needs to write the Postgres password secret.
# Runs from infra/ so the providers match the root pins.
# Run with: pnpm terraform:test

mock_provider "azurerm" {}
mock_provider "azuread" {}
mock_provider "random" {}
mock_provider "null" {}

override_data {
  target = data.azurerm_client_config.current
  values = {
    object_id = "00000000-0000-0000-0000-00000000aaaa"
    tenant_id = "00000000-0000-0000-0000-00000000cccc"
  }
}

override_data {
  target = data.azuread_users.developers
  values = {
    object_ids = ["00000000-0000-0000-0000-00000000dddd"]
  }
}

override_data {
  target = data.azuread_users.admins
  values = {
    object_ids = []
  }
}

variables {
  environment_name           = "dev"
  subscription_id            = "00000000-0000-0000-0000-000000000000"
  project_name               = "example"
  location                   = "westus2"
  swa_location               = "westus2"
  key_vault_administrators   = []
  key_vault_developers       = ["dev@example.com"]
  github_organization        = "example-org"
  github_repository          = "example-repo"
  github_actions_environment = "develop"
  enable_postgresql          = true
}

run "runner_gets_secrets_officer_when_postgres_enabled" {
  command = plan

  module {
    source = "./template"
  }

  assert {
    condition     = length(azurerm_role_assignment.terraform_runner_secrets_officer) == 1
    error_message = "The runner should get its own vault role when Postgres is enabled."
  }

  assert {
    condition     = azurerm_role_assignment.terraform_runner_secrets_officer["00000000-0000-0000-0000-00000000aaaa"].role_definition_name == "Key Vault Secrets Officer"
    error_message = "The runner needs Key Vault Secrets Officer to write secrets on an RBAC vault."
  }

  assert {
    condition     = azurerm_role_assignment.terraform_runner_secrets_officer["00000000-0000-0000-0000-00000000aaaa"].principal_id == "00000000-0000-0000-0000-00000000aaaa"
    error_message = "With no declared runners, the role must go to the identity running Terraform."
  }

  assert {
    condition     = length(null_resource.key_vault_rbac_propagation) == 1
    error_message = "The secret write should wait for RBAC to propagate."
  }
}

run "no_runner_role_without_postgres" {
  command = plan

  module {
    source = "./template"
  }

  variables {
    enable_postgresql = false
  }

  assert {
    condition     = length(azurerm_role_assignment.terraform_runner_secrets_officer) == 0
    error_message = "No extra vault role is needed when Postgres is off."
  }

  assert {
    condition     = length(null_resource.key_vault_rbac_propagation) == 0
    error_message = "No sleep is needed when Postgres is off."
  }
}

# A runner listed in key_vault_developers already gets Secrets Officer from
# developers_secrets_role. A second, identical assignment would fail with
# RoleAssignmentExists (409), so the runner one is skipped.
run "no_duplicate_role_when_runner_is_a_developer" {
  command = plan

  module {
    source = "./template"
  }

  override_data {
    target = data.azuread_users.developers
    values = {
      object_ids = ["00000000-0000-0000-0000-00000000aaaa"]
    }
  }

  assert {
    condition     = length(azurerm_role_assignment.terraform_runner_secrets_officer) == 0
    error_message = "The runner already has Secrets Officer as a developer."
  }

  assert {
    condition     = length(null_resource.key_vault_rbac_propagation) == 1
    error_message = "The developer role assignment still needs time to propagate."
  }
}

# With terraform_runner_object_ids set, the grant goes to that fixed list, not
# to whoever is applying, so a second runner doesn't take the role away from
# the first. Listed developers are still skipped.
run "declared_runners_get_a_stable_grant" {
  command = plan

  module {
    source = "./template"
  }

  variables {
    terraform_runner_object_ids = [
      "00000000-0000-0000-0000-00000000bbbb",
      "00000000-0000-0000-0000-00000000dddd",
    ]
  }

  assert {
    condition     = keys(azurerm_role_assignment.terraform_runner_secrets_officer) == ["00000000-0000-0000-0000-00000000bbbb"]
    error_message = "Only the declared runners who aren't developers should get the role, and not the current caller."
  }

  assert {
    condition     = null_resource.key_vault_rbac_propagation[0].triggers.runners == "00000000-0000-0000-0000-00000000bbbb"
    error_message = "The declared runners should be part of the check's triggers."
  }
}

# The access check must rerun when the vault's role holders change, so a role
# granted on a later apply also gets waited on.
run "access_check_reruns_when_role_holders_change" {
  command = plan

  module {
    source = "./template"
  }

  assert {
    condition     = null_resource.key_vault_rbac_propagation[0].triggers.runners == "00000000-0000-0000-0000-00000000aaaa"
    error_message = "The runner's role assignment should be part of the check's triggers."
  }

  assert {
    condition     = null_resource.key_vault_rbac_propagation[0].triggers.developers == "00000000-0000-0000-0000-00000000dddd"
    error_message = "Developer role assignments should be part of the check's triggers."
  }
}

# Object IDs are GUIDs, and the same GUID can be written in upper or lower
# case. A runner that is also a developer must still be skipped when the two
# IDs differ only in case, and case-only duplicates must collapse to one grant.
run "runner_ids_are_compared_without_case" {
  command = plan

  module {
    source = "./template"
  }

  variables {
    terraform_runner_object_ids = [
      "00000000-0000-0000-0000-00000000BBBB",
      "00000000-0000-0000-0000-00000000bbbb",
      "00000000-0000-0000-0000-00000000DDDD",
    ]
  }

  assert {
    condition     = keys(azurerm_role_assignment.terraform_runner_secrets_officer) == ["00000000-0000-0000-0000-00000000bbbb"]
    error_message = "Runner IDs should be lowercased, deduplicated, and matched against developers without case."
  }
}

# Two runners can share a fixed terraform_runner_object_ids list, so the role
# holders don't change between their applies. The check must still rerun when
# a different identity applies, since that identity's role may not be live yet.
run "access_check_reruns_when_caller_changes" {
  command = plan

  module {
    source = "./template"
  }

  assert {
    condition     = null_resource.key_vault_rbac_propagation[0].triggers.caller == "00000000-0000-0000-0000-00000000aaaa"
    error_message = "The identity running Terraform should be part of the check's triggers."
  }
}
