#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <string>
#include <zlib.h>

// What a native command must prove: argv arrives, the filesystem is the host's own, C++ exceptions
// unwind, and a port archive links in.
int main(int argc, char **argv) {
    printf("hello from native command (argc=%d%s%s)\n", argc,
           argc > 1 ? ", argv[1]=" : "", argc > 1 ? argv[1] : "");

    FILE *w = fopen("roundtrip.txt", "w");
    if (!w) {
        printf("FAIL: fs write\n");
        return 1;
    }
    fputs("native-roundtrip", w);
    fclose(w);

    char buf[64] = {0};
    FILE *r = fopen("roundtrip.txt", "r");
    if (!r) {
        printf("FAIL: fs read\n");
        return 1;
    }
    fgets(buf, sizeof buf, r);
    fclose(r);
    printf("fs roundtrip: %s\n", strcmp(buf, "native-roundtrip") == 0 ? "PASS" : "FAIL");

    try {
        throw std::runtime_error(std::string("expected-") + "throw");
    } catch (const std::exception &e) {
        printf("exceptions: PASS (%s)\n", e.what());
    }

    const char *msg = "crossbind native zlib roundtrip payload 0123456789";
    unsigned char packed[256], unpacked[256];
    uLongf packedLength = sizeof packed, unpackedLength = sizeof unpacked;
    bool ok = compress(packed, &packedLength, reinterpret_cast<const Bytef *>(msg), strlen(msg) + 1) == Z_OK
        && uncompress(unpacked, &unpackedLength, packed, packedLength) == Z_OK
        && strcmp(msg, reinterpret_cast<const char *>(unpacked)) == 0;
    printf("zlib %s: %s\n", zlibVersion(), ok ? "PASS" : "FAIL");
    return 0;
}
