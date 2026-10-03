/** One active load; server changes during it coalesce into one trailing load. */
export type LoadReason = "initial" | "retry" | "change";
export type LoadOutcome = "loaded" | "failed";

/** Wait for both requests even when one fails, so a retry cannot overlap its peer. */
export async function loadPair<C, K>(context: () => Promise<C>, code: () => Promise<K>): Promise<{ context: C; code: K }> {
  const [left, right] = await Promise.allSettled([Promise.resolve().then(context), Promise.resolve().then(code)]);
  if (left.status === "rejected") throw left.reason;
  if (right.status === "rejected") throw right.reason;
  return { context: left.value, code: right.value };
}

export interface LoadCallbacks<T> {
  load(): Promise<T>;
  apply(value: T): void;
  loading(retained: boolean): void;
  failed(error: unknown, lastGood: T | undefined): void;
  settled(): void;
}

export function createLoader<T>(callbacks: LoadCallbacks<T>) {
  let active: Promise<LoadOutcome> | undefined;
  let queued = false;
  let lastGood: T | undefined;

  async function run(): Promise<LoadOutcome> {
    let outcome: LoadOutcome = "failed";
    do {
      queued = false;
      try {
        callbacks.loading(lastGood !== undefined);
        const value = await callbacks.load();
        callbacks.apply(value);
        lastGood = value;
        outcome = "loaded";
      } catch (error) {
        callbacks.failed(error, lastGood);
        outcome = "failed";
      } finally {
        callbacks.settled();
      }
    } while (queued);
    return outcome;
  }

  return {
    request(reason: LoadReason): Promise<LoadOutcome> {
      if (active) {
        if (reason === "change") queued = true;
        return active;
      }
      // Publish the in-flight promise before invoking any callbacks.
      active = Promise.resolve().then(run).finally(() => { active = undefined; });
      return active;
    },
  };
}
