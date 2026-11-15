
// workerd's node:async_hooks (nodejs_compat): the part the tenant context uses (kiosk.ts).
declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    getStore(): T | undefined;
    run<R>(store: T, fn: () => R): R;
  }
}
