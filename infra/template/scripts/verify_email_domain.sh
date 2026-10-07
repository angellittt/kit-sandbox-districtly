#!/usr/bin/env bash
# Initiates Azure Email Communication domain verification and polls until all DNS record types
# (Domain, DKIM, DKIM2, SPF) are verified or the timeout is reached.
#
# Usage:
#   ./verify_email_domain.sh <azure-resource-id>
#
# Arguments:
#   <azure-resource-id>  Full Azure resource ID of the email domain, e.g.:
#     /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Communication/emailServices/<svc>/domains/<domain>
#
# Examples:
#   # Run directly
#   ./verify_email_domain.sh "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-rg/providers/Microsoft.Communication/emailServices/my-svc/domains/my-domain.com"
#
#   # Re-run after a failed terraform apply (taint the resource first):
#   terraform taint 'null_resource.email_domain_verification'
#   terraform apply
#
# Exit codes:
#   0  All records verified
#   1  Timed out after 6 minutes; re-run after DNS propagates

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

fmt_status() {
  if [ "$1" = "Verified" ]; then
    printf "${GREEN}✓${RESET}"
  else
    printf "${YELLOW}${1:-pending}${RESET}"
  fi
}

DOMAIN_ID="${1:?Usage: $0 <azure-resource-id>}"

for vtype in Domain DKIM DKIM2 SPF; do
  az resource invoke-action \
    --ids "$DOMAIN_ID" \
    --action initiateVerification \
    --request-body "{\"verificationType\":\"$vtype\"}" \
    --no-wait 2>/dev/null || true
done

for i in $(seq 1 36); do
  states=$(az resource show \
    --ids "$DOMAIN_ID" \
    --query "properties.verificationStates" \
    -o json 2>/dev/null)
  domain=$(echo "$states" | jq -r '.Domain.status // empty')
  dkim=$(echo   "$states" | jq -r '.DKIM.status // empty')
  dkim2=$(echo  "$states" | jq -r '.DKIM2.status // empty')
  spf=$(echo    "$states" | jq -r '.SPF.status // empty')
  printf "[%d/36]  Domain $(fmt_status "$domain")  DKIM $(fmt_status "$dkim")  DKIM2 $(fmt_status "$dkim2")  SPF $(fmt_status "$spf")\n" "$i"
  if [ "$domain" = "Verified" ] && [ "$dkim" = "Verified" ] && [ "$dkim2" = "Verified" ] && [ "$spf" = "Verified" ]; then
    printf "${GREEN}All records verified${RESET}\n"
    exit 0
  fi
  sleep 10
done

echo "Error: domain did not verify within 6 minutes. Re-run apply after DNS propagates."
exit 1
