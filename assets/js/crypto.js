// TextEncoder converts a string → raw bytes (Uint8Array)
const encoder = new TextEncoder();

// TextDecoder converts raw bytes → string
const decoder = new TextDecoder();

// INTERNAL HELPER: derive a CryptoKey from a password
// This is called by both encryptMessage and decryptMessage.
// "salt" is random bytes that make every key unique, even with
// the same password.
async function deriveKey(password, salt) {

  // Step 1 — import the raw password bytes as a base key
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),   // password string → Uint8Array
    "PBKDF2",                   // algorithm we'll use to stretch it
    false,                      // not extractable (more secure)
    ["deriveKey"]               // only allowed usage
  );

  // Step 2 — stretch the base key into a strong AES-256 key
  return crypto.subtle.deriveKey(
    {
      name:       "PBKDF2",
      salt:       salt,
      iterations: 310_000,    // OWASP-recommended count for 2024
      hash:       "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },  // output: AES-256 key
    false,                              // not extractable
    ["encrypt", "decrypt"]             // allowed usages
  );
}

// ENCRYPT
// Takes a plaintext string + password string.
// Returns an object with:
//   cipher — the encrypted data (base64 string)
//   salt   — random bytes used for key derivation (base64)
//   iv     — random bytes used for AES-GCM (base64)
//
// IMPORTANT: salt and iv are NOT secret — they must be stored
// alongside the cipher so decryption can work later.
export async function encryptMessage(message, password) {

  // Generate a random 16-byte salt (unique per encryption)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Generate a random 12-byte IV (initialisation vector)
  // AES-GCM works best with a 12-byte IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Derive the AES key from password + salt
  const key = await deriveKey(password, salt);

  // Encrypt the message
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encoder.encode(message)   // plaintext → bytes
  );

  // Return everything needed for later decryption
  return {
    cipher: arrayBufferToBase64(encrypted),
    salt:   arrayBufferToBase64(salt),
    iv:     arrayBufferToBase64(iv)
  };
}

// DECRYPT
// Takes the cipher/salt/iv strings and the password.
// Returns the original plaintext string.
// Throws an error if the password is wrong (AES-GCM integrity check fails).
export async function decryptMessage(cipher, password, salt, iv) {

  // Re-derive the exact same key using the stored salt
  const key = await deriveKey(password, base64ToArrayBuffer(salt));

  // Decrypt — throws if password is wrong or data is corrupted
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToArrayBuffer(iv) },
    key,
    base64ToArrayBuffer(cipher)
  );

  // Convert the raw bytes back to a string
  return decoder.decode(decrypted);
}

// BASE64 HELPERS
// The Web Crypto API works with raw binary (ArrayBuffer / Uint8Array).
// Base64 lets us safely store and send that binary as plain text.

// ArrayBuffer / Uint8Array  →  base64 string
function arrayBufferToBase64(buffer) {
  return btoa(
    String.fromCharCode(...new Uint8Array(buffer))
  );
}

// base64 string  →  Uint8Array
function base64ToArrayBuffer(base64) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
