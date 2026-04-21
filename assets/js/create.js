import { supabase }         from "./app.js";
import { encryptMessage }   from "./crypto.js";

const messageEl      = document.getElementById("message");
const charCountEl    = document.getElementById("charCount");
const passwordEl     = document.getElementById("password");
const togglePwBtn    = document.getElementById("togglePassword");
const eyeIconEl      = document.getElementById("eyeIcon");
const expiryEl       = document.getElementById("expiry");
const createBtn      = document.getElementById("createBtn");
const createBtnText  = document.getElementById("createBtnText");
const createSpinner  = document.getElementById("createSpinner");
const noPasswordWarn = document.getElementById("noPasswordWarn");
const errorAlertEl   = document.getElementById("errorAlert");
const errorTextEl    = document.getElementById("errorText");

// Success box elements
const successBoxEl   = document.getElementById("successBox");
const linkDisplayEl  = document.getElementById("linkDisplay");
const copyLinkBtn    = document.getElementById("copyLinkBtn");
const copyBtnTextEl  = document.getElementById("copyBtnText");
const newNoteBtnEl   = document.getElementById("newNoteBtn");

// Strength indicator elements
const pip1El          = document.getElementById("pip1");
const pip2El          = document.getElementById("pip2");
const pip3El          = document.getElementById("pip3");
const strengthLabelEl = document.getElementById("strengthLabel");

// Max characters allowed in a note
const MAX_CHARS = 5000;

// NEW: ADDED A RATE LIMIT SETTINGS TO PROTECT ABUSE
const RATE_LIMIT_MAX      = 5;        // max notes per day
const RATE_LIMIT_WINDOW   = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const RATE_LIMIT_KEY      = "safenote_rate";      // localStorage key name


// CHARACTER COUNTER
messageEl.addEventListener("input", () => {
  const count = messageEl.value.length;
  charCountEl.textContent = `${count} / ${MAX_CHARS}`;
  charCountEl.classList.toggle("warn", count > MAX_CHARS * 0.85 && count < MAX_CHARS);
  charCountEl.classList.toggle("over", count >= MAX_CHARS);
});

