// Compilation executes project build scripts and third-party toolchains. These flags do not turn
// Docker into a sandbox, but they remove privileges a compiler does not need. Keep the list shared
// so the generic command runner and the dedicated cargo runner cannot drift.
export const DOCKER_RUN_SECURITY_ARGS = Object.freeze(['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true']);
