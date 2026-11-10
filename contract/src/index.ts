/**
 * Foreman — a general-contractor agent escrow on NEAR.
 *
 * A user (or the Foreman agent) posts a job with a task and a budget in NEAR.
 * The budget is escrowed in this contract. A worker agent quotes a price.
 * If the quote is above the planned spend, the poster counters ONCE with a
 * reason; the worker then accepts the counter or walks away. The worker
 * submits work, the poster verifies it, and the contract pays out within
 * budget — or refunds the poster if the work fails the check.
 *
 * Every finished job leaves a receipt: what was bought, from whom, at what
 * price, and whether the work passed the check.
 *
 * Track: Agent Economy (`agents`) — "Give AI a wallet".
 * NEAR HACKATHON 2026. Testnet only. No mainnet deployment.
 */
import { NearBindgen, near, call, view, initialize, UnorderedMap, NearPromise } from "near-sdk-js";
import { parseNearAmount, formatNear } from "../../shared/amounts";

export type JobStatus =
  | "open"        // posted, waiting for a quote
  | "quoted"      // a worker quoted a price
  | "countered"   // poster countered once; worker must accept or walk away
  | "accepted"    // price agreed, worker is doing the work
  | "submitted"   // work submitted, waiting for verification
  | "done"        // verified + paid
  | "refunded"    // verification failed, poster refunded
  | "cancelled";  // poster cancelled while open, poster refunded

export interface Quote {
  agent_id: string;
  price: string;       // yoctoNEAR
  price_near: string;  // human-readable NEAR
}

export interface CounterOffer {
  price: string;       // yoctoNEAR
  price_near: string;  // human-readable NEAR
  reasoning: string;   // why the poster counters at this price
}

export interface Receipt {
  job_id: string;
  task: string;
  bought: string;              // what was bought (the submitted result, truncated)
  from: string;                // worker agent account id ("" if never hired)
  price: string;               // yoctoNEAR actually paid to the worker ("0" if none)
  price_near: string;          // human-readable NEAR paid
  passed: boolean;             // did the work pass the poster's check?
  refunded_to_poster: string;  // yoctoNEAR refunded to the poster
  refunded_near: string;       // human-readable NEAR refunded
}

export interface Job {
  id: string;
  poster: string;
  task: string;
  budget: string;       // yoctoNEAR escrowed
  budget_near: string;  // human-readable NEAR
  status: JobStatus;
  quote: Quote | null;
  counter: CounterOffer | null;
  agreed_price: string | null;      // yoctoNEAR
  agreed_price_near: string | null; // human-readable NEAR
  result: string | null;
  receipt: Receipt | null;
  created_at: string;   // block timestamp (ns, as string)
}

@NearBindgen({ requireInit: true })
class Foreman {
  jobs: UnorderedMap<Job> = new UnorderedMap<Job>("jobs");
  job_count: number = 0;

  @initialize({})
  init({}: {}): void {
    this.job_count = 0;
  }

  /** Post a job. The attached deposit IS the budget and is escrowed. */
  @call({ payableFunction: true })
  post_job({ task, budget_near }: { task: string; budget_near: string }): Job {
    const budget = parseNearAmount(budget_near);
    if (budget <= 0n) throw new Error("Budget must be greater than 0 NEAR");
    if (near.attachedDeposit() !== budget) {
      throw new Error(
        `Attached deposit (${near.attachedDeposit().toString()} yocto) must equal the budget (${budget.toString()} yocto, ${budget_near} NEAR)`,
      );
    }
    if (!task || task.trim().length === 0) throw new Error("Task must not be empty");
    if (task.length > 2000) throw new Error("Task too long (max 2000 characters)");

    this.job_count += 1;
    const id = this.job_count.toString();
    const job: Job = {
      id,
      poster: near.signerAccountId(),
      task: task.trim(),
      budget: budget.toString(),
      budget_near,
      status: "open",
      quote: null,
      counter: null,
      agreed_price: null,
      agreed_price_near: null,
      result: null,
      receipt: null,
      created_at: near.blockTimestamp().toString(),
    };
    this.jobs.set(id, job);
    return job;
  }

