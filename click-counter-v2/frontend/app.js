// =============================================================================
// Click Counter v2 — app.js
// =============================================================================
// New concepts introduced in this file (vs v1):
//   1. Optimistic UI Update
//   2. Debouncing with setTimeout / clearTimeout
//   3. Tracking "pending clicks" separately from the displayed count
//   4. Server reconciliation (correcting the optimistic value with the real one)
// =============================================================================

// ── DOM References ────────────────────────────────────────────────────────────
// We grab these elements once at startup so we don't query the DOM on every click.
const countDisplay = document.getElementById("count-display");
const clickBtn     = document.getElementById("click-btn");
const statusLabel  = document.getElementById("status-label");

// ── Backend URL ───────────────────────────────────────────────────────────────
const BACKEND = "http://localhost:8000";

// ── Polling interval ─────────────────────────────────────────────────────────
// How often (ms) we ask the server for the authoritative count so that
// changes made by OTHER browser tabs or users are reflected here too.
const POLL_INTERVAL_MS = 30;

// =============================================================================
// STATE VARIABLES
// =============================================================================

// displayedCount
// ──────────────
// This is the number currently shown in the DOM.
// We keep an explicit JS variable so we can do maths on it without
// reading/parsing the DOM text on every click (faster and more reliable).
let displayedCount = 0;

// pendingClicks
// ─────────────
// WHAT IS "PENDING CLICKS"?
// When the user clicks faster than we send requests (we batch them via
// debouncing), we need to remember how many clicks have NOT yet been sent
// to the server.  "pendingClicks" is that accumulator.
//
// Example:
//   User clicks 4 times within 300 ms.
//   displayedCount goes 0 → 1 → 2 → 3 → 4  (optimistic, instant)
//   pendingClicks   goes 0 → 1 → 2 → 3 → 4
//   After 300 ms of silence the debounce fires, we POST { clicks: 4 },
//   then reset pendingClicks to 0.
//
// Why track this separately?
// Because we must tell the server the EXACT increment since the last sync,
// not the absolute displayed count (which could already include previously
// confirmed clicks).
let pendingClicks = 0;

// debounceTimer
// ─────────────
// setTimeout returns a numeric ID so we can cancel it later with clearTimeout.
// We store that ID here so the debounce logic can reset the countdown on
// every new click that arrives before the timer fires.
let debounceTimer = null;

// =============================================================================
// STEP 1 — FETCH THE CURRENT COUNT ON PAGE LOAD
// =============================================================================
// When the page first loads we ask the backend for the latest stored count
// so we start from the real persisted value, not zero.
async function loadInitialCount() {
  try {
    const res  = await fetch(`${BACKEND}/count`);
    const data = await res.json();           // { "count": N }
    displayedCount = data.count;
    countDisplay.textContent = displayedCount;
    setStatus("synced");
  } catch (err) {
    // If Redis or the backend is down the page still works — we just start at 0.
    console.error("Could not load initial count:", err);
    setStatus("offline");
  }
}

loadInitialCount();

// =============================================================================
// STEP 1b — BACKGROUND POLLING (multi-tab / multi-user sync)
// =============================================================================
// WHY DO WE NEED POLLING?
// The optimistic update + debounce approach keeps ONLY the current tab in
// sync with the server after the user clicks.  But if another browser tab or
// another user clicks, the Redis value on the server quietly grows while our
// display stays frozen at the old number.
//
// Polling solves this by repeatedly asking: "Hey server, what's the real count?"
// and correcting our display if it has drifted.
//
// WHY SKIP WHILE pendingClicks > 0?
// If the user is mid-burst (e.g. clicking 5 times quickly), pendingClicks is
// non-zero — we have optimistic increments not yet confirmed.  If we let the
// poll run at that moment it would fetch the *old* server value (before our
// batch lands) and overwrite the user's just-clicked optimistic count,
// causing the counter to appear to jump backwards.  We skip safely and the
// next poll (3 s later) will see the already-confirmed value.
async function pollCount() {
  // Don't race with an in-flight click batch.
  if (pendingClicks > 0) return;

  try {
    const res  = await fetch(`${BACKEND}/count`);
    const data = await res.json();   // { "count": N }

    if (data.count !== displayedCount) {
      // Another tab or user moved the counter — correct our display silently.
      displayedCount = data.count;
      countDisplay.textContent = displayedCount;
      // Briefly flash the status label so the user knows an external update arrived.
      setStatus("updated");
      setTimeout(() => setStatus("synced"), 1200);
    }
  } catch {
    // Ignore poll failures silently — the status label already shows "error"
    // if a user-initiated click failed; we don't want a background poll to
    // overwrite that with its own noise.
  }
}

// Start polling after the initial load.
setInterval(pollCount, POLL_INTERVAL_MS);

