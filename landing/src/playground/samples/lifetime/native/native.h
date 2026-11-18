#pragma once

// Each Block counts itself in and out, so JavaScript can see
// when C++ frees one.
class Block {
public:
    explicit Block(int megabytes);
    ~Block();
    int megabytes() const;
    static int alive();

private:
    int size;
};
