/* Clean-failing stubs for symbols the WASI libc lacks; keeps command modules free of undefined imports. */

#include <errno.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

/* Compiled by the C++ driver at the command link; keep C linkage. */
#ifdef __cplusplus
extern "C" {
#endif

/* wasi-libc p2/p3 leaves its output stream at the old offset after SEEK_END. SEEK_SET resets
   that stream, so resolve the end offset through fstat and perform an absolute seek instead. */
off_t __real_lseek(int fd, off_t offset, int whence);
off_t __wrap_lseek(int fd, off_t offset, int whence)
{
    if (whence == SEEK_END) {
        struct stat status;
        if (fstat(fd, &status) != 0) return (off_t)-1;
        off_t absolute;
        if (__builtin_add_overflow(status.st_size, offset, &absolute)) {
            errno = EOVERFLOW;
            return (off_t)-1;
        }
        return __real_lseek(fd, absolute, SEEK_SET);
    }
    return __real_lseek(fd, offset, whence);
}

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
