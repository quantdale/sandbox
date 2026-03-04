// =============================================================================
// Click Counter v2 — main.go
// =============================================================================
//
// HOW TO INSTALL AND RUN REDIS LOCALLY
//
// Mac:
//   brew install redis
//   redis-server
//
// Ubuntu/Debian:
//   sudo apt install redis-server
//   redis-server
//
// Windows:
//   Use WSL2 (Windows Subsystem for Linux), then follow Ubuntu steps above.
//   OR use the official Redis Docker image:
//   docker run -p 6379:6379 redis
//
// Verify Redis is running:
//   redis-cli ping   ← should respond with PONG
//
// ─────────────────────────────────────────────────────────────────────────────
//
// HOW TO RUN CLICK COUNTER V2
//
// Prerequisites: Redis must be running (see above)
//
// 1. Start the backend:
//    cd backend
//    go mod tidy          ← downloads the go-redis dependency
//    go run main.go       ← starts server on port 8000
//
// 2. Open the frontend:
//    cd frontend
//    python3 -m http.server 3000
//    Then visit: http://localhost:3000
//
// Backend:  http://localhost:8000
// Frontend: http://localhost:3000
// Redis:    localhost:6379
//
// =============================================================================

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	// go-redis is the one external dependency we allow.
	// After running "go mod tidy" Go will download it automatically.
	// Import path convention in Go:  github.com/owner/repo/vN
	// The "/v9" suffix means version 9 of the API (breaking changes from v8).
	"github.com/redis/go-redis/v9"
)

// =============================================================================
// CONSTANTS
// =============================================================================

// redisKey is the Redis key that stores our counter.
// Using a named constant avoids "magic strings" scattered through the code.
const redisKey = "click_counter"

// =============================================================================
// GLOBAL REDIS CLIENT
// =============================================================================
//
// WHAT IS go-redis?
// It is the Go client library for Redis — it handles the TCP connection,
// the RESP protocol (Redis Serialization Protocol), connection pooling,
// and gives us clean Go functions like rdb.Get(), rdb.IncrBy(), etc.
//
// WHY GLOBAL?
// Creating a Redis client is expensive (it opens a connection pool).
// We create it once at startup and reuse it for every request.
// In Go, the redis.Client type is safe for concurrent use from multiple
// goroutines, so sharing it globally is idiomatic and correct.
var rdb *redis.Client

// ctx is the background context passed to every Redis call.
// Contexts in Go carry deadlines, cancellation signals, and request-scoped
// values.  context.Background() is the root — no deadline, never cancelled.
// For production you'd use per-request contexts with timeouts.
var ctx = context.Background()

// =============================================================================
// MAIN — ENTRY POINT
// =============================================================================
//
// WHAT IS Go's net/http vs Python's http.server?
// ───────────────────────────────────────────────
// Python's http.server is a single-threaded server primarily for local dev.
// One slow request blocks all other requests.
//
// Go's net/http is a production-grade HTTP/1.1 + HTTP/2 server built into
// the standard library.  For EVERY incoming request Go spawns a lightweight
// goroutine (think: a very cheap thread — only ~2 KB of stack to start vs
// ~1 MB for an OS thread).  This means thousands of concurrent requests can
// be handled simultaneously with no async/await ceremony.
func main() {
	// ── Connect to Redis ────────────────────────────────────────────────────
	rdb = redis.NewClient(&redis.Options{
		Addr: "localhost:6379", // default Redis port
		// Password: "", // leave empty if Redis has no AUTH configured
		DB: 0, // Redis supports multiple databases (0–15); we use the default
	})

	// Quick connectivity check: PING Redis and expect PONG back.
	if err := rdb.Ping(ctx).Err(); err != nil {
		// log.Fatal prints the error then calls os.Exit(1).
		// We crash loudly on startup so the problem is obvious.
		log.Fatal("Cannot connect to Redis:", err)
	}
	fmt.Println("Connected to Redis at localhost:6379")

	// ── Register route handlers ─────────────────────────────────────────────
	//
	// WHAT IS A HANDLER FUNCTION IN Go?
	// ───────────────────────────────────────────────────────────────────────
	// http.HandleFunc maps a URL path to a Go function with this exact
	// signature:
	//
	//   func(w http.ResponseWriter, r *http.Request)
	//
	//   w  (ResponseWriter) — an interface with methods to write headers and
	//      the response body BACK to the client.  Think of it as Python's
	//      self.send_response() / self.wfile.write().
	//
	//   r  (*Request) — a pointer to an object containing everything about the
	//      incoming request: method, URL, headers, body, query params, etc.
	//
	// Go's HTTP router is simple: exact string matches only.
	// For complex routing (parameters, wildcards) people use third-party
	// routers like gorilla/mux or chi, but we don't need them here.
	http.HandleFunc("/count", handleCount)
	http.HandleFunc("/click", handleClick)

	// Anything that doesn't match the routes above falls here.
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r) // sends 404
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Click Counter v2 backend is running"))
	})

	// ── Start the HTTP server ───────────────────────────────────────────────
	port := ":8000"
	fmt.Printf("Server listening on http://localhost%s\n", port)

	// http.ListenAndServe blocks forever, accepting connections.
	// It returns only if there's a fatal error (e.g. port already in use).
	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatal("Server error:", err)
	}
}

