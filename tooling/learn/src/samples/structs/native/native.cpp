#include "native.h"

Point step(Point point, Direction direction, double distance) {
    switch (direction) {
        case Direction::North: point.y += distance; break;
        case Direction::East: point.x += distance; break;
        case Direction::South: point.y -= distance; break;
        case Direction::West: point.x -= distance; break;
    }
    return point;
}

Direction turnRight(Direction direction) {
    const int next = (static_cast<int>(direction) + 1) % 4;
    return static_cast<Direction>(next);
}

std::string nameOf(Direction direction) {
    switch (direction) {
        case Direction::North: return "north";
        case Direction::East: return "east";
        case Direction::South: return "south";
        case Direction::West: return "west";
    }
    return "";
}
