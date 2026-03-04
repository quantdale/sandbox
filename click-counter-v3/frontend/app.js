// ============================================================================
// Click Counter v3 - Frontend Application
// ============================================================================
// 
// This frontend implements:
//   1. Dynamic card generation based on user input
//   2. Per-card state management (count, debounce timer, pending clicks)
//   3. Optimistic UI updates (show change immediately)
//   4. Debouncing (batch rapid clicks, send to server at intervals)
//   5. Server reconciliation (correct display if server count differs)
//
// Key Concepts:
//   - CLOSURE: Each card's click handler has access to its own cardId and state
//     via closure, so multiple cards can use the same pattern independently.
//   - DEBOUNCE: Instead of sending every click to the server, we wait 300ms
//     for the rate of clicks to slow, then send all pending clicks at once.
//   - OPTIMISTIC UI: We update the display before the server responds, so the
//     user feels instant feedback (v2 pattern carried forward).

// Configuration constants
const BACKEND_URL = "http://localhost:8000";
const DEBOUNCE_DELAY = 300; // milliseconds
const CARD_GRID_ID = "cardGrid";
const GENERATE_BTN_ID = "generateBtn";
const CARD_COUNT_INPUT_ID = "cardCount";

// ============================================================================
// Helper: Fetch All Existing Cards from Redis
// ============================================================================
// When the page loads, check if any cards were previously created.
// This lets us restore their counts from Redis without user action.
async function fetchExistingCards() {
  try {
    const response = await fetch(`${BACKEND_URL}/cards`);
    if (!response.ok) {
      console.error("Failed to fetch existing cards:", response.status);
      return [];
    }
    const data = await response.json();
    // data.cards is an array like ["card:1", "card:2", ...]
    return data.cards || [];
  } catch (error) {
    console.error("Error fetching existing cards:", error);
    return [];
  }
}

// ============================================================================
// Fetch Count for a Single Card
// ============================================================================
// Retrieves the current count for a card from the backend.
// cardId is just a number (1, 2, 3, etc.)
async function fetchCardCount(cardId) {
  try {
    const response = await fetch(`${BACKEND_URL}/count/${cardId}`);
    if (!response.ok) {
      console.error(`Failed to fetch count for card ${cardId}:`, response.status);
      return 0;
    }
    const data = await response.json();
    return data.count || 0;
  } catch (error) {
    console.error(`Error fetching count for card ${cardId}:`, error);
    return 0;
  }
}

// ============================================================================
// Fetch ALL Card Counts in Parallel
// ============================================================================
// Used when generating cards to quickly load all current counts from Redis.
// Returns a Map so we can look up counts by cardId.
async function fetchAllCardCounts(cardIds) {
  // Promise.all() waits for all requests to complete in parallel
  const requests = cardIds.map(id => 
    fetch(`${BACKEND_URL}/count/${id}`)
      .then(res => res.ok ? res.json() : { count: 0 })
      .catch(() => ({ count: 0 }))
  );
  
  const results = await Promise.all(requests);
  
  // Convert array of responses to Map for easy lookup
  const counts = new Map();
  cardIds.forEach((id, index) => {
    counts.set(id, results[index].count || 0);
  });
  return counts;
}

