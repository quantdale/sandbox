// ============================================================================
// Click Counter v3 — Rust Backend
// ============================================================================
//
// This backend implements a HTTP server that:
//   1. Stores click counts in Redis (one key per card: card:1, card:2, etc.)
//   2. Provides GET /count/:card_id to read a count
//   3. Provides POST /click/:card_id to increment a count atomically
//   4. Provides GET /cards to list all existing card keys
//   5. Adds CORS headers so the frontend (different port) can communicate
//
// A Word on Rust Concepts:
//   - OWNERSHIP: Rust doesn't have a garbage collector. Instead, it tracks who "owns"
//     each piece of memory. When an owner goes out of scope, memory is freed automatically.
//     This prevents memory leaks and use-after-free bugs.
//   - ASYNC/AWAIT: Like JavaScript's Promise/await, but more powerful. Rust can spawn
//     thousands of concurrent tasks (unlike Python). Go also has goroutines; Rust's tokio is similar.
//   - ACTIX-WEB: A framework that handles HTTP routing, middleware, and responses.
//     It's one of the fastest web servers benchmarked (faster than Go, Python, Node.js).
//
// ============================================================================
// HOW TO SET UP AND RUN ON WINDOWS
//
// 1. Install Rust:
//    Download and run: https://rustup.rs
//    This installs rustc (compiler) and cargo (package manager).
//    Verify: rustc --version
//
// 2. Install Redis on Windows via Docker Desktop:
//    Download Docker Desktop: https://www.docker.com/products/docker-desktop
//    After install, open PowerShell and run:
//      docker run -d -p 6379:6379 --name redis redis
//    Verify: docker ps   (should show redis running)
//    If you want to stop it later: docker stop redis
//
// 3. Run the backend:
//    cd backend
//    cargo run
//    First run will be slow (compiling dependencies). Subsequent runs are instant.
//    You should see: "Server running on http://localhost:8000"
//
// 4. Serve the frontend:
//    In a separate PowerShell window:
//    cd frontend
//    python -m http.server 3000
//    Visit: http://localhost:3000 in your browser
//
// Ports in use:
//    Frontend:  http://localhost:3000 (served by Python's http.server)
//    Backend:   http://localhost:8000 (our Rust server)
//    Redis:     localhost:6379 (in Docker)
//
// ============================================================================

// Import macros and types from dependencies
use actix_web::{web, App, HttpResponse, HttpServer, http::header};
use redis::aio::MultiplexedConnection;
use redis::{AsyncCommands, Client};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

// ============================================================================
// JSON Structures (serde will convert these to/from JSON)
// ============================================================================
// (Serde is the Rust ecosystem's serialization framework. #[derive(Serialize, Deserialize)]
// tells serde to auto-generate code that converts these structs to/from JSON.)

/// Request body for POST /click/:card_id
/// The frontend sends { "clicks": 5 } to increment a card's count by 5.
#[derive(Deserialize)]
struct ClickRequest {
    clicks: i64, // How many clicks to add
}

/// Response body for GET /count/:card_id or POST /click/:card_id
/// Always returns { "count": N } where N is the current count.
#[derive(Serialize)]
struct CountResponse {
    count: i64,
}

/// Response body for GET /cards
/// Returns a list of all card keys in Redis (shape: { "cards": ["card:1", "card:2", ...] })
#[derive(Serialize)]
struct CardsResponse {
    cards: Vec<String>,
}

// ============================================================================
// Application State (Shared across all requests)
// ============================================================================
// In Rust, multiple threads/tasks can't directly share mutable state without
// synchronization. Arc<T> (Atomic Reference Counting) allows multiple threads to
// safely share ownership of data.
//
// We wrap the Redis connection in Arc so it can be cloned and passed to every
// handler function. Arc is a bit like a smart pointer that tracks how many
// owners there are. When the last owner drops it, the memory is freed.
struct AppState {
    redis_client: Client,
}

