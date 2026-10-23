//! Integration tests for the HTTP layer, driven via `tower::ServiceExt::oneshot`
//! against the real axum `Router` (no network socket needed).

use axum::body::Body;
use axum::http::{Request, StatusCode};
use diff_analyzer::build_app;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const PR1_DIFF: &str = include_str!("fixtures/pr1.diff");

async fn body_json(resp: axum::response::Response) -> Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn healthz_reports_service_name() {
    let app = build_app();
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["ok"], true);
    assert_eq!(v["service"], "diff-analyzer");
}

#[tokio::test]
async fn analyze_seeded_pr1_diff_yields_expected_hunk() {
    let app = build_app();
    let req_body = json!({ "diff": PR1_DIFF }).to_string();
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/analyze")
                .header("content-type", "application/json")
                .body(Body::from(req_body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    let hunks = v["hunks"].as_array().unwrap();
    assert_eq!(hunks.len(), 1, "expected exactly one hunk, got {v}");
    assert_eq!(hunks[0]["file"], "services/payments/client.py");
    assert_eq!(hunks[0]["old_lines"], json!(["MAX_RETRIES = 3"]));
    assert_eq!(hunks[0]["new_lines"], json!(["MAX_RETRIES = 50"]));
    assert!(hunks[0]["hunk_hash"].as_str().unwrap().len() == 16);
}

#[tokio::test]
async fn remap_endpoint_shifts_and_kills_anchors() {
    let app = build_app();
    let diff = "diff --git a/foo.py b/foo.py\nindex 1111111..2222222 100644\n--- a/foo.py\n+++ b/foo.py\n@@ -1,3 +1,2 @@\n a = 1\n-b = 2\n c = 3\n";
    let req_body = json!({
        "diff": diff,
        "anchors": [
            {"file": "foo.py", "line_start": 2, "line_end": 2},
            {"file": "foo.py", "line_start": 1, "line_end": 1}
        ]
    })
    .to_string();
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/remap")
                .header("content-type", "application/json")
                .body(Body::from(req_body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    let anchors = v["anchors"].as_array().unwrap();
    assert_eq!(anchors.len(), 2);
    assert_eq!(anchors[0]["alive"], false);
    assert_eq!(anchors[1]["alive"], true);
    assert_eq!(anchors[1]["line_start"], 1);
}

#[tokio::test]
async fn analyze_rejects_malformed_body() {
    let app = build_app();
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/analyze")
                .header("content-type", "application/json")
                .body(Body::from("not json"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(resp.status().is_client_error());
}
