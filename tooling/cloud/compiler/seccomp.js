// The compile sandbox's seccomp filter, as the classic BPF program bubblewrap loads from a file descriptor.
// Syscalls a compile never needs, and that widen the kernel's attack surface, fail with EPERM. So do sockets of
// any family but unix and internet: that keeps out vsock, the microVM's channel to its host, netlink and raw
// packets. A syscall made for another architecture kills the process.

export const AUDIT_ARCH = Object.freeze({ x64: 0xc000003e, arm64: 0xc00000b7 });
export const RETURN = Object.freeze({ ALLOW: 0x7fff0000, EPERM: 0x00050001, KILL: 0x80000000 });

const SYSCALLS = Object.freeze({
    x64: {
        denied: [
            425, 426, 427, // io_uring_setup, io_uring_enter, io_uring_register
            321, 250, 248, 249, // bpf, keyctl, add_key, request_key
            298, 323, 310, 311, 101, // perf_event_open, userfaultfd, process_vm_readv, process_vm_writev, ptrace
            246, 320, 175, 313, 176, // kexec_load, kexec_file_load, init_module, finit_module, delete_module
            304, 300, // open_by_handle_at, fanotify_init
        ],
        socket: 41,
        socketpair: 53,
        // The x32 ABI reaches the same kernel through syscall numbers with this bit set.
        x32: 0x40000000,
    },
    arm64: {
        denied: [
            425, 426, 427, // io_uring_setup, io_uring_enter, io_uring_register
            280, 219, 217, 218, // bpf, keyctl, add_key, request_key
            241, 282, 270, 271, 117, // perf_event_open, userfaultfd, process_vm_readv, process_vm_writev, ptrace
            104, 294, 105, 273, 106, // kexec_load, kexec_file_load, init_module, finit_module, delete_module
            265, 262, // open_by_handle_at, fanotify_init
        ],
        socket: 198,
        socketpair: 199,
    },
});
const ALLOWED_FAMILIES = Object.freeze([1, 2, 10]); // AF_UNIX, AF_INET, AF_INET6

const LOAD = 0x20; // BPF_LD | BPF_W | BPF_ABS
const JEQ = 0x15; // BPF_JMP | BPF_JEQ | BPF_K
const JGE = 0x35; // BPF_JMP | BPF_JGE | BPF_K
const RET = 0x06; // BPF_RET | BPF_K
const OFFSET = Object.freeze({ nr: 0, arch: 4, arg0: 16 });

const load = (offset) => ({ op: LOAD, k: offset });
const jump = (op, k, jt, jf = 0) => ({ op, k, jt, jf });
const ret = (k) => ({ op: RET, k });
const label = (name) => ({ label: name });

// Jump targets are labels; the kernel wants them as the number of instructions to skip.
function assemble(listing) {
    const instructions = listing.filter((entry) => !entry.label);
    const at = new Map();
    listing.reduce((index, entry) => {
        if (entry.label) at.set(entry.label, index);
        return entry.label ? index : index + 1;
    }, 0);
    const skip = (target, index) => (typeof target === 'string' ? at.get(target) - index - 1 : target ?? 0);
    const program = Buffer.alloc(instructions.length * 8);
    instructions.forEach(({ op, k, jt, jf }, index) => {
        program.writeUInt16LE(op, index * 8);
        program.writeUInt8(skip(jt, index), index * 8 + 2);
        program.writeUInt8(skip(jf, index), index * 8 + 3);
        program.writeUInt32LE(k >>> 0, index * 8 + 4);
    });
    return program;
}

export function seccompProgram(arch = process.arch) {
    const table = SYSCALLS[arch];
    if (!table) throw new Error(`there is no seccomp filter for the ${arch} architecture`);
    return assemble([
        load(OFFSET.arch),
        jump(JEQ, AUDIT_ARCH[arch], 0, 'kill'),
        load(OFFSET.nr),
        ...(table.x32 ? [jump(JGE, table.x32, 'deny')] : []),
        ...table.denied.map((nr) => jump(JEQ, nr, 'deny')),
        jump(JEQ, table.socket, 'family'),
        jump(JEQ, table.socketpair, 'family'),
        ret(RETURN.ALLOW),
        label('family'),
        load(OFFSET.arg0),
        ...ALLOWED_FAMILIES.map((family) => jump(JEQ, family, 'allow')),
        label('deny'),
        ret(RETURN.EPERM),
        label('allow'),
        ret(RETURN.ALLOW),
        label('kill'),
        ret(RETURN.KILL),
    ]);
}
