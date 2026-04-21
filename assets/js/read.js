import { supabase }         from "./app.js";
import { decryptMessage }   from "./crypto.js";

// DOM REFERENCES

// The 5 state panels (only one is visible at a time)
const stateLoading  = document.getElementById("stateLoading");
const stateLocked   = document.getElementById("stateLocked");
const stateRevealed = document.getElementById("stateRevealed");
const stateBurned   = document.getElementById("stateBurned");
const stateError    = document.getElementById("stateError");

// Elements inside the "locked" state
const lockedDescEl      = document.getElementById("lockedDesc");
const passwordFieldEl   = document.getElementById("passwordField");
const readerPasswordEl  = document.getElementById("readerPassword");
const toggleReaderPwBtn = document.getElementById("toggleReaderPw");
const wrongPasswordEl   = document.getElementById("wrongPasswordAlert");
const unlockBtn         = document.getElementById("unlockBtn");
const unlockBtnText     = document.getElementById("unlockBtnText");
const unlockSpinner     = document.getElementById("unlockSpinner");

// Elements inside the "revealed" state
const messageBoxEl  = document.getElementById("messageBox");
const copyMsgBtn    = document.getElementById("copyMsgBtn");
const copyMsgTextEl = document.getElementById("copyMsgText");

// NEW: shows burn/view-count info after decryption
// Add this line inside your stateRevealed panel in read.html:
// <p id="viewCountInfo" class="view-count-info"></p>
const viewCountInfoEl = document.getElementById("viewCountInfo");

// Error message element
const errorMsgEl = document.getElementById("errorMsg");

// STATE 
let currentNote = null;   // Holds the fetched note row from Supabase
let noteDeleted = false;  // Guard against double-deletes

// STEP 1: GET THE NOTE ID FROM THE URL
// URL looks like: read.html?id=some-uuid-here
const noteId = new URLSearchParams(window.location.search).get("id");

// STEP 2: FETCH THE NOTE
async function init() {

  if (!noteId) {
    showError("No note ID found in the URL. This link is invalid.");
    return;
  }

  try {

    const { data, error } = await supabase
      .from("notes")
      .select("*")
      .eq("id", noteId)
      .single();

    // Row doesn't exist — already burned or never existed
    if (error || !data) {
      showState("burned");
      return;
    }

    // Check expiry
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      await logAction(noteId, "expired"); // audit before deleting
      await deleteNote(noteId);
      showState("burned");
      return;
    }

    // Note is valid — store it
    currentNote = data;

    // Show the password field if this note has a password
    if (data.has_password) {
      passwordFieldEl.classList.remove("hidden");
      lockedDescEl.textContent =
        "This note is password protected. Enter the password to reveal it.";
      readerPasswordEl.focus();
    } else {
      lockedDescEl.textContent =
        "Click the button below to decrypt and reveal this message.";
    }

    showState("locked");

  } catch (err) {
    console.error("Fetch note error:", err);
    showError("Could not connect to the database. Please check your internet connection.");
  }
}

// ── PASSWORD VISIBILITY TOGGLE
toggleReaderPwBtn.addEventListener("click", () => {
  const isHidden = readerPasswordEl.type === "password";
  readerPasswordEl.type = isHidden ? "text" : "password";
});

// ALLOW PRESSING ENTER TO UNLOCK
readerPasswordEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") unlockNote();
});

// UNLOCK BUTTON
unlockBtn.addEventListener("click", unlockNote);

