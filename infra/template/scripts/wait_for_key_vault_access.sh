#!/usr/bin/env bash
# Waits until the identity logged into the Azure CLI can write a Key Vault's
# secrets. Azure RBAC role assignments can take several minutes to take
# effect, and until then secret calls return 403.
#
# The check writes a disabled probe secret (terraform-rbac-probe), because
# reading or listing secrets also works with read-only roles like Key Vault
# Secrets User. Each check adds a version to that one secret. It is left in
# the vault on purpose: deleting it would soft-delete it, and the next check
# could not write it again until the soft-delete is purged.
#
# First checks the CLI is signed in as the identity Terraform runs as, since
# that is the one that writes the secret. A mismatch fails right away.
#
# Polls for up to 10 minutes (60 x 10s). Needs 2 successful checks in a row,
# since a new role can be live on one Azure node before the others. Only a
# 403 counts as "not live yet"; any other az error stops at once with az's
# own message (missing az, expired login, wrong tenant, network).
#
# Usage:
#   ./wait_for_key_vault_access.sh <key-vault-name> <expected-object-id>
#
# Re-run after a failed terraform apply (taint the resource first):
#   terraform taint 'module.<env>_environment.null_resource.key_vault_rbac_propagation[0]'
#   terraform apply
#
# Exit codes:
#   0  Access works
#   1  Still no access after 10 minutes, az error, or identity mismatch

set -euo pipefail

VAULT_NAME="${1:?Usage: $0 <key-vault-name> <expected-object-id>}"
EXPECTED_OID="${2:?Usage: $0 <key-vault-name> <expected-object-id>}"
REQUIRED_SUCCESSES=2
PROBE_SECRET=terraform-rbac-probe
successes=0

if ! command -v az > /dev/null; then
  echo "Error: the Azure CLI (az) is not on PATH. It is needed to check Key Vault access." >&2
  exit 1
fi

# The token's oid claim is the object id of whoever az is signed in as.
if ! token=$(az account get-access-token --resource https://vault.azure.net --query accessToken -o tsv 2>&1); then
  echo "Error: could not get a Key Vault token from az: $token" >&2
  exit 1
fi
payload=$(cut -d. -f2 <<< "$token" | tr '_-' '/+')
while [ $((${#payload} % 4)) -ne 0 ]; do payload="$payload="; done
oid=$(base64 -d <<< "$payload" 2> /dev/null | sed -n 's/.*"oid":"\([^"]*\)".*/\1/p')
if [ "$(tr '[:upper:]' '[:lower:]' <<< "$oid")" != "$(tr '[:upper:]' '[:lower:]' <<< "$EXPECTED_OID")" ]; then
  echo "Error: az is signed in as '${oid:-unknown}', but Terraform runs as '$EXPECTED_OID'. Sign az in as the Terraform identity and re-run apply." >&2
  exit 1
fi

for i in $(seq 1 60); do
  if err=$(az keyvault secret set --vault-name "$VAULT_NAME" --name "$PROBE_SECRET" --value probe --disabled true \
    --tags purpose=terraform-rbac-check -o none 2>&1); then
    successes=$((successes + 1))
    echo "[$i/60] Key Vault write access OK ($successes/$REQUIRED_SUCCESSES)"
    if [ "$successes" -ge "$REQUIRED_SUCCESSES" ]; then
      exit 0
    fi
  elif grep -qiE 'forbidden|403' <<< "$err"; then
    successes=0
    echo "[$i/60] Waiting for Key Vault role to take effect"
  else
    echo "Error: az could not reach Key Vault $VAULT_NAME: $err" >&2
    exit 1
  fi
  sleep 10
done

echo "Error: no access to Key Vault $VAULT_NAME after 10 minutes. Re-run apply once the role has taken effect." >&2
exit 1
