//! axum wiring: `GET /healthz`, `POST /analyze`, `POST /remap`.

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;

use crate::parser::analyze_diff;
use crate::remap::remap_anchors;
use crate::types::{AnalyzeRequest, AnalyzeResponse, RemapRequest, RemapResponse};

pub fn build_app() -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/analyze", post(analyze))
        .route("/remap", post(remap))
}

async fn healthz() -> impl IntoResponse {
    Json(json!({"ok": true, "service": "diff-analyzer"}))
}

async fn analyze(Json(req): Json<AnalyzeRequest>) -> impl IntoResponse {
    let hunks = analyze_diff(&req.diff);
    (StatusCode::OK, Json(AnalyzeResponse { hunks }))
}

async fn remap(Json(req): Json<RemapRequest>) -> impl IntoResponse {
    let anchors = remap_anchors(&req.diff, &req.anchors);
    (StatusCode::OK, Json(RemapResponse { anchors }))
}
