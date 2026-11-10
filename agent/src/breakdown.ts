/**
 * Rule-based task breakdown and work verification.
 *
 * No paid LLM is required. The Foreman splits a user task into subtasks by
 * keyword, assigns each a planned spend (a slice of the total budget), and
 * verifies submitted work with a transparent, deterministic check.
 *
 * An optional OpenAI-compatible LLM can be plugged in via LLM_API_URL +
 * LLM_API_KEY for richer breakdowns and work generation; when absent, the
 * rule-based path is used and the run is still fully real on-chain.
 */

export interface Subtask {
  kind: string;
  title: string;
  detail: string;
  /** Planned spend for this subtask, in NEAR (decimal string). */
  plannedSpendNear: string;
  /** Keywords the verification check looks for in the submitted work. */
  keywords: string[];
  /** Minimum acceptable length (chars) of submitted work. */
  minLength: number;
}

export interface Verification {
  passed: boolean;
  reasons: string[];
}

const KIND_RULES: Array<{
  kind: string;
  title: string;
  match: RegExp;
  share: number;
  keywords: string[];
  minLength: number;
}> = [
  {
    kind: "research",
    title: "Research",
    match: /research|find|list|search|compare|gather|look up|lookup|survey/i,
    share: 0.3,
    keywords: ["finding", "source", "result", "option"],
    minLength: 80,
  },
  {
    kind: "data",
    title: "Data",
    match: /data|price|stats|statistic|number|metric|chart|table|track/i,
    share: 0.25,
    keywords: ["data", "value", "figure", "number"],
    minLength: 60,
  },
  {
    kind: "writing",
    title: "Writing",
    match: /write|draft|summary|summar|essay|post|article|blog|document|report/i,
    share: 0.35,
    keywords: ["summary", "point", "conclusion", "detail"],
    minLength: 120,
  },
  {
    kind: "code",
    title: "Code",
    match: /code|build|script|program|implement|function|app|website|tool/i,
    share: 0.4,
    keywords: ["function", "code", "implementation", "test"],
    minLength: 80,
  },
  {
    kind: "design",
    title: "Design",
    match: /design|image|logo|layout|mockup|ui|ux|banner/i,
    share: 0.25,
    keywords: ["design", "layout", "style", "visual"],
    minLength: 60,
  },
];

/**
 * Split a user task into subtasks and divide the budget.
 * Returns at most 3 subtasks. Shares always sum to 1.
 */
export function breakdownTask(task: string, totalBudgetNear: number): Subtask[] {
  const matched = KIND_RULES.filter((r) => r.match.test(task));
  const kinds = matched.length > 0 ? matched.slice(0, 3) : [KIND_RULES[2]]; // default: writing
  const totalShare = kinds.reduce((s, k) => s + k.share, 0);
  // Last subtask is always a verification step the Foreman does itself.
  const subs: Subtask[] = kinds.map((k) => ({
    kind: k.kind,
    title: `${k.title}: ${task.length > 90 ? task.slice(0, 90) + "…" : task}`,
    detail: `Do the ${k.kind} part of: "${task}". Return the result as plain text.`,
    plannedSpendNear: ((totalBudgetNear * k.share) / totalShare * 0.8).toFixed(4),
    keywords: k.keywords,
    minLength: k.minLength,
  }));
  // The Foreman keeps 20% of the budget as its own verification margin; it is
  // never spent on workers, and it is refunded to the poster with the rest.
  return subs;
}

/** Deterministic verification check for submitted work. */
export function verifyWork(sub: Subtask, result: string): Verification {
  const reasons: string[] = [];
  if (!result || result.trim().length === 0) {
    return { passed: false, reasons: ["submitted work is empty"] };
  }
  if (result.length < sub.minLength) {
    reasons.push(`work is too short (${result.length} chars, need >= ${sub.minLength})`);
  }
  const lower = result.toLowerCase();
  const hits = sub.keywords.filter((kw) => lower.includes(kw));
  if (hits.length === 0) {
    reasons.push(`work mentions none of the expected terms (${sub.keywords.join(", ")})`);
  }
  if (reasons.length > 0) return { passed: false, reasons };
  return {
    passed: true,
    reasons: [`length ${result.length} chars >= ${sub.minLength}; mentions ${hits.join(", ")}`],
  };
}

/**
 * Generate placeholder work for a subtask (the demo worker).
 * This is deliberately simple and labelled as generated: the point of the
 * demo is the hiring / negotiation / payment loop on-chain, not the prose.
 * A real worker agent would replace this with its own output.
 */
export function generateWork(sub: Subtask, task: string): string {
  const lines: string[] = [];
  lines.push(`${sub.title} — result`);
  lines.push("");
  if (sub.kind === "research") {
    lines.push(`Findings for "${task}":`);
    lines.push(`- Finding 1: the task breaks down into a ${sub.kind} step with a clear source of truth.`);
    lines.push(`- Finding 2: the main option costs less than the planned spend, leaving margin.`);
    lines.push(`- Finding 3: the result is reproducible from the source data.`);
    lines.push(`Sources: on-chain job record, task description, public references.`);
  } else if (sub.kind === "data") {
    lines.push(`Data summary for "${task}":`);
    lines.push(`- value 1: 42 (baseline figure for the tracked item)`);
    lines.push(`- value 2: 3.5 (average across the observed range)`);
    lines.push(`- figure: the numbers above are the data points the Foreman asked for.`);
  } else if (sub.kind === "code") {
    lines.push(`Implementation notes for "${task}":`);
    lines.push(`- function: the main entry point takes the task and returns a result.`);
    lines.push(`- code: a small, tested function with no external dependencies.`);
    lines.push(`- test: run the checks; all of them pass before delivery.`);
  } else if (sub.kind === "design") {
    lines.push(`Design notes for "${task}":`);
    lines.push(`- layout: a single column, title first, actions at the bottom.`);
    lines.push(`- style: high contrast, one accent colour, no clutter.`);
    lines.push(`- visual: the design is described so it can be built from this text.`);
  } else {
    lines.push(`Summary of "${task}":`);
    lines.push(`- point 1: the task was completed as specified.`);
    lines.push(`- point 2: the key detail is that the work stays inside the budget.`);
    lines.push(`- conclusion: the deliverable is ready for the Foreman's check.`);
  }
  lines.push("");
  lines.push(`(Generated by the demo worker agent for subtask "${sub.title}".)`);
  return lines.join("\n");
}

/**
 * Optional LLM hook: if LLM_API_URL + LLM_API_KEY are set, ask an
 * OpenAI-compatible chat endpoint to draft work for a subtask. Returns null
 * when not configured or on any error, so the caller falls back to
 * generateWork(). Never required.
 */
export async function llmGenerateWork(sub: Subtask, task: string): Promise<string | null> {
  const url = process.env.LLM_API_URL;
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a worker agent. Complete the subtask and return only the deliverable text." },
          { role: "user", content: `Subtask: ${sub.title}\nDetail: ${sub.detail}\nOriginal task: ${task}` },
        ],
        max_tokens: 600,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}
