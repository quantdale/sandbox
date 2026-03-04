// =============================================================================
// app.js — Frontend logic for the Click Counter
// =============================================================================

// The URL where our Python backend is running.
// Because the backend is on port 8000 and the frontend may be served from
// port 3000 (or opened as a file), these are different "origins."
const API_BASE = "http://localhost:8000";

// Grab references to the HTML elements we need to interact with.
const counterDisplay = document.getElementById("counter-display");
const clickBtn       = document.getElementById("click-btn");
const errorMsg       = document.getElementById("error-msg");

// =============================================================================
// 1.  FETCH THE CURRENT COUNT WHEN THE PAGE LOADS
// =============================================================================

/*
 * --- What is fetch()? ---
 * fetch() is a built-in browser function for making HTTP requests (the same
 * kind of requests your browser makes when you type a URL into the address
 * bar). It returns a *Promise* — an object that represents a value that
 * isn't available yet but will be in the future (because network requests
 * take time).
 *
 * --- GET vs POST requests ---
 * • GET  — "Give me some data."  (fetch defaults to GET)
 * • POST — "Here is some data; please do something with it."
 *
 * We use GET to *read* the current count, and POST to *increment* it.
 *
 * --- What is async / await? ---
 * Normally, JavaScript doesn't wait for a network request to finish before
 * running the next line of code ("non-blocking"). The `async` keyword marks
 * a function that contains asynchronous operations. Inside that function, the
 * `await` keyword pauses execution until a Promise resolves (settles), so you
 * can write asynchronous code that *reads* like normal, sequential code.
 *
 * --- What does response.json() do? ---
 * The server sends its response as a raw text string of JSON. Calling
 * response.json() parses that string and converts it into a real JavaScript
 * object that we can use (e.g., { count: 5 }).
 *
 * --- What is CORS and why might it cause problems? ---
 * CORS stands for Cross-Origin Resource Sharing. Browsers block web pages
 * from making requests to a *different origin* (different domain, port, or
 * protocol) unless the server explicitly allows it by including special HTTP
 * headers (Access-Control-Allow-Origin, etc.). Our backend adds those headers
 * so the browser lets the request through. Without them you'd see an error
 * like "CORS policy: No 'Access-Control-Allow-Origin' header" in the console.
 */

async function fetchCurrentCount() {
    try {
        // Send a GET request to the /count endpoint on our backend.
        // fetch() returns a Promise; `await` waits for the response.
        const response = await fetch(`${API_BASE}/count`);

        // response.json() also returns a Promise, so we await it too.
        // It converts the JSON string from the server into a JS object.
        const data = await response.json();

        // Update the text shown in the browser.
        counterDisplay.textContent = `Total Clicks: ${data.count}`;

        // Clear any previous error message.
        errorMsg.textContent = "";
    } catch (error) {
        // If the backend is not running, fetch() will throw a network error.
        // We display a friendly message instead of crashing silently.
        console.error("Could not fetch count:", error);
        errorMsg.textContent =
            "⚠️ Could not reach the backend. Is server.py running?";
    }
}

// Call the function immediately so the counter shows as soon as the page loads.
fetchCurrentCount();

// =============================================================================
// 2.  INCREMENT THE COUNT WHEN THE BUTTON IS CLICKED
// =============================================================================

async function incrementCount() {
    try {
        // Send a POST request to the /click endpoint.
        // For POST we need to supply a second argument (an options object)
        // telling fetch() the HTTP method to use.
        const response = await fetch(`${API_BASE}/click`, {
            method: "POST",                          // Use POST, not GET
            headers: { "Content-Type": "application/json" },
            // We aren't sending a body payload here — the server only needs
            // to know we hit /click — but the Content-Type header is good
            // practice and keeps the CORS preflight predictable.
        });

        // Parse the JSON response from the server: { "count": <number> }
        const data = await response.json();

        // Update the UI with the new count received from the server.
        counterDisplay.textContent = `Total Clicks: ${data.count}`;

        // Clear any previous error message.
        errorMsg.textContent = "";
    } catch (error) {
        console.error("Could not increment count:", error);
        errorMsg.textContent =
            "⚠️ Could not reach the backend. Is server.py running?";
    }
}

// Listen for clicks on the button and call incrementCount() each time.
clickBtn.addEventListener("click", incrementCount);

// =============================================================================
// SUMMARY — THE REQUEST-RESPONSE CYCLE (what happens when you click)
// =============================================================================
//
// 1. You click the "Click Me" button.
// 2. The browser runs incrementCount(), which calls fetch() to send an
//    HTTP POST request to http://localhost:8000/click.
// 3. The request travels over the network (localhost, in this case) to the
//    Python backend server.
// 4. The server's do_POST() method runs: it reads counter.json, adds 1 to
//    the count, writes the new value back, and sends a JSON response
//    like { "count": 6 } back to the browser.
// 5. The browser receives the response. response.json() converts the JSON
//    text into a JavaScript object.
// 6. We update the DOM (counterDisplay.textContent) so the user sees the
//    new total — all WITHOUT reloading the page.  This is how modern web
//    apps feel "instant."
//
// =============================================================================
// WHY TWO PORTS?
// =============================================================================
//
// A "port" is like a numbered door on your computer. Many programs can run
// on the same machine, but they each need their own port so the OS can tell
// them apart.
//
// • The backend (Python server) listens on port 8000.
// • The frontend (static file server) listens on port 3000.
//
// They are two separate programs, so they need two separate ports. Even
// though they are both on "localhost" (your own computer), the browser
// treats different ports as different origins — which is why CORS matters.
//
// =============================================================================
// WHAT IS AN API?
// =============================================================================
//
// An API (Application Programming Interface) is a set of rules that lets
// one program talk to another. In our case:
//
//   http://localhost:8000/click  ← This URL is an "API endpoint."
//
// It is NOT a webpage — it's a URL that accepts requests and returns raw
// data (JSON). The frontend (a program) sends a request; the backend
// (another program) processes it and sends data back. That data exchange
// contract is the API.
//
// =============================================================================
// WHY CORS?
// =============================================================================
//
// Browsers enforce a security rule: a page from Origin A cannot freely make
// requests to Origin B. This prevents malicious sites from secretly talking
// to your bank's servers, for example.
//
// Our frontend (http://localhost:3000) and backend (http://localhost:8000)
// are different origins (ports differ). The backend must send the header
// "Access-Control-Allow-Origin: *" so the browser says "OK, this server is
// fine with outside requests" and lets the response through.
//
// =============================================================================
// WHY JSON?
// =============================================================================
//
// JSON (JavaScript Object Notation) is a lightweight, text-based format
// that both JavaScript and Python understand easily. It's the "common
// language" between the frontend and backend. We could use plain text, but
// JSON gives us structured key-value data (like { "count": 5 }) which is
// much easier to work with than parsing a raw string.
// =============================================================================
