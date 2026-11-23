#include "native.h"

static int count = 0;

Block::Block(int megabytes) : size(megabytes) {
    count += 1;
}

Block::~Block() {
    count -= 1;
}

int Block::megabytes() const {
    return size;
}

int Block::alive() {
    return count;
}
