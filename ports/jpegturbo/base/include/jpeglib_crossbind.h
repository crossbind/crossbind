/* Added by crossbind. libjpeg reports an error by calling error_exit, and the default one ends the process:
 * jpeg_throwing_error installs one that throws the formatted message as a JavaScript exception instead, after which the
 * struct must still be destroyed. The create helpers pass the struct size libjpeg checks, which JavaScript cannot know. */
#ifndef JPEGLIB_CROSSBIND_H
#define JPEGLIB_CROSSBIND_H

#include <stddef.h>
#include <stdio.h>
#include <jpeglib.h>

#ifdef __cplusplus
#include <stdexcept>

static inline struct jpeg_error_mgr *jpeg_throwing_error(struct jpeg_error_mgr *err)
{
    jpeg_std_error(err);
    err->error_exit = [](j_common_ptr cinfo) {
        char message[JMSG_LENGTH_MAX];
        (*cinfo->err->format_message)(cinfo, message);
        throw std::runtime_error(message);
    };
    return err;
}
#endif

static inline void jpeg_create_compress_struct(j_compress_ptr cinfo)
{
    jpeg_create_compress(cinfo);
}

static inline void jpeg_create_decompress_struct(j_decompress_ptr cinfo)
{
    jpeg_create_decompress(cinfo);
}

#endif
