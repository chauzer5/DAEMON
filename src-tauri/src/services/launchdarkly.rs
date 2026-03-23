use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};

use crate::models::launchdarkly::{LDFlag, LDFlagListResponse};

const LD_API: &str = "https://app.launchdarkly.com/api/v2";

/// Comms-related flag key prefixes
const COMMS_PREFIXES: &[&str] = &[
    "comms-",
    "engage-",
    "journeys-",
    "plain-text-",
    "slack-bot-",
    "unify-comms",
];

pub struct LaunchDarklyClient {
    client: reqwest::Client,
}

impl LaunchDarklyClient {
    pub fn new(api_key: &str) -> Result<Self, String> {
        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(api_key).map_err(|e| e.to_string())?,
        );
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self { client })
    }

    /// Fetch all flags in the default project, filtered to comms-related ones
    pub async fn get_comms_flags(&self) -> Result<Vec<LDFlag>, String> {
        let resp: LDFlagListResponse = self
            .client
            .get(format!("{LD_API}/flags/default"))
            .query(&[("limit", "100"), ("summary", "true")])
            .send()
            .await
            .map_err(|e| format!("LD API error: {}", e))?
            .error_for_status()
            .map_err(|e| format!("LD API HTTP error: {}", e))?
            .json()
            .await
            .map_err(|e| format!("LD API parse error: {}", e))?;

        let flags: Vec<LDFlag> = resp
            .items
            .into_iter()
            .filter(|f| {
                !f.archived && COMMS_PREFIXES.iter().any(|prefix| f.key.starts_with(prefix))
            })
            .map(|f| {
                let prod = f.environments.get("production");
                let test = f.environments.get("test");
                LDFlag {
                    key: f.key,
                    name: f.name,
                    description: f.description,
                    tags: f.tags,
                    prod_on: prod.map(|e| e.on).unwrap_or(false),
                    test_on: test.map(|e| e.on).unwrap_or(false),
                    archived: f.archived,
                    last_modified: prod.and_then(|e| e.last_modified),
                }
            })
            .collect();

        Ok(flags)
    }
}
