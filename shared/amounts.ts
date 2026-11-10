/**
 * Shared NEAR amount helpers, used by the contract and by the tests.
 * Pure functions — no NEAR host calls, so they run in plain Node too.
 */

export const YOCTO_PER_NEAR = 10n ** 24n;

/** Parse a decimal NEAR amount ("1.5") into yoctoNEAR (bigint). */
export function parseNearAmount(amount: string): bigint {
  const s = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid NEAR amount: "${amount}" (expected a decimal like "1.5")`);
  }
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(24)).slice(0, 24);
  return BigInt(whole) * YOCTO_PER_NEAR + BigInt(fracPadded || "0");
}

/** Format yoctoNEAR (decimal string) back to a human NEAR amount. */
export function formatNear(yocto: string): string {
  const v = BigInt(yocto);
  const whole = v / YOCTO_PER_NEAR;
  const frac = v % YOCTO_PER_NEAR;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(24, "0").replace(/0+$/, "")}`;
}
