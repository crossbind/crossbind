#include "native.h"

Circle::Circle(double radius) : radius(radius) {}

double Circle::area() const {
    return 3.14159265358979 * radius * radius;
}

Square::Square(double side) : side(side) {}

double Square::area() const {
    return side * side;
}

double largerArea(const Shape &a, const Shape &b) {
    return a.area() > b.area() ? a.area() : b.area();
}
