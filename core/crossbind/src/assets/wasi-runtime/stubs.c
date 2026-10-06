/* Clean-failing stubs for symbols the WASI libc lacks; keeps command modules free of undefined imports. */

#include <errno.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#include <netinet/in.h>
#include <sys/socket.h>

/* Compiled by the C++ driver at the command link; keep C linkage. */
#ifdef __cplusplus
extern "C" {
#endif

/* No dynamic loading on WASI; loaders treat NULL as "plugin unavailable". */
void *dlopen(const char *file, int mode)
{
    (void)file;
    (void)mode;
    return NULL;
}

char *dlerror(void)
{
    return (char *)"dynamic loading is not supported on WASI";
}

void *dlsym(void *handle, const char *symbol)
{
    (void)handle;
    (void)symbol;
    return NULL;
}

int dlclose(void *handle)
{
    (void)handle;
    return -1;
}

/* WASI has no ambient /tmp; POSIX lets tmpfile fail, callers must handle NULL (libtiff's fax2ps does). */
FILE *tmpfile(void)
{
    errno = ENOTSUP;
    return NULL;
}

/* No fork on WASI; registering handlers is safely a no-op (PROJ registers one). */
int pthread_atfork(void (*prepare)(void), void (*parent)(void), void (*child)(void))
{
    (void)prepare;
    (void)parent;
    (void)child;
    return 0;
}

/* wasmtime (46/47) traps in mid-connect getsockname/getpeername; zeroed shadows keep libcurl alive - drop when the runtime catches up. */
static int crossbind_zeroed_inet(struct sockaddr *addr, socklen_t *len)
{
    struct sockaddr_in a;
    memset(&a, 0, sizeof a);
    a.sin_family = AF_INET;
    socklen_t n = *len < (socklen_t)sizeof a ? *len : (socklen_t)sizeof a;
    memcpy(addr, &a, n);
    *len = (socklen_t)sizeof a;
    return 0;
}

int getsockname(int fd, struct sockaddr *addr, socklen_t *len)
{
    (void)fd;
    return crossbind_zeroed_inet(addr, len);
}

int getpeername(int fd, struct sockaddr *addr, socklen_t *len)
{
    (void)fd;
    return crossbind_zeroed_inet(addr, len);
}

/* The WASI SQLite leaves extension loading out, yet SpatiaLite's stored procedures switch it off; this answers
   SQLITE_ERROR as such a build does. Weak, so a SQLite that has the function keeps its own. */
__attribute__((weak)) int sqlite3_enable_load_extension(void *db, int onoff)
{
    (void)db;
    (void)onoff;
    return 1;
}

#ifdef __cplusplus
}
#endif
