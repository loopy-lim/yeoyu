// Sync 1.5 upload batching — a TypeScript port of the application-services
// PostQueue state machine (components/sync15/src/client/request.rs, mirrored
// by desktop services/sync/modules/record.sys.mjs):
//
//   enqueue → payload-byte/record tracking → auto flush when a limit would
//   be exceeded → ?batch=true → 202 + batch id → append (?batch=<id>) →
//   commit (?batch=<id>&commit=true) → 200. A non-202 2xx answer to
//   ?batch=true means the server has no batch semantics: fall back to plain
//   POSTs. Every response's X-Last-Modified advances the X-If-Unmodified-
//   Since sent with the next POST.
//
// Reporting follows a-s NormalResponseHandler: batch-appended successes and
// failures stay *pending* until the commit response folds them into the
// durable result (an uncommitted batch is never visible on the server), and
// records the server put in neither list count as failed.

import { utf8 } from "./base64";
import {
  OutgoingBso,
  StorageContext,
  StorageLimits,
  StoragePostResult,
  backoffSeconds,
  storagePost,
  SyncServerError,
} from "./sync15";

export type BatchState = "none" | "active" | "unsupported";

export type PostQueueErrorKind =
  /** The server broke the batch protocol (non-202 mid-batch, 202 without
   *  a batch id, or a batch id mismatch). The upload must abort; nothing
   *  was committed. */
  | "batch"
  /** The caller drove the state machine incorrectly. */
  | "misuse";

export class PostQueueError extends Error {
  constructor(
    public kind: PostQueueErrorKind,
    message: string
  ) {
    super(message);
  }
}

/** Per-POST summary handed to the onPost observer. */
export interface PostQueuePostSummary {
  /** Records carried by this POST, in order. */
  posted: OutgoingBso[];
  /** Ids the server accepted in this response. */
  success: string[];
  /** id → reason rejected in this response (incl. unspecified-list misses). */
  failed: Record<string, string>;
  /** True when the posted records became durable (non-batch 2xx, or the
   *  commit response that finished a batch). */
  committed: boolean;
  /** This response's X-Last-Modified (seconds) when present. */
  lastModifiedSeconds: number | null;
}

export interface PostQueueOptions {
  /** /info/configuration limits (or FALLBACK_STORAGE_LIMITS). */
  limits: StorageLimits;
  /** X-If-Unmodified-Since for the first POST — the collection modified
   *  timestamp observed on receive (info/collections / collection GET).
   *  Advanced to each response's X-Last-Modified; read it back after
   *  flush(true) to refresh the cached collection modified. */
  xiusSeconds: number;
  /** Optional per-POST observer (logging/telemetry). */
  onPost?: (summary: PostQueuePostSummary) => void;
}

/** Port of the a-s LimitTracker: byte budget over payload sizes + record
 *  count, for one POST (post limits) or one whole batch (total limits). */
class LimitTracker {
  private currentBytes = 0;
  private currentRecords = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly maxRecords: number
  ) {}

  /** True when no flush could ever make room for this payload — a-s
   *  `LimitTracker::can_never_add`: size alone ≥ max_bytes (current
   *  fullness is handled by canAddRecord → flush, not here). */
  canNeverAdd(payloadBytes: number): boolean {
    return payloadBytes >= this.maxBytes;
  }

  /** True when the payload still fits without a flush. */
  canAddRecord(payloadBytes: number): boolean {
    return (
      this.currentRecords < this.maxRecords &&
      this.currentBytes + payloadBytes <= this.maxBytes
    );
  }

  didAddRecord(payloadBytes: number): void {
    this.currentBytes += payloadBytes;
    this.currentRecords += 1;
  }

  clear(): void {
    this.currentBytes = 0;
    this.currentRecords = 0;
  }
}

