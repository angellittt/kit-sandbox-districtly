# OPTIONAL MODULE — disabled by default (var.enable_monitoring = false).
#
# Provisions a Log Analytics workspace, one Application Insights resource per app
# (api/web), diagnostic settings streaming the API App Service's platform logs into
# it, exception-spike alerts, an in-Azure health-check alert, and synthetic
# availability checks pinging the live API/web URLs from 3 real-world locations.
#
# Enable by setting enable_monitoring = true, plus alert_notification_emails, in
# your environment's module call (see infra/main.tf). This module only provisions
# the Azure side — your app still needs to send telemetry to these Application
# Insights resources (e.g. the Node.js/Browser JS Application Insights SDKs). See
# MONITORING.md for the day-to-day runbook once both are in place.

resource "azurerm_log_analytics_workspace" "monitoring" {
  count               = var.enable_monitoring ? 1 : 0
  name                = "${var.project_name}-${var.environment_name}-logs"
  resource_group_name = azurerm_resource_group.resource_group.name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  daily_quota_gb      = var.log_analytics_daily_quota_gb
}

resource "azurerm_application_insights" "api" {
  count               = var.enable_monitoring ? 1 : 0
  name                = "${var.project_name}-${var.environment_name}-api-appinsights"
  resource_group_name = azurerm_resource_group.resource_group.name
  location            = var.location
  workspace_id        = azurerm_log_analytics_workspace.monitoring[0].id
  application_type    = "Node.JS"
  sampling_percentage = 100
}

resource "azurerm_application_insights" "web" {
  count               = var.enable_monitoring ? 1 : 0
  name                = "${var.project_name}-${var.environment_name}-web-appinsights"
  resource_group_name = azurerm_resource_group.resource_group.name
  location            = var.location
  workspace_id        = azurerm_log_analytics_workspace.monitoring[0].id
  application_type    = "web"
  sampling_percentage = 100
}

resource "azurerm_monitor_action_group" "api" {
  count               = var.enable_monitoring ? 1 : 0
  name                = "${var.project_name}-${var.environment_name}-api-ag"
  resource_group_name = azurerm_resource_group.resource_group.name
  short_name          = "api-alert"

  dynamic "email_receiver" {
    for_each = var.alert_notification_emails
    content {
      name                    = "email-${replace(email_receiver.value, "/[^a-zA-Z0-9]/", "-")}"
      email_address           = email_receiver.value
      use_common_alert_schema = true
    }
  }
}

resource "azurerm_monitor_action_group" "web" {
  count               = var.enable_monitoring ? 1 : 0
  name                = "${var.project_name}-${var.environment_name}-web-ag"
  resource_group_name = azurerm_resource_group.resource_group.name
  short_name          = "web-alert"

  dynamic "email_receiver" {
    for_each = var.alert_notification_emails
    content {
      name                    = "email-${replace(email_receiver.value, "/[^a-zA-Z0-9]/", "-")}"
      email_address           = email_receiver.value
      use_common_alert_schema = true
    }
  }
}

resource "azurerm_monitor_diagnostic_setting" "api" {
  count                      = var.enable_monitoring ? 1 : 0
  name                       = "${var.project_name}-${var.environment_name}-api-diag"
  target_resource_id         = azurerm_linux_web_app.app_service.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.monitoring[0].id

  enabled_log {
    category = "AppServiceConsoleLogs"
  }
  enabled_log {
    category = "AppServiceHTTPLogs"
  }
  enabled_log {
    category = "AppServiceAppLogs"
  }

  metric {
    category = "AllMetrics"
  }
}

/* azurerm_monitor_scheduled_query_rules_alert_v2 is an alarm. It checks the error logs every 5 minutes.
 * If it finds threshold-or-more exceptions (default 5) in a 5-minute window, it rings the alarm (sends an email).
 * We need this so we find out about a broken app right away, not from an angry user. */
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "api_exception_alert" {
  count                = var.enable_monitoring ? 1 : 0
  name                 = "${var.project_name}-${var.environment_name}-api-exception-alert"
  resource_group_name  = azurerm_resource_group.resource_group.name
  location             = var.location
  evaluation_frequency = "PT5M"
  window_duration      = "PT5M"
  scopes               = [azurerm_application_insights.api[0].id]
  severity             = 2
  description          = "[${var.project_name}][API] Error spike in ${var.environment_name}"

  criteria {
    query                   = "exceptions"
    time_aggregation_method = "Count"
    threshold               = var.exception_alert_threshold
    operator                = "GreaterThanOrEqual"

    failing_periods {
      minimum_failing_periods_to_trigger_alert = 1
      number_of_evaluation_periods             = 1
    }
  }

  action {
    action_groups = [azurerm_monitor_action_group.api[0].id]
  }
}

resource "azurerm_monitor_scheduled_query_rules_alert_v2" "web_exception_alert" {
  count                = var.enable_monitoring ? 1 : 0
  name                 = "${var.project_name}-${var.environment_name}-web-exception-alert"
  resource_group_name  = azurerm_resource_group.resource_group.name
  location             = var.location
  evaluation_frequency = "PT5M"
  window_duration      = "PT5M"
  scopes               = [azurerm_application_insights.web[0].id]
  severity             = 2
  description          = "[${var.project_name}][WEB] Error spike in ${var.environment_name}"

  criteria {
    query                   = "exceptions"
    time_aggregation_method = "Count"
    threshold               = var.exception_alert_threshold
    operator                = "GreaterThanOrEqual"

    failing_periods {
      minimum_failing_periods_to_trigger_alert = 1
      number_of_evaluation_periods             = 1
    }
  }

  action {
    action_groups = [azurerm_monitor_action_group.web[0].id]
  }
}

