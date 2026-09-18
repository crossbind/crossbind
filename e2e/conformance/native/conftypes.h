#ifndef _CROSSBIND_CONFORMANCE_CONFTYPES_H
#define _CROSSBIND_CONFORMANCE_CONFTYPES_H

#include "confexport.h"

// Enums plain and scoped, a class-scoped enum whose name another class reuses, a virtual base
// that needs a dynamic_cast downcast, an export macro from another header, and a declaration the
// library never defines (listed in the kit's ignoredDeclarations).

enum ConfColor { CONF_RED = 1, CONF_GREEN = 2, CONF_BLUE = 4 };
enum class ConfMode { Fast = 3, Safe = 4 };

inline int confTypeColor(ConfColor color) { return color * 10; }
inline int confTypeMode(ConfMode mode) { return static_cast<int>(mode) * 100; }
inline ConfMode confTypeSafer(ConfMode mode) { return mode == ConfMode::Fast ? ConfMode::Safe : ConfMode::Fast; }

class ConfTypeShape {
public:
    virtual ~ConfTypeShape() = default;
    virtual int sides() const = 0;
};

class ConfTypeQuad : virtual public ConfTypeShape {
public:
    int sides() const override { return 4; }
    int corners() const { return 4; }
};

inline ConfTypeShape *confTypeMakeQuad() {
    static ConfTypeQuad quad;
    return &quad;
}
inline int confTypeSides(const ConfTypeShape *shape) { return shape ? shape->sides() : -1; }

class ConfWktFormatter {
public:
    enum class Convention { WKT2 = 2 };
    static int use(Convention convention) { return static_cast<int>(convention); }
};

class ConfProjFormatter {
public:
    enum class Convention { PROJ5 = 5 };
    static int use(Convention convention) { return static_cast<int>(convention); }
};

inline CONF_API int confTypeMarked() { return 42; }
int confTypeDeclaredOnly(int value);

#endif