export class PostQueue {
  private readonly context: StorageContext;
  private readonly collection: string;
  private readonly limits: StorageLimits;
  /** Request budget with a 4KiB slack below the server's max_request_bytes
   *  for envelope JSON overhead the payload sums don't count. */
  private readonly maxRequestBytes: number;
  private readonly onPost?: (summary: PostQueuePostSummary) => void;
  private readonly postLimits: LimitTracker;
  private readonly batchLimits: LimitTracker;

  private batch:
    | { kind: "none" }
    | { kind: "active"; id: string }
    | { kind: "unsupported" } = { kind: "none" };
  private queued: OutgoingBso[] = [];
  /** Serialized item bytes (each item counted with its 2-byte separator
   *  allowance, like the desktop queue's string length). */
  private queuedBytes = 0;
  private xius: number;

  private pendingSuccess: string[] = [];
  private pendingFailed: Record<string, string> = {};
  private durableSuccess: string[] = [];
  private durableFailed: Record<string, string> = {};

  constructor(
    context: StorageContext,
    collection: string,
    options: PostQueueOptions
  ) {
    this.context = context;
    this.collection = collection;
    this.limits = options.limits;
    this.maxRequestBytes = Math.max(1, options.limits.maxRequestBytes - 4096);
    this.onPost = options.onPost;
    this.postLimits = new LimitTracker(
      options.limits.maxPostBytes,
      options.limits.maxPostRecords
    );
    this.batchLimits = new LimitTracker(
      options.limits.maxTotalBytes,
      options.limits.maxTotalRecords
    );
    this.xius = options.xiusSeconds;
  }

  /** Current batch state — "active" means mid-batch holding a server id. */
  get batchState(): BatchState {
    return this.batch.kind;
  }

  /** Latest X-Last-Modified seen (or the constructor timestamp): the XIUS
   *  for the next request and the new cached collection modified after a
   *  successful flush(true). */
  get lastModifiedSeconds(): number {
    return this.xius;
  }

  /** Ids whose upload is durable — non-batch 2xx POSTs and committed
   *  batches only (mid-batch appends stay pending until commit). */
  get successIds(): string[] {
    return [...this.durableSuccess];
  }

  /** id → reason for records the server (or the queue) rejected. */
  get failedIds(): Record<string, string> {
    return { ...this.durableFailed };
  }

  /**
   * Queue one record, flushing (and when the *batch* limit forces it,
   * committing) automatically as limits require. Returns false when the
   * record alone can never fit (payload ≥ max_record_payload_bytes, or any
   * per-post/batch budget) — such records are recorded in failedIds and
   * never sent, matching the a-s/desktop skip semantics.
   */
  async enqueue(bso: OutgoingBso): Promise<boolean> {
    const payloadBytes = byteLength(bso.payload);
    // 2 bytes of JSON allowance per item: the '[' or ',' separator every
    // item has, plus the final ']' (the desktop PostQueue's encodedLength).
    const itemBytes = byteLength(JSON.stringify(bso)) + 2;
    if (
      this.postLimits.canNeverAdd(payloadBytes) ||
      this.batchLimits.canNeverAdd(payloadBytes) ||
      payloadBytes >= this.limits.maxRecordPayloadBytes ||
      itemBytes >= this.maxRequestBytes
    ) {
      this.durableFailed[bso.id] = "single record too large";
      return false;
    }
    const canPost = this.postLimits.canAddRecord(payloadBytes);
    const canBatch = this.batchLimits.canAddRecord(payloadBytes);
    const canSend = this.queuedBytes + itemBytes < this.maxRequestBytes;
    if (!canPost || !canBatch || !canSend) {
      // Flush what we have; only commit (closing the batch) when it is the
      // batch budget that cannot take the record.
      await this.flush(!canBatch);
    }
    this.queued.push(bso);
    this.queuedBytes += itemBytes;
    this.postLimits.didAddRecord(payloadBytes);
    this.batchLimits.didAddRecord(payloadBytes);
    return true;
  }