  /** A worker agent quotes a price for an open job.
   * A quote MAY be above the escrowed budget — that is the point: an
   * over-budget quote is what the poster counters down. The budget cap is
   * enforced when a price is agreed (accept_quote / counter), never here. */
  @call({})
  quote({ job_id, price_near }: { job_id: string; price_near: string }): Job {
    const job = this.mustGetJob(job_id);
    if (job.status !== "open") {
      throw new Error(`Job ${job_id} is ${job.status}; only open jobs accept a quote`);
    }
    const price = parseNearAmount(price_near);
    if (price <= 0n) throw new Error("Quote price must be greater than 0 NEAR");
    job.quote = { agent_id: near.signerAccountId(), price: price.toString(), price_near };
    job.status = "quoted";
    this.jobs.set(job_id, job);
    return job;
  }

  /**
   * The poster counters ONCE with a lower price and its reasoning.
   * Only allowed while the job is "quoted" and no counter exists yet.
   */
  @call({})
  counter({ job_id, price_near, reasoning }: { job_id: string; price_near: string; reasoning: string }): Job {
    const job = this.mustGetJob(job_id);
    if (job.poster !== near.signerAccountId()) {
      throw new Error("Only the job poster can counter");
    }
    if (job.status !== "quoted") {
      throw new Error(`Job ${job_id} is ${job.status}; only a quoted job can be countered`);
    }
    if (job.counter !== null) {
      throw new Error("This job was already countered once — accept the quote or walk away");
    }
    if (!reasoning || reasoning.trim().length === 0) {
      throw new Error("A counter must include reasoning");
    }
    const price = parseNearAmount(price_near);
    if (price <= 0n) throw new Error("Counter price must be greater than 0 NEAR");
    if (price >= BigInt(job.quote!.price)) {
      throw new Error("A counter must be lower than the quoted price");
    }
    if (price > BigInt(job.budget)) {
      throw new Error(`Counter ${price_near} NEAR exceeds the job budget of ${job.budget_near} NEAR — the agreed price must fit the escrow`);
    }
    job.counter = { price: price.toString(), price_near, reasoning: reasoning.trim() };
    job.status = "countered";
    this.jobs.set(job_id, job);
    return job;
  }

  /** The poster accepts the worker's original quote. */
  @call({})
  accept_quote({ job_id }: { job_id: string }): Job {
    const job = this.mustGetJob(job_id);
    if (job.poster !== near.signerAccountId()) {
      throw new Error("Only the job poster can accept the quote");
    }
    if (job.status !== "quoted") {
      throw new Error(`Job ${job_id} is ${job.status}; only a quoted job can be accepted`);
    }
    if (BigInt(job.quote!.price) > BigInt(job.budget)) {
      throw new Error(`Quote ${job.quote!.price_near} NEAR exceeds the job budget of ${job.budget_near} NEAR — counter it down or walk away`);
    }
    job.agreed_price = job.quote!.price;
    job.agreed_price_near = job.quote!.price_near;
    job.status = "accepted";
    this.jobs.set(job_id, job);
    return job;
  }

  /** The quoted worker accepts the poster's counter-offer. */
  @call({})
  accept_counter({ job_id }: { job_id: string }): Job {
    const job = this.mustGetJob(job_id);
    if (job.quote === null || job.quote.agent_id !== near.signerAccountId()) {
      throw new Error("Only the quoting worker can accept the counter");
    }
    if (job.status !== "countered" || job.counter === null) {
      throw new Error(`Job ${job_id} is ${job.status}; there is no counter to accept`);
    }
    job.agreed_price = job.counter.price;
    job.agreed_price_near = job.counter.price_near;
    job.status = "accepted";
    this.jobs.set(job_id, job);
    return job;
  }

  /** The poster walks away from a quote/counter; the job reopens for other workers. */
  @call({})
  reject_quote({ job_id }: { job_id: string }): Job {
    const job = this.mustGetJob(job_id);
    if (job.poster !== near.signerAccountId()) {
      throw new Error("Only the job poster can reject the quote");
    }
    if (job.status !== "quoted" && job.status !== "countered") {
      throw new Error(`Job ${job_id} is ${job.status}; nothing to reject`);
    }
    job.quote = null;
    job.counter = null;
    job.status = "open";
    this.jobs.set(job_id, job);
    return job;
  }

  /** The worker walks away from the poster's counter; the job reopens. */
  @call({})
  reject_counter({ job_id }: { job_id: string }): Job {
    const job = this.mustGetJob(job_id);
    if (job.quote === null || job.quote.agent_id !== near.signerAccountId()) {
      throw new Error("Only the quoting worker can reject the counter");
    }
    if (job.status !== "countered") {
      throw new Error(`Job ${job_id} is ${job.status}; there is no counter to reject`);
    }
    job.quote = null;
    job.counter = null;
    job.status = "open";
    this.jobs.set(job_id, job);
    return job;
  }