// PASSWORD VISIBILITY TOGGLE
togglePwBtn.addEventListener("click", () => {
  const isHidden = passwordEl.type === "password";
  passwordEl.type = isHidden ? "text" : "password";

  eyeIconEl.innerHTML = isHidden
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
       <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
       <line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
       <circle cx="12" cy="12" r="3"/>`;
});

// PASSWORD STRENGTH INDICATOR
passwordEl.addEventListener("input", () => {
  const pw = passwordEl.value;
  noPasswordWarn.classList.toggle("hidden", pw.length > 0);

  const strength = getPasswordStrength(pw);

  [pip1El, pip2El, pip3El].forEach(p => {
    p.classList.remove("s-weak", "s-fair", "s-strong");
  });

  if (strength === 1) {
    pip1El.classList.add("s-weak");
    strengthLabelEl.style.color = "var(--red)";
    strengthLabelEl.textContent = "Weak";
  } else if (strength === 2) {
    pip1El.classList.add("s-fair");
    pip2El.classList.add("s-fair");
    strengthLabelEl.style.color = "var(--amber)";
    strengthLabelEl.textContent = "Fair";
  } else if (strength >= 3) {
    pip1El.classList.add("s-strong");
    pip2El.classList.add("s-strong");
    pip3El.classList.add("s-strong");
    strengthLabelEl.style.color = "var(--accent)";
    strengthLabelEl.textContent = "Strong";
  } else {
    strengthLabelEl.textContent = "";
  }
});

// PASSWORD STRENGTH CALCULATOR
function getPasswordStrength(pw) {
  if (!pw) return 0;

  let score = 0;
  if (pw.length >= 8)                          score++;
  if (pw.length >= 14)                         score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw))   score++;
  if (/\d/.test(pw))                           score++;
  if (/[^A-Za-z0-9]/.test(pw))                score++;

  if (score <= 0) return 0;
  if (score <= 2) return 1;
  if (score <= 3) return 2;
  return 3;
}


// NEW: RATE LIMITING HELPERS

// HELPER: Read the rate limit record from localStorage
// Returns an object: { count: number, windowStart: timestamp }
// If nothing is stored yet, returns a fresh record.
function getRateRecord() {
  try {
    const raw = localStorage.getItem(RATE_LIMIT_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // If localStorage is broken or tampered with, start fresh
  }
  return { count: 0, windowStart: Date.now() };
}

// HELPER: Save the rate limit record to localStorage
function saveRateRecord(record) {
  try {
    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(record));
  } catch {
    // Storage might be full — not critical, just skip
  }
}

// HELPER: Check if the user is allowed to create a note
// Returns: { allowed: true }
//       or { allowed: false, resetsAt: Date }
function checkFrontendLimit() {
  let record = getRateRecord();
  const now  = Date.now();

  // Has the 24-hour window expired? If yes, reset the counter.
  // Example: user created notes yesterday — their window is stale.
  if (now - record.windowStart >= RATE_LIMIT_WINDOW) {
    record = { count: 0, windowStart: now };
    saveRateRecord(record);
  }

  // Are they under the limit?
  if (record.count < RATE_LIMIT_MAX) {
    return { allowed: true };
  }

  // Over the limit — calculate exactly when their window resets
  const resetsAt = new Date(record.windowStart + RATE_LIMIT_WINDOW);
  return { allowed: false, resetsAt };
}

// HELPER: Increment the counter after a successful note save
function incrementFrontendCount() {
  const record = getRateRecord();
  const now    = Date.now();

  // Reset if window expired
  if (now - record.windowStart >= RATE_LIMIT_WINDOW) {
    saveRateRecord({ count: 1, windowStart: now });
  } else {
    saveRateRecord({ count: record.count + 1, windowStart: record.windowStart });
  }
}

// HELPER: Check the database limit by IP
// This is the real protection — localStorage can be cleared,
// but this check runs against your Supabase database.
//
// Flow:
//   1. Ask ipapi.co for the user's IP address (free, no key needed)
//   2. Count how many notes that IP created in the last 24 hours
//   3. If count >= 5, block the request
//
// Returns: { allowed: true, ip: "1.2.3.4" }
//       or { allowed: false, ip: "1.2.3.4" }
async function checkDatabaseLimit() {
  let ip = "unknown";

  // Step 1: Get the user's IP address
  try {
    const res  = await fetch("https://ipapi.co/json/");
    const data = await res.json();
    ip = data.ip || "unknown";
  } catch {
    // If IP lookup fails, we still proceed with "unknown"
    // so a broken IP service doesn't block everyone.
    console.warn("Could not fetch IP — rate limit DB check skipped.");
    return { allowed: true, ip: "unknown" };
  }

  // Step 2: Count notes from this IP in the last 24 hours
  // new Date(Date.now() - 86400000) = exactly 24 hours ago
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW).toISOString();

  const { count, error } = await supabase
    .from("notes")
    .select("id", { count: "exact", head: true })
    // head: true means "don't return the rows, just the count"
    // This is much faster and cheaper than fetching all rows.
    .eq("created_by_ip", ip)
    .gte("created_at", since); // gte = "greater than or equal to"

  if (error) {
    // If the DB check fails, let them through — don't punish users
    // for a server-side error.
    console.warn("DB rate limit check failed:", error.message);
    return { allowed: true, ip };
  }

  // Step 3: Block if at or over the limit
  if (count >= RATE_LIMIT_MAX) {
    return { allowed: false, ip };
  }

  return { allowed: true, ip };
}

// HELPER: Format the reset time for the error message
// Turns a Date object into a readable string like "11:45 PM"
function formatResetTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// CREATE NOTE (main action) — now with rate limiting

createBtn.addEventListener("click", async () => {

  // 1. Read values from the form
  const message  = messageEl.value.trim();
  const password = passwordEl.value.trim();
  const expiry   = parseInt(expiryEl.value, 10);

  // 2. Validate
  if (!message) {
    showError("Please write a message before creating a note.");
    return;
  }
  if (message.length > MAX_CHARS) {
    showError(`Message is too long. Maximum is ${MAX_CHARS} characters.`);
    return;
  }

  // 3. NEW: Frontend rate limit check
  // This runs instantly with no network request.
  // It's the first line of defence.
  const frontendCheck = checkFrontendLimit();

  if (!frontendCheck.allowed) {
    const resetTime = formatResetTime(frontendCheck.resetsAt);
    showError(
      `You've reached the limit of ${RATE_LIMIT_MAX} notes per day. ` +
      `Your limit resets at ${resetTime}.`
    );
    return; // Stop here — don't even show the loading spinner
  }

  // 4. Show loading state
  setLoading(true);
  hideError();

  try {

    // 5. NEW: Database rate limit check (by IP)
    // This is the real protection. Runs before encryption so
    // we don't waste time encrypting if they're over the limit.
    const dbCheck = await checkDatabaseLimit();

    if (!dbCheck.allowed) {
      // Calculate reset time from 24hrs after now (conservative estimate)
      const resetsAt  = new Date(Date.now() + RATE_LIMIT_WINDOW);
      const resetTime = formatResetTime(resetsAt);
      showError(
        `You've reached the limit of ${RATE_LIMIT_MAX} notes per day. ` +
        `Your limit resets at ${resetTime}.`
      );
      return;
    }

    // 6. Encrypt the message in the browser
    const passKey       = password || "public-mode";
    const encryptedData = await encryptMessage(message, passKey);

    // 7. Calculate expiry timestamp
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiry);

    // 8. Save to Supabase — now includes created_by_ip
    // dbCheck.ip is the IP we fetched during the DB limit check.
    const { data, error } = await supabase
      .from("notes")
      .insert([{
        message:          JSON.stringify(encryptedData),
        expires_at:       expiresAt.toISOString(),
        has_password:     password.length > 0,
        created_by_ip:    dbCheck.ip,          // NEW: store IP for DB-side limiting
      }])
      .select();

    if (error) throw error;

    // 9. NEW: Increment the frontend counter
    // Only do this AFTER a successful save — don't penalise
    // failed attempts.
    incrementFrontendCount();

    // 10. Build and show the shareable link
    const noteId    = data[0].id;
    const shareLink = `${window.location.origin}/safenote/read.html?id=${noteId}`;
    showSuccess(shareLink);

  } catch (err) {
    console.error("Create note error:", err);
    showError(
      "Something went wrong. Check that your Supabase URL and key are correct, " +
      "and that your 'notes' table exists."
    );
  } finally {
    setLoading(false);
  }
});


