#include <Matrix.h>
#include <cstdio>
#include <memory>

int main() {
    auto firstMatrix = std::make_shared<Matrix>(9, 1);
    auto secondMatrix = std::make_shared<Matrix>(9, 2);
    printf("Matrix multiplier with c++ => J₃ * (2*J₃) = %d*J₃\n", firstMatrix->multiple(secondMatrix)->get(0));
    return 0;
}
