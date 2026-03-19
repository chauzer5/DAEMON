use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackMessage {
    pub id: String,
    pub channel: String,
    pub channel_id: String,
    pub sender: String,
    pub message: String,
    pub timestamp: String,
    pub raw_ts: String,
    pub permalink: String,
    pub is_unread: bool,
    pub reply_count: u32,
    pub latest_reply_ts: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackSection {
    pub title: String,
    pub section_type: String,
    pub messages: Vec<SlackMessage>,
    pub unread_count: u32,
}