// COPY LINK BUTTON
copyLinkBtn.addEventListener("click", async () => {
  const link = linkDisplayEl.textContent;
  try {
    await navigator.clipboard.writeText(link);
    copyBtnTextEl.textContent = "Copied!";
    setTimeout(() => { copyBtnTextEl.textContent = "Copy Link"; }, 2000);
  } catch {
    window.prompt("Copy this link:", link);
  }
});

// NEW NOTE BUTTON
newNoteBtnEl.addEventListener("click", () => {
  messageEl.value         = "";
  passwordEl.value        = "";
  expiryEl.value          = "24";
  charCountEl.textContent = `0 / ${MAX_CHARS}`;
  successBoxEl.classList.add("hidden");
  createBtn.classList.remove("hidden");
  noPasswordWarn.classList.remove("hidden");
  [pip1El, pip2El, pip3El].forEach(p =>
    p.classList.remove("s-weak", "s-fair", "s-strong")
  );
  strengthLabelEl.textContent = "";
  messageEl.focus();
});

// HELPER: show/hide loading state on create button
function setLoading(isLoading) {
  createBtn.disabled = isLoading;
  createBtnText.textContent = isLoading ? "Creating…" : "Create Secure Note";
  createSpinner.classList.toggle("hidden", !isLoading);
}

// HELPER: show the success box with the generated link
function showSuccess(link) {
  linkDisplayEl.textContent = link;
  successBoxEl.classList.remove("hidden");
  successBoxEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// HELPER: show error message
function showError(message) {
  errorTextEl.textContent = message;
  errorAlertEl.classList.remove("hidden");
}

// HELPER: hide error message
function hideError() {
  errorAlertEl.classList.add("hidden");
}
