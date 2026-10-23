use diff_analyzer::build_app;

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(4200);
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("failed to bind listener");
    println!("diff-analyzer listening on {addr}");
    axum::serve(listener, build_app())
        .await
        .expect("server error");
}
