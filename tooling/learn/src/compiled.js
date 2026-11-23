// A compile's answer as the playground compiler gives it (tooling/cloud/worker), { status, ...body }: a 200 holds the
// module, or the build's log and why it failed; another status holds the service's words and whether signing in would
// help. A run takes the module from it, or the notice for its user and the build's log.

const FAILURE_NOTICES = Object.freeze({
    compile: 'The build failed; its log is in the console.',
    timeout: 'The compile ran out of time.',
    memory: 'The compile ran out of memory.',
    output: 'The build printed too much or left no module.',
});

export function compiled(answer) {
    if (answer.status !== 200) {
        return { notice: { text: answer.error ?? `The playground answered ${answer.status}.`, login: Boolean(answer.login) } };
    }
    if (!answer.ok) return { notice: { text: FAILURE_NOTICES[answer.reason] ?? 'The build failed.' }, log: answer.log };
    return { module: answer };
}
