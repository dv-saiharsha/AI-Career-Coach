#!/usr/bin/env bash
# Alerts by email to ADMIN_EMAILS: a failed crawl, no successful crawl for
# 2 hours, the API down, and monthly spend crossing a budget. Monitoring
# itself is free at this volume; a budget only notifies, it never stops
# anything.
#
#   ./60_monitoring.sh                          # dry run
#   BUDGET_USD=50 APPLY=1 ./60_monitoring.sh    # set the budget the owner chose
source "$(dirname "$0")/lib.sh"
banner

BUDGET_USD="${BUDGET_USD:-50}"
need_components alpha beta

say "Email channel ${ADMIN_EMAILS}"
channel="$(names gc beta monitoring channels list \
  --filter="type=\"email\" AND labels.email_address=\"${ADMIN_EMAILS}\"" \
  --format='value(name)' | head -1)"
if [[ -n "${channel}" ]]; then
  echo "  exists: ${channel}"
else
  run gc beta monitoring channels create --display-name "HireLoom owner" \
    --type email --channel-labels "email_address=${ADMIN_EMAILS}"
  [[ "${APPLY}" == "1" ]] && channel="$(names gc beta monitoring channels list \
    --filter="type=\"email\" AND labels.email_address=\"${ADMIN_EMAILS}\"" --format='value(name)' | head -1)"
  channel="${channel:-<new email channel>}"
fi

policy() {  # file
  local name
  name="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["displayName"])' "$1")"
  if [[ -n "$(names gc alpha monitoring policies list --filter="displayName=\"${name}\"" --format='value(name)')" ]]; then
    echo "  exists: ${name}"
  else
    run gc alpha monitoring policies create --policy-from-file "$1" --notification-channels "${channel}"
  fi
}

say "Crawler alerts"
policy "${HERE}/monitoring/crawler-failed.json"
policy "${HERE}/monitoring/crawler-stale.json"

say "API uptime check (only once ${API_SERVICE} exists)"
api_url="$(gc run services describe "${API_SERVICE}" --region "${REGION}" --format='value(status.url)' 2>/dev/null || true)"
if [[ -z "${api_url}" ]]; then
  echo "  skipped: ${API_SERVICE} is not deployed (owner's rule); re-run this after 50_api.sh"
elif [[ -n "$(names gc monitoring uptime list-configs --filter="displayName=\"HireLoom API\"" --format='value(name)')" ]]; then
  echo "  exists: HireLoom API uptime check"
else
  # /openapi.json: public, cheap, and served only when the app booted (its
  # startup validation refuses a misconfigured production start).
  run gc monitoring uptime create "HireLoom API" --resource-type uptime-url \
    --resource-labels "host=${api_url#https://},project_id=${PROJECT_ID}" \
    --path /openapi.json --protocol https --period 5 --timeout 10
fi

say "Monthly budget (${BUDGET_USD} USD, alerts at 50/90/100%)"
billing="$(gcloud billing projects describe "${PROJECT_ID}" --format='value(billingAccountName)' 2>/dev/null)"
billing="${billing#billingAccounts/}"
budgets_api=0
grep -qx billingbudgets.googleapis.com <<<"$(gc services list --enabled --format='value(config.name)')" && budgets_api=1
if [[ "${budgets_api}" == "0" ]]; then
  run gc services enable billingbudgets.googleapis.com
fi
# Listing budgets with the API off makes gcloud prompt to enable it, which
# hangs a script; only list once it is on. </dev/null: never wait on a prompt.
if [[ "${budgets_api}" == "1" ]] && gcloud billing budgets list --billing-account "${billing}" \
     --format='value(displayName)' </dev/null 2>/dev/null | grep -qx "HireLoom monthly"; then
  echo "  exists: HireLoom monthly"
else
  run gcloud billing budgets create --billing-account "${billing}" \
    --display-name "HireLoom monthly" --budget-amount "${BUDGET_USD}USD" \
    --filter-projects "projects/${PROJECT_ID}" \
    --threshold-rule percent=0.5 --threshold-rule percent=0.9 --threshold-rule percent=1.0 \
    --notifications-rule-monitoring-notification-channels "${channel}"
fi
