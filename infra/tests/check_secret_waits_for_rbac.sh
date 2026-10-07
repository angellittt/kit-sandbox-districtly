#!/usr/bin/env bash
# terraform test can't see depends_on, so this checks the ordering the fix
# relies on: the Postgres password secret must wait for the Key Vault access
# check (key_vault.tf). Reads the dependency graph offline, after init.
# Run from the repo root: pnpm terraform:test

set -euo pipefail

edge='azurerm_key_vault_secret.postgresql_password" -> "module.dev_environment.null_resource.key_vault_rbac_propagation"'

graph=$(terraform -chdir=infra graph)
if ! grep -qF "$edge" <<< "$graph"; then
  echo "Error: the Postgres password secret no longer depends on null_resource.key_vault_rbac_propagation." >&2
  echo "Without it, a fresh apply writes the secret before the vault role is live and gets a 403." >&2
  exit 1
fi
echo "OK: the Postgres password secret waits for the Key Vault access check."
