import { GoogleGenAI } from "@google/genai";

let _client: GoogleGenAI | null = null;

/**
 * Lazy-initialised Gemini client. Reads `GEMINI_API_KEY` from env on first
 * call so callers don't need to thread the key through every helper.
 *
 * Get a key at https://aistudio.google.com/app/apikey (free tier: 1500 RPD
 * for gemini-2.5-flash, 50 RPD for gemini-2.5-pro at the time of writing).
 */
export function client(): GoogleGenAI {
  if (_client) return _client;
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY must be set. Get one from https://aistudio.google.com/app/apikey",
    );
  }
  _client = new GoogleGenAI({ apiKey });
  return _client;
}
