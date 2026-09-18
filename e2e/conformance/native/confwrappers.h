#ifndef _CROSSBIND_CONFORMANCE_CONFWRAPPERS_H
#define _CROSSBIND_CONFORMANCE_CONFWRAPPERS_H

#include <memory>
#include <utility>
#include <vector>

// Smart pointer wrappers that convert to std::shared_ptr cross as the object: returned by value,
// by const reference and in vectors. A const reference parameter takes the object when the
// wrapper builds from a shared_ptr (ConfNotNull, like gsl::not_null) and stays unbound when it
// does not (ConfChecked, like PROJ's nn). Also references to unique_ptr members, fluent setters
// and references to uncopyable objects.

template <class P> class ConfNotNull {
public:
    using element_type = typename P::element_type;
    explicit ConfNotNull(P value) : ptr(std::move(value)) {}
    element_type &operator*() const { return *ptr; }
    element_type *operator->() const { return ptr.get(); }
    operator const P &() const & { return ptr; }
    operator P &&() && { return std::move(ptr); }

private:
    P ptr;
};

struct ConfCheckedTag {};

template <class P> class ConfChecked {
public:
    using element_type = typename P::element_type;
    ConfChecked(ConfCheckedTag, P value) : ptr(std::move(value)) {}
    ConfChecked(P) = delete;
    element_type &operator*() const { return *ptr; }
    element_type *operator->() const { return ptr.get(); }
    operator const P &() const & { return ptr; }
    operator P &&() && { return std::move(ptr); }

private:
    P ptr;
};

class ConfWrapLeaf {
public:
    explicit ConfWrapLeaf(int v) : value(v) {}
    int doubled() const { return value * 2; }

private:
    int value;
};

using ConfLeafRef = ConfNotNull<std::shared_ptr<ConfWrapLeaf>>;
using ConfLeafChecked = ConfChecked<std::shared_ptr<ConfWrapLeaf>>;

inline ConfLeafRef confWrapMake(int v) { return ConfLeafRef(std::make_shared<ConfWrapLeaf>(v)); }
inline const ConfLeafRef &confWrapCached() {
    static const ConfLeafRef leaf(std::make_shared<ConfWrapLeaf>(7));
    return leaf;
}
inline int confWrapDoubled(const ConfLeafRef &leaf) { return leaf->doubled(); }
inline ConfLeafChecked confWrapMakeChecked(int v) { return ConfLeafChecked(ConfCheckedTag{}, std::make_shared<ConfWrapLeaf>(v)); }
inline int confWrapCheckedDoubled(const ConfLeafChecked &leaf) { return leaf->doubled(); }
inline std::vector<ConfLeafRef> confWrapMany(int count) {
    std::vector<ConfLeafRef> out;
    for (int i = 1; i <= count; ++i) out.emplace_back(std::make_shared<ConfWrapLeaf>(i));
    return out;
}
inline const std::vector<ConfLeafRef> &confWrapCachedMany() {
    static const std::vector<ConfLeafRef> leaves = confWrapMany(2);
    return leaves;
}

class ConfWrapTree {
public:
    ConfWrapTree() : leaf(new ConfWrapLeaf(5)) {}
    const std::unique_ptr<ConfWrapLeaf> &child() const { return leaf; }

private:
    std::unique_ptr<ConfWrapLeaf> leaf;
};

class ConfWrapBuilder {
public:
    ConfWrapBuilder &add(int amount) {
        total += amount;
        return *this;
    }
    int sum() const { return total; }

private:
    int total = 0;
};

class ConfWrapAxis {
public:
    ConfWrapAxis(const ConfWrapAxis &) = delete;
    ConfWrapAxis &operator=(const ConfWrapAxis &) = delete;
    int id() const { return 7; }
    static const ConfWrapAxis &up() {
        static ConfWrapAxis axis;
        return axis;
    }

private:
    ConfWrapAxis() = default;
};

#endif
