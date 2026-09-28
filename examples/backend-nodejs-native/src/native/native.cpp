#include "native.h"
#include <Matrix.h>

std::string Native::sample() {
  auto firstMatrix = std::make_shared<Matrix>(9, 1);
  auto secondMatrix = std::make_shared<Matrix>(9, 2);
  auto resultStr = std::to_string(firstMatrix->multiple(secondMatrix)->get(0));
  return "J₃ * (2*J₃) = " + resultStr + "*J₃";
}