// =============================================================================
// HANDLER: GET /count
// =============================================================================
// Returns the current click total stored in Redis.
// Response:  { "count": N }
func handleCount(w http.ResponseWriter, r *http.Request) {
	// Always add our headers first (before any status code or body).
	addCommonHeaders(w)

	// Handle the browser's CORS pre-flight request (see addCommonHeaders for
	// a full explanation of what CORS is).
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent) // 204 — no body needed for pre-flight
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed) // 405
		return
	}

	// ── Read from Redis ──────────────────────────────────────────────────────
	// rdb.Get returns the value as a string (Redis stores everything as bytes).
	// If the key doesn't exist yet, it returns redis.Nil (a special error value).
	val, err := rdb.Get(ctx, redisKey).Int64()
	if err == redis.Nil {
		// Key doesn't exist yet — first ever load, count is 0.
		val = 0
	} else if err != nil {
		// Real Redis error (connection lost, OOM, etc.)
		http.Error(w, "Redis error", http.StatusInternalServerError) // 500
		return
	}

	sendJSON(w, map[string]int64{"count": val})
}

// =============================================================================
// HANDLER: POST /click
// =============================================================================
// Receives a batch of clicks, atomically increments Redis, returns new total.
// Request body:  { "clicks": N }
// Response:      { "count": newTotal }
func handleClick(w http.ResponseWriter, r *http.Request) {
	addCommonHeaders(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed) // 405
		return
	}

	// ── Parse the JSON request body ──────────────────────────────────────────
	//
	// WHAT IS json.NewDecoder(r.Body)?
	// ────────────────────────────────────────────────────────────────────────
	// r.Body is an io.ReadCloser — a stream of bytes coming from the network.
	// json.NewDecoder wraps that stream in a JSON decoder so we can call
	// .Decode(&target) to parse the JSON incrementally without reading the
	// entire body into memory first.
	//
	// This is better than json.Unmarshal(entireBody, &target) for large
	// payloads because it doesn't require buffering everything first.
	// For our tiny { "clicks": N } body the difference is negligible, but
	// it's the idiomatic Go pattern.
	//
	// We define an anonymous struct in-line to describe the expected shape.
	var body struct {
		Clicks int64 `json:"clicks"` // `json:"clicks"` tells the decoder which
		// JSON key maps to this struct field.
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Bad request: invalid JSON", http.StatusBadRequest) // 400
		return
	}

	if body.Clicks <= 0 {
		http.Error(w, "Bad request: clicks must be > 0", http.StatusBadRequest) // 400
		return
	}

	// ── Atomically increment in Redis using INCRBY ───────────────────────────
	//
	// WHAT IS INCRBY, AND WHY IS IT ATOMIC?
	// ────────────────────────────────────────────────────────────────────────
	// Redis INCRBY key delta
	// increments the integer stored at key by delta and returns the new value,
	// all in a single operation.
	//
	// WHY NOT: read → add → write?
	// Suppose two users click simultaneously.
	// Current value: 10
	//
	//   Without INCRBY (read → add → write):
	//     User A reads  10, computes 11, writes 11
	//     User B reads  10 (simultaneously!), computes 11, writes 11
	//     Final value:  11  ← WRONG! One click was lost.
	//
	//   With INCRBY:
	//     User A sends INCRBY 1 → Redis serialises the operation → returns 11
	//     User B sends INCRBY 1 → Redis serialises the operation → returns 12
	//     Final value:  12  ← CORRECT!
	//
	// Redis is single-threaded for command execution, so INCRBY is guaranteed
	// to be atomic — no two clients can interleave partial reads and writes.
	// This is a key reason to use Redis instead of a plain JSON file for any
	// data that multiple users can modify simultaneously.
	newTotal, err := rdb.IncrBy(ctx, redisKey, body.Clicks).Result()
	if err != nil {
		http.Error(w, "Redis error", http.StatusInternalServerError) // 500
		return
	}

	sendJSON(w, map[string]int64{"count": newTotal})
}