  /** The poster cancels an open job (no active quote) and is refunded in full. */
  @call({})
  cancel_job({ job_id }: { job_id: string }): Job {
    const job = this.mustGetJob(job_id);
    if (job.poster !== near.signerAccountId()) {
      throw new Error("Only the job poster can cancel the job");
    }
    if (job.status !== "open") {
      throw new Error(`Job ${job_id} is ${job.status}; only an open job can be cancelled`);
    }
    const budget = BigInt(job.budget);
    NearPromise.new(job.poster).transfer(budget).build();
    job.receipt = this.makeReceipt(job, "", "", "0", false, job.budget);
    job.status = "cancelled";
    this.jobs.set(job_id, job);
    return job;
  }

  /** The hired worker submits its work. */
  @call({})
  submit_work({ job_id, result }: { job_id: string; result: string }): Job {
    const job = this.mustGetJob(job_id);
    if (job.quote === null || job.quote.agent_id !== near.signerAccountId()) {
      throw new Error("Only the hired worker can submit work for this job");
    }
    if (job.status !== "accepted") {
      throw new Error(`Job ${job_id} is ${job.status}; only an accepted job accepts work`);
    }
    if (!result || result.trim().length === 0) throw new Error("Submitted work must not be empty");
    if (result.length > 10000) throw new Error("Submitted work too long (max 10000 characters)");
    job.result = result;
    job.status = "submitted";
    this.jobs.set(job_id, job);
    return job;
  }

  /**
   * The poster verifies the submitted work and the contract settles.
   * passed=true: worker is paid the agreed price, the rest is refunded.
   * passed=false: worker is paid nothing, the full budget is refunded.
   * A receipt is written either way.
   */
  @call({})
  verify_and_pay({ job_id, passed }: { job_id: string; passed: boolean }): Job {
    const job = this.mustGetJob(job_id);
    if (job.poster !== near.signerAccountId()) {
      throw new Error("Only the job poster can verify the work");
    }
    if (job.status !== "submitted") {
      throw new Error(`Job ${job_id} is ${job.status}; only submitted work can be verified`);
    }
    const budget = BigInt(job.budget);
    const agreed = BigInt(job.agreed_price!);
    const worker = job.quote!.agent_id;
    let paid = 0n;
    let refunded = budget;
    if (passed) {
      paid = agreed;
      refunded = budget - agreed;
      NearPromise.new(worker).transfer(paid).build();
    }
    if (refunded > 0n) {
      NearPromise.new(job.poster).transfer(refunded).build();
    }
    job.receipt = this.makeReceipt(
      job,
      job.result ?? "",
      worker,
      paid.toString(),
      passed,
      refunded.toString(),
    );
    job.status = passed ? "done" : "refunded";
    this.jobs.set(job_id, job);
    return job;
  }

  /** Read one job. */
  @view({})
  get_job({ job_id }: { job_id: string }): Job | null {
    return this.jobs.get(job_id);
  }

  /** List jobs, newest last, paginated. */
  @view({})
  list_jobs({ from_index = 0, limit = 50 }: { from_index?: number; limit?: number }): Job[] {
    const out: Job[] = [];
    const total = this.job_count;
    const end = Math.min(total, from_index + limit);
    for (let i = from_index + 1; i <= end; i++) {
      const job = this.jobs.get(i.toString());
      if (job !== null) out.push(job);
    }
    return out;
  }

  /** Read the receipt for a job (null until the job settles). */
  @view({})
  get_receipt({ job_id }: { job_id: string }): Receipt | null {
    const job = this.jobs.get(job_id);
    return job === null ? null : job.receipt;
  }

  /** Total number of jobs ever posted. */
  @view({})
  get_job_count({}: {}): number {
    return this.job_count;
  }

  private mustGetJob(job_id: string): Job {
    const job = this.jobs.get(job_id);
    if (job === null) throw new Error(`Job ${job_id} does not exist`);
    return job;
  }

  private makeReceipt(
    job: Job,
    bought: string,
    from: string,
    price: string,
    passed: boolean,
    refunded: string,
  ): Receipt {
    return {
      job_id: job.id,
      task: job.task,
      bought: bought.length > 500 ? bought.slice(0, 500) + "…" : bought,
      from,
      price,
      price_near: formatNear(price),
      passed,
      refunded_to_poster: refunded,
      refunded_near: formatNear(refunded),
    };
  }
}
