// What @cloudflare/containers takes from `cloudflare:workers`, enough to drive worker/runner.js in Node.
export class DurableObject {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
    }
}

export class WorkerEntrypoint {}