  /** POST everything queued. wantCommit=true also finishes an open batch
   *  (or issues the single-shot batch=true&commit=true for a fresh one).
   *  Throws SyncServerError on non-2xx (412 → abort, dirty stays with the
   *  caller) and PostQueueError on batch protocol violations. */
  async flush(wantCommit = false): Promise<void> {
    if (this.queued.length === 0) {
      if (this.batch.kind === "active") {
        // Matches a-s (assertion) / desktop (throw): an active batch always
        // has queued records — commit with nothing to commit is a bug in
        // the caller's flush discipline.
        throw new PostQueueError(
          "misuse",
          "flush with an empty queue while a batch is active"
        );
      }
      return;
    }
    const batchParam: string | true | undefined =
      this.batch.kind === "unsupported"
        ? undefined
        : this.batch.kind === "active"
          ? this.batch.id
          : true;
    const isCommit = wantCommit && this.batch.kind !== "unsupported";

    const posted = this.queued;
    let result: StoragePostResult;
    try {
      result = await storagePost(this.context, this.collection, posted, {
        xiusSeconds: this.xius,
        batch: batchParam,
        commit: isCommit,
      });
    } finally {
      // The queue is spent once the request is out, success or failure —
      // an aborted upload re-enqueues from the caller's dirty set.
      this.queued = [];
      this.queuedBytes = 0;
      this.postLimits.clear();
      if (wantCommit || this.batch.kind === "unsupported") {
        this.batchLimits.clear();
      }
    }

    if (result.status < 200 || result.status > 299) {
      // 412 (lost a race) / 503 (overloaded, Retry-After in headers) / …:
      // abort; classification and backoff are the caller's.
      throw new SyncServerError(
        result.status,
        `storage POST ${this.collection} ${result.status}`,
        backoffSeconds(result.headers)
      );
    }
    if (result.lastModifiedSeconds !== null) {
      this.xius = Math.max(this.xius, result.lastModifiedSeconds);
    }

    if (wantCommit) {
      // Commit (or the single-shot batch=true&commit=true, which the spec
      // defines to behave like a plain POST): the batch is finished and
      // everything pending folds into the durable result.
      this.batch = { kind: "none" };
      this.fold(posted, result, true);
      return;
    }

    if (result.status !== 202) {
      if (this.batch.kind === "active") {
        throw new PostQueueError(
          "batch",
          "non-202 success while a batch is in progress"
        );
      }
      // The server ignored ?batch=true — no batch semantics; the records
      // were written directly, so they are durable.
      this.batch = { kind: "unsupported" };
      this.fold(posted, result, true);
      return;
    }

    // 202: batch semantics confirmed — a batch id must be present and, once
    // we are in a batch, must match the id we have been appending to.
    if (result.batch === null) {
      throw new PostQueueError("batch", "202 without a batch id");
    }
    if (this.batch.kind === "active" && result.batch !== this.batch.id) {
      throw new PostQueueError(
        "batch",
        `batch id mismatch: client ${this.batch.id}, server ${result.batch}`
      );
    }
    this.batch = { kind: "active", id: result.batch };
    this.fold(posted, result, false);
  }

  /** Accumulate a response; durable=true folds pending batch results in. */
  private fold(
    posted: OutgoingBso[],
    result: StoragePostResult,
    durable: boolean
  ): void {
    this.pendingSuccess.push(...result.success);
    Object.assign(this.pendingFailed, result.failed);
    this.onPost?.({
      posted,
      success: result.success,
      failed: result.failed,
      committed: durable,
      lastModifiedSeconds: result.lastModifiedSeconds,
    });
    if (!durable) return;
    this.durableSuccess.push(...this.pendingSuccess);
    Object.assign(this.durableFailed, this.pendingFailed);
    this.pendingSuccess = [];
    this.pendingFailed = {};
  }
}

/** Payload strings are ASCII (base64/hex/JSON punctuation) in practice, but
 *  count UTF-8 bytes so the accounting stays exact for any input. */
function byteLength(value: string): number {
  return utf8(value).length;
}
