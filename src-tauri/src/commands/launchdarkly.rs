use crate::models::launchdarkly::LDFlag;
use crate::services::credentials;
use crate::services::launchdarkly::LaunchDarklyClient;

fn get_client() -> Result<Option<LaunchDarklyClient>, String> {
    let api_key = match credentials::get_credential("launchdarkly_api_key")? {
        Some(k) if !k.is_empty() => k,
        _ => return Ok(None),
    };
    LaunchDarklyClient::new(&api_key).map(Some)
}

#[tauri::command]
pub async fn get_comms_flags() -> Result<Vec<LDFlag>, String> {
    match get_client()? {
        Some(client) => client.get_comms_flags().await,
        None => Ok(vec![]),
    }
}