// STEP 3: DECRYPT + BURN / MAX VIEWS LOGIC
async function unlockNote() {
  if (!currentNote) return;

  const password = readerPasswordEl.value;
  wrongPasswordEl.classList.add("hidden");
  setUnlockLoading(true);

  try {

    // Parse the encrypted payload stored in Supabase
    const payload = JSON.parse(currentNote.message);
    const passKey = password || "public-mode";

    // Decrypt — throws DOMException if password is wrong
    const plaintext = await decryptMessage(
      payload.cipher,
      passKey,
      payload.salt,
      payload.iv
    );

    // Show the decrypted message on screen
    messageBoxEl.textContent = plaintext;
    showState("revealed");

    // NEW: Burn-after-reading OR multi-read decision
    //
    // burn_after_reading comes from the database column we added.
    // We default to TRUE if the column is missing (safe fallback —
    // old notes without the column will still be burned on read).

    const shouldBurn = currentNote.burn_after_reading !== false;
    //                                                  ↑
    // Using !== false (not === true) means:
    //   TRUE  → burn it     ✓
    //   NULL  → burn it     ✓  (safe default for old notes)
    //   FALSE → don't burn  ✓

    if (shouldBurn) {

      // SCENARIO A: One-time note (burn after reading)
      if (!noteDeleted) {
        noteDeleted = true;
        await logAction(noteId, "viewed");  // log it
        await deleteNote(noteId);           // then destroy it
      }

      if (viewCountInfoEl) {
        viewCountInfoEl.textContent =
          "This was a one-time note. It has been permanently destroyed.";
      }

    } else {

      // SCENARIO B: Multi-read note
      // 1. Add 1 to view_count in the database
      // 2. Log the view in the audit table
      // 3. Check if max_views has been reached
      //    → Yes: delete the note, tell the user it's gone
      //    → No:  tell the user how many reads are left
      //    → No max_views set: tell the user the expiry date

      // Calculate the new view count
      // ?? 0 means: if view_count is null/undefined, treat it as 0
      const newViewCount = (currentNote.view_count ?? 0) + 1;

      // Save the new view count to Supabase
      await supabase
        .from("notes")
        .update({ view_count: newViewCount })
        .eq("id", noteId);

      // Write a "viewed" row to the audit log
      await logAction(noteId, "viewed");

      // Get the max_views limit (null = no limit)
      const maxViews = currentNote.max_views;

      if (maxViews !== null && newViewCount >= maxViews) {

        // Max views reached → delete the note
        if (!noteDeleted) {
          noteDeleted = true;
          await deleteNote(noteId);
        }

        if (viewCountInfoEl) {
          viewCountInfoEl.textContent =
            `This note reached its limit of ${maxViews} view(s) and has been destroyed.`;
        }

      } else if (maxViews !== null) {

        // Still reads left → show the remaining count
        const readsLeft = maxViews - newViewCount;

        if (viewCountInfoEl) {
          viewCountInfoEl.textContent =
            `This note can be read ${readsLeft} more time(s) before it self-destructs.`;
        }

      } else {

        // No max_views set → note lives until expires_at
        const expiresAt = new Date(currentNote.expires_at).toLocaleString();

        if (viewCountInfoEl) {
          viewCountInfoEl.textContent =
            `This note expires on ${expiresAt}.`;
        }
      }
    }

  } catch (err) {

    // AES-GCM throws DOMException when the password is wrong
    if (err instanceof DOMException) {
      wrongPasswordEl.classList.remove("hidden");
      readerPasswordEl.value = "";
      readerPasswordEl.focus();
    } else {
      console.error("Decrypt error:", err);
      showError("Decryption failed. The note may be corrupted.");
    }

  } finally {
    setUnlockLoading(false);
  }
}

// COPY MESSAGE BUTTON
copyMsgBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(messageBoxEl.textContent);
    copyMsgTextEl.textContent = "Copied!";
    setTimeout(() => { copyMsgTextEl.textContent = "Copy Message"; }, 2000);
  } catch {
    window.prompt("Copy the message below:", messageBoxEl.textContent);
  }
});

// HELPER: delete a note from Supabase
async function deleteNote(id) {
  try {
    await supabase.from("notes").delete().eq("id", id);
  } catch (err) {
    console.warn("Could not delete note:", err);
  }
}

// NEW HELPER: write a row to the audit log
// action must be one of: "viewed" | "deleted" | "expired"
// Wrapped in try/catch so a log failure never crashes the app.
async function logAction(id, action) {
  try {
    await supabase.from("note_access_log").insert({
      note_id: id,
      action:  action,
    });
  } catch (err) {
    console.warn("Audit log failed (non-critical):", err);
  }
}

// HELPER: switch which state panel is visible
function showState(stateName) {
  const states = {
    loading:  stateLoading,
    locked:   stateLocked,
    revealed: stateRevealed,
    burned:   stateBurned,
    error:    stateError,
  };

  Object.values(states).forEach(el => el.classList.add("hidden"));

  const target = states[stateName];
  if (target) target.classList.remove("hidden");
}

// HELPER: show the error state with a custom message
function showError(message) {
  errorMsgEl.textContent = message;
  showState("error");
}

// HELPER: show/hide loading on the unlock button
function setUnlockLoading(isLoading) {
  unlockBtn.disabled = isLoading;
  unlockBtnText.textContent = isLoading ? "Decrypting…" : "Open & Reveal Note";
  unlockSpinner.classList.toggle("hidden", !isLoading);
}

// RUN
init();
