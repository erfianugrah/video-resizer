/**
 * Simple concurrency queue for limiting parallel operations
 * Designed to prevent overwhelming KV namespace with concurrent chunk uploads
 */

export interface QueuedTask<T> {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
}

export class ConcurrencyQueue {
  private queue: QueuedTask<any>[] = [];
  private running = 0;
  private readonly concurrency: number;

  constructor(concurrency: number = 5) {
    this.concurrency = concurrency;
  }

  async add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.running++;

    try {
      const result = await item.task();
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      this.running--;
      // Process next item
      this.processNext();
    }
  }

  get size(): number {
    return this.queue.length;
  }

  get pending(): number {
    return this.queue.length;
  }

  get runningCount(): number {
    return this.running;
  }
}