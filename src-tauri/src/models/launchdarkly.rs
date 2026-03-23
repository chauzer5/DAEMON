use serde::{Deserialize, Serialize};

/// Raw LD API flag response
#[derive(Debug, Deserialize)]
pub struct LDFlagRaw {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub environments: std::collections::HashMap<String, LDEnvStatus>,
    #[serde(rename = "creationDate", default)]
    pub creation_date: Option<u64>,
    #[serde(default)]
    pub archived: bool,
}

#[derive(Debug, Deserialize)]
pub struct LDEnvStatus {
    #[serde(default)]
    pub on: bool,
    #[serde(rename = "lastModified", default)]
    pub last_modified: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct LDFlagListResponse {
    #[serde(default)]
    pub items: Vec<LDFlagRaw>,
    #[serde(rename = "totalCount", default)]
    pub total_count: u32,
}

/// Frontend-facing flag type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LDFlag {
    pub key: String,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub prod_on: bool,
    pub test_on: bool,
    pub archived: bool,
    pub last_modified: Option<u64>,
}
