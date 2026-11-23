#pragma once

struct Shape {
    virtual ~Shape() = default;
    virtual double area() const = 0;
};

struct Circle : Shape {
    explicit Circle(double radius);
    double area() const override;
    double radius;
};

struct Square : Shape {
    explicit Square(double side);
    double area() const override;
    double side;
};

double largerArea(const Shape &a, const Shape &b);
