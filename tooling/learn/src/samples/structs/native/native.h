#pragma once

#include <string>

// Public fields of a struct read and write like properties.
struct Point {
    double x;
    double y;
};

// Members arrive as Direction.North, .East and so on.
enum class Direction { North, East, South, West };

Point step(Point point, Direction direction, double distance);
Direction turnRight(Direction direction);
std::string nameOf(Direction direction);
