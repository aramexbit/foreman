/**
 * Unit tests for the pure logic: NEAR amount helpers and the rule-based
 * task breakdown / verification. No network, no NEAR host needed.
 * Run with: npm test   (compiles shared + breakdown to test-build/ first)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseNearAmount, formatNear } from "../test-build/shared/amounts.js";
import { breakdownTask, verifyWork, generateWork } from "../test-build/agent/src/breakdown.js";

test("parseNearAmount: whole and fractional NEAR", () => {
  assert.equal(parseNearAmount("1").toString(), "1000000000000000000000000");
  assert.equal(parseNearAmount("1.5").toString(), "1500000000000000000000000");
  assert.equal(parseNearAmount("0.0001").toString(), "100000000000000000000");
  assert.equal(parseNearAmount("0").toString(), "0");
});

test("parseNearAmount: rejects bad input", () => {
  assert.throws(() => parseNearAmount("abc"), /Invalid NEAR amount/);
  assert.throws(() => parseNearAmount("-1"), /Invalid NEAR amount/);
  assert.throws(() => parseNearAmount("1.2.3"), /Invalid NEAR amount/);
  assert.throws(() => parseNearAmount(""), /Invalid NEAR amount/);
});

test("formatNear: round-trips parseNearAmount", () => {
  for (const s of ["0", "1", "2.5", "0.0001", "123.456789"]) {
    assert.equal(formatNear(parseNearAmount(s).toString()), s);
  }
  assert.equal(formatNear("0"), "0");
  assert.equal(formatNear("2500000000000000000000000"), "2.5");
});

test("breakdownTask: keyword task splits into matching subtasks", () => {
  const subs = breakdownTask("Research the best free NFT mints and write a summary", 2);
  assert.ok(subs.length >= 1 && subs.length <= 3);
  const kinds = subs.map((s) => s.kind);
  assert.ok(kinds.includes("research"), `expected research in ${kinds}`);
  assert.ok(kinds.includes("writing"), `expected writing in ${kinds}`);
  // Planned spends are positive and sum to 80% of the budget (20% margin kept).
  const total = subs.reduce((sum, s) => sum + parseFloat(s.plannedSpendNear), 0);
  assert.ok(Math.abs(total - 2 * 0.8) < 0.01, `planned total ${total} should be ~1.6`);
  for (const s of subs) {
    assert.ok(parseFloat(s.plannedSpendNear) > 0, "planned spend must be positive");
    assert.ok(s.keywords.length > 0);
    assert.ok(s.minLength > 0);
  }
});

test("breakdownTask: unknown task defaults to a single writing subtask", () => {
  const subs = breakdownTask("do the thing", 1);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].kind, "writing");
});

test("verifyWork: passes good work, fails empty/short/irrelevant work", () => {
  const sub = breakdownTask("Research the best free NFT mints", 1)[0];
  const good = generateWork(sub, "Research the best free NFT mints");
  const ok = verifyWork(sub, good);
  assert.equal(ok.passed, true, `generated work should pass: ${ok.reasons.join("; ")}`);

  assert.equal(verifyWork(sub, "").passed, false);
  assert.equal(verifyWork(sub, "too short").passed, false);
  assert.equal(verifyWork(sub, "lorem ipsum dolor sit amet ".repeat(10)).passed, false);
});

test("generateWork: output mentions the subtask keywords", () => {
  const sub = breakdownTask("Write a summary of the market", 1)[0];
  const work = generateWork(sub, "Write a summary of the market");
  assert.ok(work.length >= sub.minLength);
  assert.ok(sub.keywords.some((kw) => work.toLowerCase().includes(kw)));
});