// =============================================================================
// STEP 2 — HANDLE A BUTTON CLICK
// =============================================================================
clickBtn.addEventListener("click", () => {

  // ── OPTIMISTIC UI UPDATE ──────────────────────────────────────────────────
  //
  // WHAT IS OPTIMISTIC UI?
  // Instead of waiting for the server to confirm the click, we immediately
  // update the number on screen as if the server already said "yes".
  // We are "optimistic" that the server will succeed.
  //
  // WHY DOES THIS MAKE APPS FEEL FASTER?
  // A round-trip to the server takes anywhere from 10 ms (LAN) to 300+ ms
  // (mobile network).  If we waited for the server before updating the UI,
  // the button would feel sluggish — the user clicks and nothing visible
  // happens for a noticeable moment.  By updating instantly we give
  // immediate feedback: the app feels snappy, like a native desktop app.
  //
  // Apps like Gmail, Twitter/X, and GitHub all use this pattern — e.g. the
  // "like" button changes colour the instant you tap it.

  displayedCount += 1;                        // increment our local state
  countDisplay.textContent = displayedCount;  // show the new value immediately
  pendingClicks  += 1;                        // remember this click hasn't been sent yet

  // Show "syncing…" while unconfirmed clicks are queued up.
  setStatus("syncing\u2026");

  // ── DEBOUNCING ────────────────────────────────────────────────────────────
  //
  // WHAT IS DEBOUNCING?
  // Debouncing means: "don't act yet — wait until the user STOPS doing
  // something for a set amount of time, then act once."
  //
  // Without debouncing, clicking the button 10 times quickly would fire
  // 10 separate HTTP requests.  Each request costs:
  //   • A TCP connection (or keep-alive slot)
  //   • Server CPU to parse it
  //   • A Redis round-trip
  //   • A response sent back
  // That's a lot of overhead for something the user will never notice.
  //
  // With debouncing (300 ms window here), those 10 clicks become ONE request:
  //   POST /click  { "clicks": 10 }
  // The server does one atomic INCRBY 10 and replies once.
  //
  // DEBOUNCING vs THROTTLING (quick note):
  //   Throttling  → fire at most once per interval, even if events keep coming.
  //   Debouncing  → fire only AFTER events stop for an interval.
  // For a click counter, debouncing is better because we want to batch ALL
  // rapid clicks into one request, not just limit the rate.
  //
  // HOW setTimeout AND clearTimeout ENABLE DEBOUNCING:
  //
  //   setTimeout(fn, 300)
  //     Schedules fn to run after 300 ms.
  //     Returns a numeric timer ID.
  //
  //   clearTimeout(id)
  //     Cancels the scheduled timer so fn never runs.
  //
  // Pattern used here:
  //   1. On every click, CANCEL the existing timer (if any).
  //   2. Start a FRESH 300 ms countdown.
  //   3. If another click arrives within 300 ms, go back to step 1.
  //   4. When 300 ms pass with no new clicks, the timer fires → sendClicks().
  //
  // Step 1: cancel any in-flight countdown so it doesn't trigger early.
  clearTimeout(debounceTimer);

  // Step 2: start a new 300 ms countdown.
  debounceTimer = setTimeout(sendClicks, 300);
});

// =============================================================================
// STEP 3 — SEND BATCHED CLICKS TO THE SERVER
// =============================================================================
async function sendClicks() {
  // Snapshot the pending count now.  If more clicks arrive while the fetch
  // is in-flight, they will start a new batch cleanly.
  const clicksToSend = pendingClicks;
  pendingClicks = 0;    // reset BEFORE the await so concurrent clicks don't
                        // get swallowed into this batch's confirm logic

  try {
    const res = await fetch(`${BACKEND}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Send the batch size, not the absolute counter.
      // The server does:  stored_total = stored_total + clicksToSend
      body: JSON.stringify({ clicks: clicksToSend }),
    });

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    const data = await res.json();  // { "count": confirmedTotal }

    // ── SERVER RECONCILIATION ───────────────────────────────────────────────
    //
    // WHAT IS SERVER RECONCILIATION?
    // After showing the optimistic value, we receive the server's confirmed
    // value.  In a single-user scenario they should match.  But if two users
    // are clicking simultaneously, the server's Redis counter is the source
    // of truth, and our local count could be wrong.
    //
    // We compare the two values:
    //   • If they match  → perfect, show "synced".
    //   • If they differ → the server wins; we silently correct the display.
    //     The user sees the display jump to the correct value (usually only
    //     a frame or two after the optimistic update — barely noticeable).
    //
    // This pattern is called "optimistic update with server correction"
    // and is used in Google Docs, Figma, and many real-time collaborative apps.

    const confirmedCount = data.count;

    if (confirmedCount !== displayedCount) {
      // The server knows something we don't (e.g. another user clicked too).
      // Correct our display to the authoritative value.
      displayedCount = confirmedCount;
      countDisplay.textContent = displayedCount;
    }

    setStatus("synced");

  } catch (err) {
    // Network error or server down.
    // We DON'T roll back the optimistic count — that would confuse the user.
    // Instead we restore pendingClicks so the next debounce batch will
    // re-include these clicks when connectivity returns.
    // (For a production app you'd add retry logic here.)
    pendingClicks += clicksToSend;  // put them back
    console.error("Failed to sync clicks:", err);
    setStatus("error");
  }
}

// =============================================================================
// HELPER — UPDATE THE STATUS LABEL
// =============================================================================
// Centralising status updates keeps the rest of the code clean.
// Each status string is mapped to a Tailwind text colour class.
function setStatus(state) {
  const config = {
    "synced":        { text: "synced",     color: "text-green-500"  },
    "syncing\u2026": { text: "syncing\u2026", color: "text-yellow-500" },
    "error":         { text: "error",      color: "text-red-500"    },
    "offline":       { text: "offline",    color: "text-gray-400"   },
    // "updated" appears briefly when a poll detects an external change.
    "updated":       { text: "\u2191 updated", color: "text-purple-500" },
  };

  const c = config[state] ?? { text: state, color: "text-gray-400" };

  // Remove all possible colour classes before applying the new one.
  statusLabel.classList.remove("text-green-500", "text-yellow-500", "text-red-500", "text-gray-400", "text-purple-500");
  statusLabel.classList.add(c.color);
  statusLabel.textContent = c.text;
}
