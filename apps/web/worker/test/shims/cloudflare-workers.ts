// `cloudflare:workers` exists only inside workerd. The tests load the Worker's routes in Node, where
// the Durable Object base class is all the team hub needs to be importable.
export class DurableObject {
  constructor(
    readonly ctx: unknown,
    readonly env: unknown,
  ) {}
}
