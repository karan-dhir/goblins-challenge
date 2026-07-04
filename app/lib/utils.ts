import { randomBytes } from "node:crypto"

// Unguessable teacher dashboard token (no auth by design — the link is the key).
export const generateToken = () => randomBytes(18).toString("base64url")

// 6-char access code students type in. Avoids ambiguous chars (0/O, 1/I).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
export const generateAccessCode = () =>
  Array.from(randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join("")
