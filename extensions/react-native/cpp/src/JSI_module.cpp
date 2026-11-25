#if ANDROID

#include <jni.h>
#include <memory>
#include <string>
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>
#include <ReactCommon/CallInvoker.h>
#include <ReactCommon/BindingsInstallerHolder.h>
#include <emscripten/bind.h>

std::string jstring2string(JNIEnv *env, jstring jStr) {
    if (!jStr)
        return "";

    const jclass stringClass = env->GetObjectClass(jStr);
    const jmethodID getBytes = env->GetMethodID(stringClass, "getBytes", "(Ljava/lang/String;)[B");
    const jbyteArray stringJbytes = (jbyteArray) env->CallObjectMethod(jStr, getBytes, env->NewStringUTF("UTF-8"));

    size_t length = (size_t) env->GetArrayLength(stringJbytes);
    jbyte* pBytes = env->GetByteArrayElements(stringJbytes, NULL);

    std::string ret = std::string((char *)pBytes, length);
    env->ReleaseByteArrayElements(stringJbytes, pBytes, JNI_ABORT);

    env->DeleteLocalRef(stringJbytes);
    env->DeleteLocalRef(stringClass);
    return ret;
}

extern "C"
{
  // BindingsInstallerHolder is an fbjni HybridClass, so fbjni has to be
  // initialised before newObjectCxxArgs can allocate one.
  JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*)
  {
      return facebook::jni::initialize(vm, [] {});
  }

  JNIEXPORT jobject JNICALL
  Java_com_jsi_lib_RNJsiLibModule_createBindingsInstaller(JNIEnv* env, jobject thiz, jstring path)
  {
      const std::string dataPath = jstring2string(env, path) + "/crossbind";
      auto holder = facebook::react::BindingsInstallerHolder::newObjectCxxArgs(
          [dataPath](facebook::jsi::Runtime& runtime,
                     const std::shared_ptr<facebook::react::CallInvoker>&) {
              emscripten::internal::_embind_initialize_bindings(runtime, dataPath);
          });
      return holder.release();
  }
}
#endif
