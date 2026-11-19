#ifndef _CROSSBIND_CONFORMANCE_CONFWRAPPERS_H
#define _CROSSBIND_CONFORMANCE_CONFWRAPPERS_H

#include <memory>
#include <utility>
#include <vector>

// Smart pointer wrappers that convert to std::shared_ptr cross as the object: returned by value,
// by const reference and in vectors. A const reference parameter takes the object when the
// wrapper builds from a shared_ptr (ConfNotNull, like gsl::not_null) and stays unbound when it
// does not (ConfChecked, like PROJ's nn). Also unique_ptr results, references to unique_ptr
// members, fluent setters and references to uncopyable objects.

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
    typedef std::unique_ptr<ConfWrapLeaf> Ptr;
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

// A unique_ptr result is the object, which JavaScript then owns. A unique_ptr parameter would destroy the object its
// argument's handle still holds: by value, through an alias such as GEOS's Geometry::Ptr, as an rvalue or through a
// const reference, it stays out of the bridge.
inline std::unique_ptr<ConfWrapLeaf> confWrapOwned(int v) { return std::make_unique<ConfWrapLeaf>(v); }
inline int confWrapTake(std::unique_ptr<ConfWrapLeaf> leaf) { return leaf->doubled(); }
inline int confWrapTakeAlias(ConfWrapLeaf::Ptr leaf) { return leaf->doubled(); }
inline int confWrapTakeMoved(std::unique_ptr<ConfWrapLeaf> &&leaf) { return leaf->doubled(); }
inline int confWrapPeekOwned(const std::unique_ptr<ConfWrapLeaf> &leaf) { return leaf->doubled(); }

class ConfWrapTree {
public:
    ConfWrapTree() : leaf(new ConfWrapLeaf(5)) {}
    const std::unique_ptr<ConfWrapLeaf> &child() const { return leaf; }
    void adopt(std::unique_ptr<ConfWrapLeaf> other) { leaf = std::move(other); }

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
