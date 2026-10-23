//! Shared JSON shapes exchanged with other Chesterton services.
//! Field names and the `Hunk` shape MUST match docs/contracts.md byte-for-byte.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Hunk {
    pub file: String,
    pub old_start: usize,
    pub old_end: usize,
    pub new_start: usize,
    pub new_end: usize,
    pub old_lines: Vec<String>,
    pub new_lines: Vec<String>,
    pub symbol: String,
    pub hunk_hash: String,
}

#[derive(Debug, Deserialize)]
pub struct AnalyzeRequest {
    pub diff: String,
}

#[derive(Debug, Serialize)]
pub struct AnalyzeResponse {
    pub hunks: Vec<Hunk>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AnchorRequest {
    pub file: String,
    pub line_start: usize,
    pub line_end: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AnchorResponse {
    pub file: String,
    pub line_start: usize,
    pub line_end: usize,
    pub alive: bool,
}

#[derive(Debug, Deserialize)]
pub struct RemapRequest {
    pub diff: String,
    pub anchors: Vec<AnchorRequest>,
}

#[derive(Debug, Serialize)]
pub struct RemapResponse {
    pub anchors: Vec<AnchorResponse>,
}