// ============================================================================
// Send Click Batch to Server
// ============================================================================
// This is called when the debounce timer expires.
// Sends N pending clicks for a specific card to the backend.
// 
// Parameters:
//   cardId: The card's unique identifier (1, 2, 3, ...)
//   clickCount: How many clicks to increment by
//
// Returns the new count from the server (for reconciliation).
async function submitClicks(cardId, clickCount) {
  try {
    const response = await fetch(`${BACKEND_URL}/click/${cardId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ clicks: clickCount }),
    });

    if (!response.ok) {
      console.error(`Failed to submit clicks for card ${cardId}:`, response.status);
      return null;
    }

    const data = await response.json();
    return data.count; // Server returns the new total count
  } catch (error) {
    console.error(`Error submitting clicks for card ${cardId}:`, error);
    return null;
  }
}

// ============================================================================
// Create a Single Card DOM Element
// ============================================================================
// Builds the HTML structure for one card.
// Each card is a fixed-size box (w-64 h-64 = 256px × 256px).
//
// Structure:
//   <div> (outer card container)
//     <div> (label - shows "Card #1" etc)
//     <div> (count display - shows the current count)
//     <button> (click button)
//     <div> (status - shows "syncing..." or "synced")
//
// Parameters:
//   cardId: Unique number for this card (1, 2, 3, ...)
//   initialCount: Starting count to display (fetched from Redis)
//
// Returns: The card <div> element (not yet inserted into DOM)
function createCardElement(cardId, initialCount) {
  const card = document.createElement("div");
  
  // Fixed-size card with Tailwind classes:
  // w-64 = width 16rem (256px)
  // h-64 = height 16rem (256px)
  // This ensures cards never shrink, no matter how many there are.
  card.className = "w-64 h-64 bg-white rounded-lg shadow-lg p-6 flex flex-col justify-between";
  
  // Card label (e.g., "Card #1")
  const label = document.createElement("div");
  label.className = "text-lg font-semibold text-gray-700";
  label.textContent = `Card #${cardId}`;
  
  // Large count display
  const countDisplay = document.createElement("div");
  countDisplay.className = "text-4xl font-bold text-blue-600 text-center";
  countDisplay.textContent = initialCount;
  
  // Click button
  const button = document.createElement("button");
  button.className = "px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors";
  button.textContent = "Click Me";
  
  // Status indicator (shows sync state)
  const status = document.createElement("div");
  status.className = "text-xs text-gray-500 text-center h-4";
  status.textContent = "ready";
  
  // Add all elements to the card
  card.appendChild(label);
  card.appendChild(countDisplay);
  card.appendChild(button);
  card.appendChild(status);
  
  return {
    element: card,
    countDisplay,
    button,
    status,
  };
}

// ============================================================================
// Set Up Click Handler for a Single Card
// ============================================================================
// This is where the CLOSURE magic happens:
//
// When we create a function here, it "closes over" the variables cardId,
// countDisplay, button, status, and the card's own state variables.
// Even though we call this function many times (once per card), each closure
// keeps its own separate copy of these variables. So card #5's debounce timer
// never interferes with card #10's debounce timer.
//
// Think of it like this: if a function is in a box and the box contains some
// variables, every time we create and return that function, it's a new box
// with the same structure but different variables inside.
//
// Parameters:
//   cardId: The card's unique ID
//   countDisplay: DOM element to update with the count
//   button: The click button to attach handler to
//   status: DOM element to show sync status
//   initialCount: Starting count from Redis
function setupCardClickHandler(cardId, countDisplay, button, status, initialCount) {
  // ========================================================================
  // Per-Card State (Closure Variables)
  // ========================================================================
  // Each card has its own independent state that persists across clicks.
  // These variables live inside the closure and are only accessible to
  // the functions defined below.
  
  let currentCount = initialCount;        // Display value (may be ahead of server)
  let pendingClicks = 0;                  // Clicks not yet sent to server
  let debounceTimer = null;               // Timer handle for debouncing
  let isSyncing = false;                  // Whether we're waiting for server response

  // ========================================================================
  // The Click Handler (called every time button is clicked)
  // ========================================================================
  async function handleClick() {
    // 1. OPTIMISTIC UI: Immediately increment and update the display.
    //    This makes the UI feel responsive even before the server responds.
    pendingClicks++;
    currentCount++;
    countDisplay.textContent = currentCount;
    status.textContent = "pending...";

    // 2. DEBOUNCE: If a debounce timer is already running, cancel it.
    //    This way, if the user clicks rapidly, we don't keep resetting the timer.
    //    We wait until 300ms passes with no new clicks, then send all pending clicks together.
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    // 3. START NEW DEBOUNCE TIMER
    //    After 300ms of inactivity, send all pending clicks to the server.
    debounceTimer = setTimeout(async () => {
      if (pendingClicks === 0) {
        status.textContent = "ready";
        return;
      }

      status.textContent = "syncing...";
      isSyncing = true;

      // 4. SEND TO SERVER
      //    submitClicks returns the new count from the server.
      const serverCount = await submitClicks(cardId, pendingClicks);

      // 5. RECKON (Reconciliation)
      //    If server count doesn't match our optimistic count, correct it.
      //    This handles cases where the network was slow or the server state changed.
      if (serverCount !== null) {
        currentCount = serverCount;
        countDisplay.textContent = currentCount;
        pendingClicks = 0;
        status.textContent = "synced";
      } else {
        // If the request failed, we keep the pending clicks to retry
        status.textContent = "error — retrying...";
        pendingClicks = pendingClicks; // Do nothing, retry on next click
      }

      isSyncing = false;
      debounceTimer = null;
    }, DEBOUNCE_DELAY);
  }

  // Attach the click handler to the button
  button.addEventListener("click", handleClick);
}

// ============================================================================
// Generate Cards (Main Entry Point)
// ============================================================================
// This is called when the user clicks the "Generate Cards" button.
// It reads the input value, creates that many cards, and fetches their counts.
async function generateCards() {
  // 1. Read how many cards the user wants
  const input = document.getElementById(CARD_COUNT_INPUT_ID);
  const cardCount = parseInt(input.value, 10);

  if (isNaN(cardCount) || cardCount < 1 || cardCount > 1000) {
    alert("Please enter a valid number between 1 and 1000.");
    return;
  }

  // 2. Clear the existing cards
  const grid = document.getElementById(CARD_GRID_ID);
  grid.innerHTML = "";

  // 3. Create array of card IDs [1, 2, 3, ..., cardCount]
  const cardIds = Array.from({ length: cardCount }, (_, i) => i + 1);

  // 4. Fetch all counts from Redis in parallel
  //    This is much faster than fetching them one-by-one.
  const counts = await fetchAllCardCounts(cardIds);

  // 5. Create and render each card
  //    Use document.createElement to dynamically build DOM elements.
  //    (If you were using React, it would do this automatically, but we're using vanilla JS)
  for (const cardId of cardIds) {
    const initialCount = counts.get(cardId) || 0;
    const { element, countDisplay, button, status } = createCardElement(cardId, initialCount);

    // Set up this card's click handler with its own closure
    setupCardClickHandler(cardId, countDisplay, button, status, initialCount);

    // Insert the card into the page
    grid.appendChild(element);
  }

  console.log(`Generated ${cardCount} cards.`);
}

// ============================================================================
// Initialize on Page Load
// ============================================================================
// When the page first loads, check if any cards exist and restore them.
async function initializeApp() {
  const generateBtn = document.getElementById(GENERATE_BTN_ID);
  
  // Attach the click handler to the "Generate Cards" button
  generateBtn.addEventListener("click", generateCards);

  // Optionally: Restore previous cards if they exist
  // Uncomment this to auto-restore cards from a previous session:
  /*
  const existingCards = await fetchExistingCards();
  if (existingCards.length > 0) {
    // Extract card numbers from keys like "card:1" -> 1
    const cardIds = existingCards
      .map(key => parseInt(key.split(":")[1], 10))
      .sort((a, b) => a - b);
    
    const counts = await fetchAllCardCounts(cardIds);
    const grid = document.getElementById(CARD_GRID_ID);
    grid.innerHTML = "";
    
    for (const cardId of cardIds) {
      const initialCount = counts.get(cardId) || 0;
      const { element, countDisplay, button, status } = createCardElement(cardId, initialCount);
      setupCardClickHandler(cardId, countDisplay, button, status, initialCount);
      grid.appendChild(element);
    }
  }
  */
}

// When the HTML is fully loaded, initialize the app
document.addEventListener("DOMContentLoaded", initializeApp);