// ============================================================================
// Helper: Create Redis Connection from the Client
// ============================================================================
// Redis connections in Rust are async (like Node.js callbacks or Python asyncio).
// get_multiplexed_async_connection() returns a Future that resolves to either a 
// MultiplexedConnection or an error. MultiplexedConnection is better for concurrent
// requests because it can handle multiple in-flight commands at once.
async fn get_redis_connection(
    client: &Client,
) -> Result<MultiplexedConnection, Box<dyn std::error::Error>> {
    // The ? operator unwraps a Result. If there's an error, it returns early.
    // This is cleaner than try/catch in JS.
    let connection = client.get_multiplexed_async_connection().await?;
    Ok(connection)
}

// ============================================================================
// Helper: Add CORS Headers to Response
// ============================================================================
// CORS (Cross-Origin Resource Sharing) headers tell the browser that requests
// from a different origin (frontend on :3000, backend on :8000) are allowed.
//
// Without these headers, the browser would BLOCK the frontend's fetch() calls
// to the backend as a security measure. This is a browser security feature to
// prevent malicious websites from accessing your data.
//
// In production, you'd restrict these to specific origins (e.g., your domain),
// not "*" (all origins).
fn with_cors(mut response: HttpResponse) -> HttpResponse {
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        header::HeaderValue::from_static("*"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        header::HeaderValue::from_static("GET, POST, OPTIONS, PUT, DELETE"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        header::HeaderValue::from_static("Content-Type"),
    );
    response
}

// OPTIONS preflight handler
// When the browser makes a cross-origin POST with Content-Type: application/json,
// it sends an OPTIONS request first to ask "is this allowed?"
// Without this handler, the server returns 405 and the browser blocks the real request.
async fn preflight() -> HttpResponse {
    with_cors(HttpResponse::Ok().finish())
}

// ============================================================================
// Handlers
// ============================================================================

async fn get_count_with_cors(
    state: web::Data<Arc<AppState>>,
    path: web::Path<i64>,
) -> Result<HttpResponse, actix_web::error::Error> {
    let card_id = path.into_inner();
    let key = format!("card:{}", card_id);

    let mut redis = get_redis_connection(&state.redis_client)
        .await
        .map_err(|_| actix_web::error::ErrorInternalServerError("Redis connection failed"))?;

    let count: i64 = redis.get(&key).await.unwrap_or(0);

    Ok(with_cors(HttpResponse::Ok().json(CountResponse { count })))
}

async fn post_click_with_cors(
    state: web::Data<Arc<AppState>>,
    path: web::Path<i64>,
    body: web::Json<ClickRequest>,
) -> Result<HttpResponse, actix_web::error::Error> {
    let card_id = path.into_inner();
    let key = format!("card:{}", card_id);
    let click_count = body.clicks;

    let mut redis = get_redis_connection(&state.redis_client)
        .await
        .map_err(|_| actix_web::error::ErrorInternalServerError("Redis connection failed"))?;

    let new_count: i64 = redis
        .incr(&key, click_count)
        .await
        .map_err(|_| actix_web::error::ErrorInternalServerError("Redis increment failed"))?;

    Ok(with_cors(
        HttpResponse::Ok().json(CountResponse { count: new_count }),
    ))
}

async fn get_cards_with_cors(
    state: web::Data<Arc<AppState>>,
) -> Result<HttpResponse, actix_web::error::Error> {
    let mut redis = get_redis_connection(&state.redis_client)
        .await
        .map_err(|_| actix_web::error::ErrorInternalServerError("Redis connection failed"))?;

    let cards: Vec<String> = redis.keys("card:*").await.unwrap_or_default();

    Ok(with_cors(
        HttpResponse::Ok().json(CardsResponse { cards }),
    ))
}

// ============================================================================
// Main Entry Point
// ============================================================================
// The #[actix_web::main] macro sets up tokio's async runtime and runs the server.
// Without it, we'd have to manually call tokio::runtime::Runtime::new().
//
// Key Concepts:
//   - #[actix_web::main] is an attribute macro in Rust (like a decorator in Python).
//     It sets up the tokio async runtime automatically.
//   - The 'async' keyword means this function is asynchronous and must be awaited.
//   - Inside, we create a Redis client, set up HTTP routes, and start the server.
#[actix_web::main]
async fn main() -> std::io::Result<()> {
    println!("Click Counter v3 — Rust Backend");
    println!("================================\n");

    // Connect to Redis on localhost:6379
    // If Redis isn't running, this will panic (crash) with an error message.
    let redis_client = redis::Client::open("redis://127.0.0.1:6379/")
        .expect("Failed to create Redis client. Is Redis running on localhost:6379?");

    // Quick check: try to ping Redis to verify it's reachable
    match redis_client.get_multiplexed_async_connection().await {
        Ok(mut conn) => {
            let _: String = redis::cmd("PING")
                .query_async(&mut conn)
                .await
                .expect("PING failed");
            println!("✓ Connected to Redis on localhost:6379");
        }
        Err(e) => {
            eprintln!("✗ Failed to connect to Redis: {}", e);
            eprintln!("Make sure Redis is running on localhost:6379");
            eprintln!("You can start Redis with: docker run -d -p 6379:6379 redis");
            std::process::exit(1);
        }
    }

    // Wrap the AppState in Arc (Atomic Reference Counting)
    // This allows it to be safely cloned and shared across all request handlers.
    // Arc is Rust's way of saying "multiple owners of this data" without a garbage collector.
    let state = Arc::new(AppState { redis_client });

    println!("Starting HTTP server on http://localhost:8000");
    println!("Frontend should be running on http://localhost:3000");
    println!();

    // Create and run the HTTP server
    HttpServer::new(move || {
        // Clone the Arc (cheap operation, just increments the reference count)
        let state_clone = state.clone();

        // Create the app with routes
        App::new()
            .app_data(web::Data::new(state_clone))
            // Real routes
            .route("/count/{card_id}", web::get().to(get_count_with_cors))
            .route("/click/{card_id}", web::post().to(post_click_with_cors))
            .route("/cards", web::get().to(get_cards_with_cors))
            // CORS preflight — the browser sends OPTIONS before every cross-origin POST
            .route("/count/{card_id}", web::method(actix_web::http::Method::OPTIONS).to(preflight))
            .route("/click/{card_id}", web::method(actix_web::http::Method::OPTIONS).to(preflight))
            .route("/cards", web::method(actix_web::http::Method::OPTIONS).to(preflight))
    })
    .bind("127.0.0.1:8000")?  // Listen on localhost:8000
    .run()
    .await
}

// ============================================================================
// Why Rust and Actix-Web?
// ============================================================================
//
// PERFORMANCE:
//   Rust compiles to machine code (no interpreter overhead like Python).
//   Rust has no garbage collector, so there are no GC pauses.
//   Actix-web is consistently benchmarked as one of the top 3 fastest web frameworks
//   across all languages (alongside Go and some others).
//   
// SAFETY:
//   Memory safety is checked at compile-time. You can't accidentally free memory
//   twice or access memory that's been freed (unlike C/C++).
//   This matters for web servers that run 24/7 without crashing.
//
// CONCURRENCY:
//   Rust's async/await is as easy to write as Python's, but handles millions of
//   concurrent connections with minimal overhead (like Go's goroutines).
//
// COMPARISON TO GO:
//   Go is also fast and runs on a VM, but it has a garbage collector.
//   Rust is slightly faster than Go in benchmarks, but harder to learn.
//   Go is easier for beginners; Rust is more powerful for experts.
//
// COMPARISON TO PYTHON:
//   Python is 100-1000x slower than Rust for server code.
//   To handle 10,000 concurrent requests, Python needs threading (hard to reason about)
//   or async (like this code, but slower than Rust's).
//   Rust lets you write high-performance code that feels as simple as Python.
//
// ============================================================================
