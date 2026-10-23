import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGithubSignature } from "../src/webhook.js";

const SECRET = "devsecret";
const BODY = Buffer.from(JSON.stringify({ action: "synchronize", number: 1 }));

function sign(secret: string, body: Buffer): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyGithubSignature", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyGithubSignature(SECRET, BODY, sign(SECRET, BODY))).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    expect(verifyGithubSignature(SECRET, BODY, sign("wrong-secret", BODY))).toBe(false);
  });

  it("rejects a tampered body", () => {
    const signature = sign(SECRET, BODY);
    const tampered = Buffer.from(JSON.stringify({ action: "synchronize", number: 999 }));
    expect(verifyGithubSignature(SECRET, tampered, signature)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyGithubSignature(SECRET, BODY, undefined)).toBe(false);
  });

  it("rejects a malformed signature header without throwing", () => {
    expect(verifyGithubSignature(SECRET, BODY, "not-a-signature")).toBe(false);
    expect(verifyGithubSignature(SECRET, BODY, "sha256=")).toBe(false);
  });
});
