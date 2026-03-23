use std::sync::Mutex;
use once_cell::sync::Lazy;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};

use crate::models::gmail::{
    GmailAlert, GmailHeader, GmailListResponse, GmailMessageRaw,
};

const GMAIL_API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";

/// Cached access token + expiry. We re-fetch via gcloud when it expires.
static CACHED_TOKEN: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// Get an OAuth2 access token by shelling out to `gcloud auth print-access-token`.
/// This piggybacks on the user's existing GCP auth (same as Cloud SQL Proxy).
fn fetch_access_token() -> Result<String, String> {
    let output = std::process::Command::new("gcloud")
        .args(["auth", "print-access-token"])
        .output()
        .map_err(|e| format!("Failed to run gcloud: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gcloud auth failed: {}", stderr));
    }

    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        return Err("gcloud returned empty token".into());
    }
    Ok(token)
}

fn get_token() -> Result<String, String> {
    // Always refresh — gcloud tokens are short-lived and the command is fast
    let token = fetch_access_token()?;
    *CACHED_TOKEN.lock().unwrap() = Some(token.clone());
    Ok(token)
}

fn build_client(token: &str) -> Result<reqwest::Client, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", token)).map_err(|e| e.to_string())?,
    );
    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| e.to_string())
}

fn extract_header<'a>(headers: &'a [GmailHeader], name: &str) -> String {
    headers
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case(name))
        .map(|h| h.value.clone())
        .unwrap_or_default()
}

/// Search Gmail and return message IDs
async fn search(client: &reqwest::Client, query: &str, max: u32) -> Result<GmailListResponse, String> {
    client
        .get(format!("{GMAIL_API}/messages"))
        .query(&[("q", query), ("maxResults", &max.to_string())])
        .send()
        .await
        .map_err(|e| format!("Gmail search error: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Gmail search HTTP error: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Gmail search parse error: {}", e))
}

/// Fetch a single message by ID (metadata only — no body)
async fn get_message(client: &reqwest::Client, id: &str) -> Result<GmailMessageRaw, String> {
    client
        .get(format!("{GMAIL_API}/messages/{}", id))
        .query(&[("format", "metadata"), ("metadataHeaders", "From,To,Cc,Subject,Date")])
        .send()
        .await
        .map_err(|e| format!("Gmail get error: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Gmail get HTTP error: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Gmail get parse error: {}", e))
}

/// Alert rules — each is a named Gmail search query
struct AlertRule {
    name: &'static str,
    query: &'static str,
}

const ALERT_RULES: &[AlertRule] = &[
    AlertRule {
        name: "gcp_approval",
        query: "is:unread from:pam-noreply@google.com (\"awaiting approval\" OR \"Approve or deny\")",
    },
    AlertRule {
        name: "direct_cc",
        query: "is:unread to:aj@nectarhr.com -from:pam-noreply@google.com -category:promotions -category:social -category:updates -from:noreply -from:no-reply -from:notifications",
    },
];

/// Check all alert rules and return matching emails
pub async fn check_alerts() -> Result<Vec<GmailAlert>, String> {
    let token = get_token()?;
    let client = build_client(&token)?;
    let mut alerts = Vec::new();

    for rule in ALERT_RULES {
        let list = search(&client, rule.query, 10).await?;
        for msg_ref in &list.messages {
            let raw = get_message(&client, &msg_ref.id).await?;
            let headers = raw
                .payload
                .as_ref()
                .map(|p| p.headers.as_slice())
                .unwrap_or(&[]);

            alerts.push(GmailAlert {
                id: raw.id.clone(),
                subject: extract_header(headers, "Subject"),
                from: extract_header(headers, "From"),
                date: extract_header(headers, "Date"),
                snippet: raw.snippet.clone().unwrap_or_default(),
                rule: rule.name.to_string(),
            });
        }
    }

    Ok(alerts)
}

/// Format alerts into a single Slack message
pub fn format_alerts_for_slack(alerts: &[GmailAlert]) -> Option<String> {
    if alerts.is_empty() {
        return None;
    }

    let mut parts: Vec<String> = Vec::new();
    parts.push(format!("📬 *{} unread email(s) need attention:*\n", alerts.len()));

    for alert in alerts {
        let formatted = match alert.rule.as_str() {
            "gcp_approval" => format!(
                "🔑 *GCP Approval*: {}\n  _{}_",
                alert.subject, alert.snippet
            ),
            "direct_cc" => format!(
                "✉️ *From {}*: {}\n  _{}_",
                alert.from, alert.subject, alert.snippet
            ),
            _ => format!("• {}: _{}_", alert.subject, alert.snippet),
        };
        parts.push(formatted);
    }

    Some(parts.join("\n\n"))
}