// =============================================================================
// HELPER: addCommonHeaders
// =============================================================================
//
// WHAT ARE CORS HEADERS?  (reinforcement from v1)
// ────────────────────────────────────────────────────────────────────────────
// CORS = Cross-Origin Resource Sharing.
// Browsers enforce a "same-origin policy": a page loaded from one origin
// (e.g. http://localhost:3000) CANNOT freely make requests to a different
// origin (http://localhost:8000) unless the SERVER explicitly says "that's OK"
// via special response headers.
//
// Without these headers the browser silently blocks our fetch() calls and the
// console shows: "Access-Control-Allow-Origin header missing".
//
// The three headers we set:
//
//	Access-Control-Allow-Origin: *
//	  "Any origin is allowed to read my responses."
//	  In production you'd restrict this to your specific frontend domain.
//
//	Access-Control-Allow-Methods: GET, POST, OPTIONS
//	  "These HTTP methods are allowed cross-origin."
//	  OPTIONS is the browser's CORS pre-flight method (it checks first).
//
//	Access-Control-Allow-Headers: Content-Type
//	  "The Content-Type header is allowed in cross-origin requests."
//	  Our POST request sends Content-Type: application/json, so we must list it.
//
// ─────────────────────────────────────────────────────────────────────────────
//
// WHAT IS HTTP KEEP-ALIVE?  (new in v2)
// ────────────────────────────────────────────────────────────────────────────
// When your browser makes an HTTP request it must first establish a TCP
// connection to the server.  That "TCP handshake" looks like this:
//
//	Browser → Server :  SYN         ("I want to connect")
//	Server  → Browser:  SYN-ACK     ("OK, I'm here")
//	Browser → Server :  ACK         ("Great, let's talk")
//	                       ↑ typically 1-3 round trips = 10–100 ms of latency
//
// Without Keep-Alive, every HTTP request needs a brand-new TCP handshake.
// With HTTP/1.1 Keep-Alive, the TCP connection stays open after the first
// request so subsequent requests skip the handshake entirely.
//
// For a click counter where the user rapidly clicks (triggering many requests),
// Keep-Alive means each batched POST reuses the same connection → noticeably
// faster, especially on mobile networks.
//
//	Connection: keep-alive       → "don't close this TCP connection after responding"
//	Keep-Alive: timeout=30       → "close it if idle for 30 seconds"
//
// Note: Go's net/http already handles Keep-Alive automatically in the
// transport layer; these headers make the intent explicit to the browser.
func addCommonHeaders(w http.ResponseWriter) {
	// CORS
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	// Keep-Alive
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Keep-Alive", "timeout=30")

	// Content type for all our responses
	w.Header().Set("Content-Type", "application/json")
}

// =============================================================================
// HELPER: sendJSON
// =============================================================================
// Marshals `payload` to JSON and writes it to the ResponseWriter.
// Using a helper keeps the handler functions clean and DRY.
func sendJSON(w http.ResponseWriter, payload interface{}) {
	w.WriteHeader(http.StatusOK) // 200

	// json.NewEncoder(w) writes directly to the ResponseWriter stream —
	// no intermediate string/byte-slice allocation needed.
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		// If encoding fails the response is already partially written,
		// so we can only log the error — we can't send a clean 500.
		log.Println("JSON encode error:", err)
	}
}
