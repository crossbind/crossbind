// Adapt the runtime emitted by the pinned SWIG fork. Kept in the generator so cache rebuilds
// produce the same runtime in every bridge, including builds on a remote runner.
export default function fixBridgeRuntime(text) {
    if (!text.includes('template<typename A> auto callbackArgument(')) return text;
    if (!text.includes('void bindFunctionPointerField(')) {
        text = text.replace('template<auto M, bool Instance, typename Builder> void bindField(',
            'template<auto M, typename Builder> void bindFunctionPointerField(const Builder &cls, const char *name);\n'
            + 'template<auto M, bool Instance, typename Builder> void bindField(');
        text = text.replace('} else if constexpr (std::is_pointer_v<U> && !std::is_function_v<std::remove_pointer_t<U>>) {',
            '} else if constexpr (std::is_pointer_v<U> && std::is_function_v<std::remove_pointer_t<U>>) {\n'
            + '    bindFunctionPointerField<M>(cls, name);\n'
            + '  } else if constexpr (std::is_pointer_v<U>) {');
        text = text.replace('template<typename T> constexpr bool isPassedByAddress =', `template<auto M, typename Builder> void bindFunctionPointerField(const Builder &cls, const char *name) {
  using C = typename MemberOf<decltype(M)>::Class;
  using T = typename MemberOf<decltype(M)>::Type;
  using U = std::remove_cv_t<T>;
  auto read = +[](const C &s) { return toHandle(s.*M); };
  if constexpr (std::is_const_v<T>) cls.property(name, read);
  else cls.property(name, read, +[](C &s, JsCallback<U> value) { s.*M = fromJsCallback<U>(value); });
}
template<typename T> constexpr bool isPassedByAddress =`);
    }
    if (!text.includes('auto callbackArgumentAt(')) {
        text = '#include <tuple>\n' + text;
        text = text.replace('#ifndef __EMSCRIPTEN__\nstruct RuntimeCallbacks {', `// A const char* followed by an integer may be a byte span, with embedded NULs or no terminator.
// Preserve its address; JavaScript can read exactly the reported length with readBuffer.
template<size_t I, typename Tuple> auto callbackArgumentAt(Tuple values) {
  using A = std::remove_cv_t<std::remove_reference_t<decltype(std::get<I>(values))>>;
  if constexpr (std::is_same_v<A, const char *> && I + 1 < std::tuple_size_v<Tuple>) {
    using Next = std::remove_cv_t<std::remove_reference_t<decltype(std::get<I + 1>(values))>>;
    if constexpr (std::is_integral_v<Next>) return toHandle(std::get<I>(values));
    else return callbackArgument<A>(std::get<I>(values));
  } else return callbackArgument<A>(std::get<I>(values));
}
#ifndef __EMSCRIPTEN__
struct RuntimeCallbacks {`);
        text = text.replaceAll('template<typename R, typename... A> R invokeCallback(size_t slot, A... args) {',
            'template<typename R, typename... A, size_t... I> R invokeCallbackArguments(size_t slot, std::index_sequence<I...>, A... args) {');
        text = text.replaceAll('callbackArgument<A>(std::declval<std::remove_reference_t<A> &>())',
            'callbackArgumentAt<I>(std::declval<std::tuple<A &...>>())');
        text = text.replaceAll('callbackArgument<A>(args)', 'callbackArgumentAt<I>(std::tie(args...))');
        text = text.replace('template<typename F> struct Callback {', `template<typename R, typename... A> R invokeCallback(size_t slot, A... args) {
  return invokeCallbackArguments<R, A...>(slot, std::index_sequence_for<A...>{}, std::forward<A>(args)...);
}
template<typename F> struct Callback {`);
    }
    return text;
}
