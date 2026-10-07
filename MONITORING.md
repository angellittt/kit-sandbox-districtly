# Monitoring & Error Tracking

**What this is:** a guide to the optional monitoring/alerting infra module (Log Analytics + Application Insights) and, once your app sends telemetry to it, how to find, reproduce, and understand errors that happen in a deployed environment.

**Status in this template:** off by default. The Azure infrastructure (Log Analytics workspace, 2x Application Insights, diagnostic settings, exception-spike alerts, health-check alert, synthetic availability checks) is defined in [`infra/template/monitoring.tf`](infra/template/monitoring.tf), gated behind the `enable_monitoring` variable. See [`infra/Readme.md`](infra/Readme.md#optional-modules) for how to turn it on. **This module provisions the Azure side only** — your app still needs to send telemetry to it (section 0 below).

---

## 0. Wiring your app to send telemetry

This template doesn't ship an Application Insights SDK integration, since not every project needs one. Once `enable_monitoring = true` has been applied, `terraform output` gives you a connection string per app (add an output if one doesn't already exist for `azurerm_application_insights.api`/`.web`). From there:

- **API:** install [`applicationinsights`](https://www.npmjs.com/package/applicationinsights) (or the OpenTelemetry-based `@azure/monitor-opentelemetry`), initialize it as early as possible in your entrypoint with the connection string, and add error-handling middleware that calls `client.trackException(...)` with at least `route`, `method`, and sanitized `headers`/`body` as custom properties — those are the fields sections 3-4 below filter and search on. Keep secrets/tokens out of what you send; sanitize before calling `trackException`.
- **Web:** install [`@microsoft/applicationinsights-web`](https://www.npmjs.com/package/@microsoft/applicationinsights-web), initialize it with the connection string, and it auto-collects uncaught exceptions and unhandled promise rejections. Tag each with `route` (the page path) so section 4's example query works; if you have an axios/fetch wrapper, attach `endpoint`/`method` to failed-request errors there too.

Once that's in place, every error you log carries the fields the rest of this guide assumes.

---

## 1. Where to look in the Azure Portal

**What you need:** access to the Application Insights resource for the environment you care about (ask the tech lead if you don't have it).

1. Go to [portal.azure.com](https://portal.azure.com).
2. Search for the Application Insights resource (one per app per environment — `<project>-<env>-api-appinsights` / `<project>-<env>-web-appinsights`).
3. Open it. You'll land on the Overview page with a left-hand menu — that menu is where everything below lives.

---

## 2. Investigating a specific error

**Steps:**

1. In the left menu, click **Failures** (under "Investigate").
   This page lists every exception and failed request, grouped by type, with counts and a trend chart.
2. Click on an exception in the list.
   You'll see the full stack trace, plus whatever custom fields your app attached (see section 0 — typically `route`, `method`, `headers`, `body`).
   ⚠️ Common mistake: expecting to see raw passwords/tokens in `headers`/`body` — sanitize those out at the source (section 0), don't rely on the portal to hide them.
3. Click **"View timeline"** (or "End-to-end transaction details") on that exception.
   This shows everything that happened in that one request, in order — for example: request comes in → database call → the exception. This is usually the fastest way to see _why_ it failed, not just _that_ it failed.

**You're done when:** you can see the stack trace, the route/method that failed, and what happened right before the crash, all for one specific error instance.

---

## 3. Searching across many errors (Logs / KQL)

Use this when you want to answer a question like "how many times did this route fail this week?" instead of looking at one error at a time.

1. In the left menu, click **Logs** (under "Monitoring").
2. A query editor opens. This uses a query language called **KQL** (Kusto Query Language) — think of it like SQL, but for logs.
3. Paste one of the examples below and click **Run**.

**Example — all errors on a specific route, last 24 hours:**

```kql
exceptions
| where timestamp > ago(24h)
| where customDimensions.route == "/api/v1/example"
| project timestamp, method = customDimensions.method, outerMessage, operation_Id
| order by timestamp desc
```

**Example — which routes are failing the most this week:**

```kql
exceptions
| where timestamp > ago(7d)
| summarize count() by tostring(customDimensions.route)
| order by count_ desc
```

Swap the route, method, or time range (`24h`, `7d`, `30d`) to fit what you're looking for.

---

## 4. Watching errors happen live

Useful when you're actively reproducing a bug (e.g. clicking through the app right now) and want to see the error the moment it happens, no query needed.

1. In the left menu, click **Live Metrics**.
2. Reproduce the issue (click the button, submit the form, whatever triggers it).
3. Watch the "Failed requests" and "Exceptions" counters — they update in about 1 second.

---

## 5. Getting notified automatically (Alerts)

### Exception spikes

1. Every 5 minutes, Azure checks how many exceptions were logged in the last 5 minutes.
2. If that count is 5 or more (`exception_alert_threshold` in [`infra/template/variables.tf`](infra/template/variables.tf)), it sends an email.
3. The email goes to everyone listed in `alert_notification_emails` for that environment's module call.

⚠️ **This alert depends on the Log Analytics workspace still ingesting data.** `log_analytics_daily_quota_gb` (default `1` GB/day) caps how much it ingests before it stops for the rest of the day. On a busy prod app, a real incident can burn through 1 GB fast, silently cut off ingestion, and cause this alert to miss the very spike it's meant to catch. Before enabling monitoring in prod, raise or remove the cap (`-1` for unlimited) deliberately, don't leave it at the default.

### API down or crashing

The API App Service reports a `HealthCheckStatus` metric to Azure. If that metric drops below healthy for 5 minutes straight, an alert fires and emails the same list. This is a fast, in-Azure signal, but it depends on the app still being able to report metrics at all; see the availability test below for the backstop.

### Site unreachable from outside Azure

Two "availability tests" (see [`infra/template/monitoring.tf`](infra/template/monitoring.tf)) hit the live API and web URLs every 5 minutes from 3 different real-world locations, the same way a user's browser would. An alert fires only if the request fails (timeout, wrong status code, DNS/CDN issue) from _all 3_ of those locations, sustained across 2 checks in a row (~10 minutes); a single location blip, or one bad check, never trips it. This is the backstop that catches a fully-down app even if it's too broken to report its own health metrics.

Want to change the threshold or who gets notified? Edit `exception_alert_threshold` or `alert_notification_emails` in the files above and run `terraform apply` (ask the tech lead — see [infra/Readme.md](infra/Readme.md)).

---
