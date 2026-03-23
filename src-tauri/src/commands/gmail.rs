use crate::models::gmail::GmailAlert;
use crate::services::gmail;
use crate::services::slack::{get_slack_creds, slack_api_post};

/// Check Gmail for actionable emails and return them.
/// The frontend can poll this on a timer.
#[tauri::command]
pub async fn check_gmail_alerts() -> Result<Vec<GmailAlert>, String> {
    gmail::check_alerts().await
}

/// Check Gmail and send a Slack DM to yourself with any actionable emails.
/// Returns the number of alerts found (0 means no DM was sent).
#[tauri::command]
pub async fn gmail_alert_to_slack() -> Result<u32, String> {
    let alerts = gmail::check_alerts().await?;

    let message = match gmail::format_alerts_for_slack(&alerts) {
        Some(msg) => msg,
        None => return Ok(0),
    };

    // Open a DM with yourself and send the summary
    let creds = get_slack_creds()?;
    let http = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;

    // Open a DM conversation with yourself
    let dm = slack_api_post(
        &http,
        &creds,
        "conversations.open",
        &serde_json::json!({ "users": creds.user_id }),
    )
    .await?;

    let channel_id = dm["channel"]["id"]
        .as_str()
        .ok_or("Could not open self-DM")?
        .to_string();

    // Send the alert summary
    slack_api_post(
        &http,
        &creds,
        "chat.postMessage",
        &serde_json::json!({
            "channel": channel_id,
            "text": message,
            "unfurl_links": false,
            "unfurl_media": false,
        }),
    )
    .await?;

    Ok(alerts.len() as u32)
}
