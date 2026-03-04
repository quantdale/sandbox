# =============================================================================
# HOW TO RUN THIS PROJECT
#
# 1. Start the backend:
#    cd Click-counter/backend
#    python server.py          (or python3 server.py on Mac/Linux)
#
# 2. Open the frontend:
#    Open frontend/index.html directly in your browser
#    OR serve it with:  cd Click-counter/frontend && python -m http.server 3000
#    Then visit: http://localhost:3000
#
# The backend runs on http://localhost:8000
# The frontend runs on http://localhost:3000 (or opened directly as a file)
# =============================================================================

# --- What is an HTTP server? ---
# An HTTP server is a program that listens on a network port and waits for
# incoming HTTP requests (like when your browser asks for a webpage). When a
# request comes in, the server decides what to do with it (this is called
# "handling" the request) and sends back a response.

import json                          # For reading/writing JSON data
from http.server import (            # Python's built-in HTTP server tools
    HTTPServer,                      # The server itself — listens for connections
    BaseHTTPRequestHandler,          # A base class we customize to handle requests
)
import os                            # For file-path operations

# Path to our "database" file, located in the same folder as this script.
# os.path.dirname(__file__) gives us the directory where server.py lives,
# so counter.json will always be found next to it regardless of where we
# run the command from.
COUNTER_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "counter.json")


def read_count():
    """
    Read the current click count from counter.json.
    If the file doesn't exist yet, return 0 as the starting value.
    """
    # --- What is JSON deserialization? ---
    # JSON (JavaScript Object Notation) is a text format for storing data.
    # "Deserialization" means converting that text into a Python object
    # (like a dictionary). We use json.load() to do this.
    try:
        with open(COUNTER_FILE, "r") as f:
            data = json.load(f)          # Turn the file's JSON text → Python dict
            return data.get("count", 0)  # Safely get "count"; default to 0
    except (FileNotFoundError, json.JSONDecodeError):
        # File missing or corrupted — start fresh at 0
        return 0


def write_count(count):
    """
    Save the new click count to counter.json.
    """
    # --- What is JSON serialization? ---
    # "Serialization" is the reverse: converting a Python object (dict) into
    # a JSON-formatted string so it can be stored in a file or sent over the
    # network. json.dump() writes JSON directly to an open file.
    with open(COUNTER_FILE, "w") as f:
        json.dump({"count": count}, f)


# --- What is a request handler class? ---
# BaseHTTPRequestHandler is a built-in Python class that knows how to parse
# raw HTTP requests. We *override* (replace) specific methods so we can
# define what happens when the server receives a GET or POST request.
# Think of it like filling in blanks in a template — Python handles the
# boring networking parts; we just define the interesting logic.

class ClickHandler(BaseHTTPRequestHandler):
    """Handles incoming HTTP requests for our click-counter API."""

    # -----------------------------------------------------------------
    # CORS helper
    # -----------------------------------------------------------------
    def send_cors_headers(self):
        """
        --- What is CORS and why is it needed here? ---

        CORS = Cross-Origin Resource Sharing.

        Browsers enforce a security rule called the "Same-Origin Policy":
        a webpage loaded from one origin (e.g. http://localhost:3000) is
        NOT allowed to make requests to a DIFFERENT origin
        (e.g. http://localhost:8000) unless the server explicitly says
        "I allow this."

        Our frontend (port 3000) and backend (port 8000) have different
        origins because their ports differ. Without these headers the
        browser would block the request before it even reaches our code.

        What the headers do:
        • Access-Control-Allow-Origin: "*"
              → "Any origin is allowed to talk to me."
              (For a real app you'd list specific domains instead of *.)
        • Access-Control-Allow-Methods: "GET, POST, OPTIONS"
              → "These HTTP methods are permitted."
        • Access-Control-Allow-Headers: "Content-Type"
              → "The request may include a Content-Type header."
        """
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    # -----------------------------------------------------------------
    # Helper: send a JSON response
    # -----------------------------------------------------------------
    def respond_json(self, status_code, data):
        """
        Send a JSON response back to the client.

        --- What is a status code? ---
        Every HTTP response includes a three-digit number that tells the
        client what happened:
          • 200 — "OK, everything went well."
          • 404 — "Not Found — the URL you asked for doesn't exist."
          • 405 — "Method Not Allowed — you used GET when I expected POST
                   (or vice versa)."

        Parameters
        ----------
        status_code : int   — the HTTP status code to return
        data        : dict  — a Python dictionary to convert to JSON
        """
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_cors_headers()
        self.end_headers()

        # json.dumps() converts a Python dict → JSON string,
        # then .encode() turns the string into raw bytes for sending.
        self.wfile.write(json.dumps(data).encode())

    # -----------------------------------------------------------------
    # Handle OPTIONS requests (CORS "preflight")
    # -----------------------------------------------------------------
    def do_OPTIONS(self):
        """
        Browsers sometimes send an OPTIONS request *before* the real
        request to ask: "Hey server, will you accept my upcoming POST?"
        This is called a "preflight" request. We just reply with the
        CORS headers and a 200 OK so the browser continues.
        """
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    # -----------------------------------------------------------------
    # Handle GET requests
    # -----------------------------------------------------------------
    def do_GET(self):
        """
        --- What does do_GET mean? ---
        This method is called automatically whenever the server receives
        an HTTP GET request. GET is the standard method for *retrieving*
        data — it should never change anything on the server.

        Routes:
          GET /count  → return the current click count
          anything else → 404 Not Found
        """
        if self.path == "/count":
            count = read_count()
            self.respond_json(200, {"count": count})
        else:
            self.respond_json(404, {"error": "Not found"})

    # -----------------------------------------------------------------
    # Handle POST requests
    # -----------------------------------------------------------------
    def do_POST(self):
        """
        --- What does do_POST mean? ---
        This method is called automatically whenever the server receives
        an HTTP POST request. POST is typically used when you want to
        *send data* to the server or *trigger an action* (like
        incrementing the counter).

        Routes:
          POST /click → increment the counter by 1 and return the new count
          anything else → 404 Not Found
        """
        if self.path == "/click":
            count = read_count() + 1     # Read the old count, add 1
            write_count(count)           # Save the new count to disk
            self.respond_json(200, {"count": count})
        else:
            self.respond_json(404, {"error": "Not found"})


# --- Starting the server ---
# HTTPServer takes two arguments:
#   1. A tuple of (host, port) — '' means "listen on all network interfaces".
#   2. The request handler class we defined above.
# serve_forever() keeps the server running in an infinite loop, waiting for
# requests until you stop it with Ctrl+C.

if __name__ == "__main__":
    PORT = 8000
    server = HTTPServer(("", PORT), ClickHandler)
    print(f"Backend server running on http://localhost:{PORT}")
    print("Press Ctrl+C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()
