#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <string>
#include <fcntl.h>
#include <unistd.h>

// The three things a WASI command must prove: argv arrives, the preopened
// directory is a real read-write filesystem, and C++ exceptions unwind
// (wasm-EH new format; run under `wasmtime -W exceptions=y`).
int main(int argc, char **argv) {
    printf("hello from wasi command (argc=%d%s%s)\n", argc,
           argc > 1 ? ", argv[1]=" : "", argc > 1 ? argv[1] : "");

    FILE *w = fopen("roundtrip.txt", "w");
    if (!w) {
        printf("FAIL: fs write\n");
        return 1;
    }
    fputs("wasi-roundtrip", w);
    fclose(w);

    char buf[64] = {0};
    FILE *r = fopen("roundtrip.txt", "r");
    if (!r) {
        printf("FAIL: fs read\n");
        return 1;
    }
    fgets(buf, sizeof buf, r);
    fclose(r);
    printf("fs roundtrip: %s\n", strcmp(buf, "wasi-roundtrip") == 0 ? "PASS" : "FAIL");

    int fd = open("seek.txt", O_CREAT | O_TRUNC | O_RDWR, 0600);
    if (fd < 0 || write(fd, "AAAA", 4) != 4 || lseek(fd, 0, SEEK_SET) != 0 ||
        write(fd, "B", 1) != 1 || lseek(fd, 0, SEEK_END) != 4 || write(fd, "CC", 2) != 2 ||
        lseek(fd, -2, SEEK_END) != 4 || write(fd, "DD", 2) != 2 || lseek(fd, 0, SEEK_SET) != 0) {
        printf("FAIL: seek\n");
        return 1;
    }
    memset(buf, 0, sizeof buf);
    if (read(fd, buf, sizeof buf - 1) != 6 || strcmp(buf, "BAAADD") != 0) {
        printf("FAIL: seek contents (%s)\n", buf);
        return 1;
    }
    close(fd);
    printf("seek roundtrip: PASS\n");

    try {
        throw std::runtime_error(std::string("expected-") + "throw");
    } catch (const std::exception &e) {
        printf("exceptions: PASS (%s)\n", e.what());
    }

    return 0;
}
