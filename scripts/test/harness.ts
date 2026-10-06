import type { StorageLike } from "../../src/collab/storage";

export class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

interface BusHandler {
  (key: string): void;
}

export class MemoryBus {
  private handlers = new Set<BusHandler>();
  emit = (key: string): void => {
    for (const handler of this.handlers) handler(key);
  };
  on = (_key: string, cb: (key: string) => void): void => {
    this.handlers.add(cb);
  };
}

/** 异步定时器：让抢锁重试在当前合并释放锁之后再发生，避免同步递归。 */
export function asyncTimers() {
  return {
    idle: (ms: number, cb: () => void) => setTimeout(cb, ms) as unknown as number,
    clearIdle: (id: number) => clearTimeout(id),
    // 测试不需要心跳，空实现即可。
    interval: (_ms: number, _cb: () => void) => 0,
    clearInterval: (_id: number) => undefined,
  };
}