/* Alerts us within minutes if the API goes down or crashes, so we find out before customers do.
 * This is a static-threshold metric alert: it only fires on data it actually receives. If the app
 * crash-loops hard enough to stop emitting HealthCheckStatus entirely, this alert goes silent
 * instead of firing (no portal "no data" option exists for this alert type). The
 * azurerm_application_insights_standard_web_test.api_health_check probe and its
 * azurerm_monitor_scheduled_query_rules_alert_v2.availability alert below are the real backstop
 * for a fully-dead app, since they ping from outside Azure. */
resource "azurerm_monitor_metric_alert" "api_health_check" {
  count               = var.enable_monitoring ? 1 : 0
  name                = "${var.project_name}-${var.environment_name}-api-health-check-alert"
  resource_group_name = azurerm_resource_group.resource_group.name
  scopes              = [azurerm_linux_web_app.app_service.id]
  severity            = 1
  description         = "[${var.project_name}][API] Health check failing in ${var.environment_name}"
  frequency           = "PT1M"
  window_size         = "PT5M"

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "HealthCheckStatus"
    aggregation      = "Average"
    operator         = "LessThan"
    threshold        = 1
  }

  action {
    action_group_id = azurerm_monitor_action_group.api[0].id
  }
}

/* Standard Availability Tests: ping each app from outside Azure, independent of platform
 * metrics, so we also catch DNS/routing/CDN failures that HealthCheckStatus can't see. */
resource "azurerm_application_insights_standard_web_test" "api_health_check" {
  count                   = var.enable_monitoring ? 1 : 0
  name                    = "${var.project_name}-${var.environment_name}-api-availability"
  resource_group_name     = azurerm_resource_group.resource_group.name
  location                = var.location
  application_insights_id = azurerm_application_insights.api[0].id
  geo_locations           = ["us-va-ash-azr", "us-il-ch1-azr", "us-ca-sjc-azr"]
  frequency               = 300
  timeout                 = 60
  enabled                 = true

  request {
    url = "https://${azurerm_linux_web_app.app_service.default_hostname}/api/v1/healthcheck"
  }

  validation_rules {
    expected_status_code = 200
  }
}

resource "azurerm_application_insights_standard_web_test" "web_root" {
  count                   = var.enable_monitoring ? 1 : 0
  name                    = "${var.project_name}-${var.environment_name}-web-availability"
  resource_group_name     = azurerm_resource_group.resource_group.name
  location                = var.location
  application_insights_id = azurerm_application_insights.web[0].id
  geo_locations           = ["us-va-ash-azr", "us-il-ch1-azr", "us-ca-sjc-azr"]
  frequency               = 300
  timeout                 = 60
  enabled                 = true

  request {
    url = "https://${azurerm_static_web_app.static_web_app.default_host_name}/"
  }

  validation_rules {
    expected_status_code = 200
  }
}

locals {
  # Built from splats + one() (never indexes a count=0 resource directly), and the
  # whole map collapses to {} when disabled, so the for_each below creates zero
  # alert resources instead of erroring on missing dependencies.
  availability_alerts = var.enable_monitoring ? {
    api = {
      web_test        = one(azurerm_application_insights_standard_web_test.api_health_check[*])
      app_insights_id = one(azurerm_application_insights.api[*].id)
      action_group_id = one(azurerm_monitor_action_group.api[*].id)
      label           = "API"
    }
    web = {
      web_test        = one(azurerm_application_insights_standard_web_test.web_root[*])
      app_insights_id = one(azurerm_application_insights.web[*].id)
      action_group_id = one(azurerm_monitor_action_group.web[*].id)
      label           = "WEB"
    }
  } : {}
}

/* Only fires when every probe location fails AND stays failed for 2 checks in a row
 * (~10 minutes). A single location timing out or one-off CDN blip never trips this,
 * only a real, sustained, everywhere-is-down outage does.
 *
 * window_duration=PT5M is safe against per-location reporting skew: a test's 3
 * locations typically land well inside a 5-minute window of each other, so a
 * genuine all-locations outage will always land in a single evaluation.
 *
 * scopes below is the App Insights resource id, not the Log Analytics workspace,
 * so this queries through the classic compatibility schema: lowercase table
 * `availabilityResults` with lowercase camelCase columns. The workspace-based
 * `AppAvailabilityResults`/PascalCase schema only resolves when the scope is the
 * Log Analytics workspace itself. */
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "availability" {
  for_each = local.availability_alerts

  name                 = "${var.project_name}-${var.environment_name}-${each.key}-availability-alert"
  resource_group_name  = azurerm_resource_group.resource_group.name
  location             = var.location
  evaluation_frequency = "PT5M"
  window_duration      = "PT5M"
  scopes               = [each.value.app_insights_id]
  severity             = 1
  description          = "[${var.project_name}][${each.value.label}] Availability test failing from all geo-locations in ${var.environment_name}, sustained for 10+ minutes"

  criteria {
    query                   = <<-QUERY
      availabilityResults
      | where name == "${each.value.web_test.name}"
      | summarize FailedLocations = dcountif(location, success == false) by bin(timestamp, 5m)
      | where FailedLocations >= ${length(each.value.web_test.geo_locations)}
    QUERY
    time_aggregation_method = "Count"
    threshold               = 0
    operator                = "GreaterThan"

    failing_periods {
      minimum_failing_periods_to_trigger_alert = 2
      number_of_evaluation_periods             = 2
    }
  }

  action {
    action_groups = [each.value.action_group_id]
  }
}
