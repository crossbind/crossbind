#include <stdio.h>
#include <string.h>
#include <zlib.h>

int main(void)
{
    const char *msg = "crossbind linux zlib roundtrip payload 0123456789 crossbind linux zlib roundtrip payload";
    unsigned char comp[512], back[512];
    uLongf clen = sizeof comp, blen = sizeof back;
    if (compress2(comp, &clen, (const Bytef *)msg, strlen(msg) + 1, 9) != Z_OK) return 1;
    if (uncompress(back, &blen, comp, clen) != Z_OK) return 2;
    if (strcmp((const char *)back, msg) != 0) return 3;
    printf("zlib %s: PASS (%lu -> %lu B)\n", zlibVersion(), (unsigned long)(strlen(msg) + 1), (unsigned long)clen);
    return 0;
}
