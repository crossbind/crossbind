import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seccompProgram, AUDIT_ARCH, RETURN } from '../compiler/seccomp.js';

const SYSCALL = {
    x64: { read: 0, socket: 41, socketpair: 53, io_uring_setup: 425, bpf: 321, ptrace: 101, perf_event_open: 298, userfaultfd: 323 },
    arm64: { read: 63, socket: 198, socketpair: 199, io_uring_setup: 425, bpf: 280, ptrace: 117, perf_event_open: 241, userfaultfd: 282 },
};
const AF = { UNIX: 1, INET: 2, INET6: 10, NETLINK: 16, PACKET: 17, VSOCK: 40 };

// Runs the classic BPF program the way the kernel does, for the few instructions the filter uses.
function decide(program, { arch, nr, arg0 = 0 }) {
    const data = Buffer.alloc(64);
    data.writeUInt32LE(nr, 0);
    data.writeUInt32LE(arch, 4);
    data.writeUInt32LE(arg0, 16);
    let accumulator = 0;
    for (let pc = 0; pc * 8 < program.length;) {
        const code = program.readUInt16LE(pc * 8);
        const jt = program[pc * 8 + 2];
        const jf = program[pc * 8 + 3];
        const k = program.readUInt32LE(pc * 8 + 4);
        if (code === 0x20) {
            accumulator = data.readUInt32LE(k);
            pc += 1;
        } else if (code === 0x15) {
            pc += 1 + (accumulator === k ? jt : jf);
        } else if (code === 0x35) {
            pc += 1 + (accumulator >= k ? jt : jf);
        } else if (code === 0x06) {
            return k;
        } else {
            throw new Error(`unexpected BPF instruction ${code.toString(16)}`);
        }
    }
    throw new Error('the program ran off its end');
}

['x64', 'arm64'].forEach((name) => {
    const program = seccompProgram(name);
    const call = (syscall, arg0) => decide(program, { arch: AUDIT_ARCH[name], nr: SYSCALL[name][syscall], arg0 });

    test(`${name}: refuses the syscalls a compile never needs`, () => {
        ['io_uring_setup', 'bpf', 'ptrace', 'perf_event_open', 'userfaultfd'].forEach((syscall) => assert.equal(call(syscall), RETURN.EPERM, syscall));
        assert.equal(call('read'), RETURN.ALLOW);
    });

    test(`${name}: opens sockets of the unix and internet families only`, () => {
        [AF.UNIX, AF.INET, AF.INET6].forEach((family) => assert.equal(call('socket', family), RETURN.ALLOW, `family ${family}`));
        [AF.NETLINK, AF.PACKET, AF.VSOCK].forEach((family) => {
            assert.equal(call('socket', family), RETURN.EPERM, `family ${family}`);
            assert.equal(call('socketpair', family), RETURN.EPERM, `pair of family ${family}`);
        });
    });

    test(`${name}: kills a process calling with another architecture`, () => {
        const other = name === 'x64' ? AUDIT_ARCH.arm64 : AUDIT_ARCH.x64;

        assert.equal(decide(program, { arch: other, nr: 0 }), RETURN.KILL);
    });
});

test('x64: refuses the x32 syscall numbers', () => {
    assert.equal(decide(seccompProgram('x64'), { arch: AUDIT_ARCH.x64, nr: 0x40000000 }), RETURN.EPERM);
});

test('refuses to build a filter for an architecture it does not know', () => {
    assert.throws(() => seccompProgram('riscv64'), /riscv64/);
});
