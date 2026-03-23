use serde::{Deserialize, Serialize};

/// A Gmail message trimmed to the fields we care about
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmailAlert {
    pub id: String,
    pub subject: String,
    pub from: String,
    pub date: String,
    pub snippet: String,
    /// Which filter rule matched (e.g. "gcp_approval", "direct_cc")
    pub rule: String,
}

/// Raw Gmail API list response
#[derive(Debug, Deserialize)]
pub struct GmailListResponse {
    #[serde(default)]
    pub messages: Vec<GmailMessageRef>,
    #[serde(rename = "resultSizeEstimate", default)]
    pub result_size_estimate: u32,
}

#[derive(Debug, Deserialize)]
pub struct GmailMessageRef {
    pub id: String,
    #[serde(rename = "threadId")]
    pub thread_id: String,
}

/// Raw Gmail API message response
#[derive(Debug, Deserialize)]
pub struct GmailMessageRaw {
    pub id: String,
    pub snippet: Option<String>,
    pub payload: Option<GmailPayload>,
    #[serde(rename = "internalDate", default)]
    pub internal_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GmailPayload {
    #[serde(default)]
    pub headers: Vec<GmailHeader>,
}

#[derive(Debug, Deserialize)]
pub struct GmailHeader {
    pub name: String,
    pub value: String,
}
