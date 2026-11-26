// Offline-first outbox for field reports. Guarantees: nothing is lost on app kill or network loss,
// nothing is stored twice on the server (idempotent by client-generated id).
export interface Job { id: string; kind: string; payload: unknown; attempts: number; createdAt: number }
export interface Store {            // IndexedDB in the browser, a Map in tests
  put(job: Job): Promise<void>;
  remove(id: string): Promise<void>;
  all(): Promise<Job[]>;
}
export type Send = (job: Job) => Promise<'created' | 'duplicate'>; // throws on network failure
export type Status = { pending: number; lastError?: string; lastSyncAt?: number };

export class Outbox {
  private running = false;
  status: Status = { pending: 0 };
  constructor(private store: Store, private send: Send, private now = () => Date.now()) {}

  async enqueue(kind: string, payload: unknown, id: string = crypto.randomUUID()): Promise<string> {
    await this.store.put({ id, kind, payload, attempts: 0, createdAt: this.now() }); // persisted before we say "saved"
    this.status.pending = (await this.store.all()).length;
    return id;
  }

  /** Called on the "Sync now" button, on the `online` event, and when the app opens. Never from a service worker (iOS). */
  async flush(): Promise<Status> {
    if (this.running) return this.status;
    this.running = true;
    try {
      const jobs = (await this.store.all()).sort((a, b) => a.createdAt - b.createdAt);
      for (const job of jobs) {
        try {
          await this.send(job);               // 'created' and 'duplicate' both mean the server has it
          await this.store.remove(job.id);    // remove only after the server confirmed
          this.status.lastSyncAt = this.now();
          this.status.lastError = undefined;
        } catch (e) {
          job.attempts += 1;
          await this.store.put(job);
          this.status.lastError = (e as Error).message;
          break;                              // keep order, stop at first failure, try again later
        }
      }
      this.status.pending = (await this.store.all()).length;
      return this.status;
    } finally { this.running = false; }
  }
}
