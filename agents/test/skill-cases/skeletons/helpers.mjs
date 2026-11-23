export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export const cmakeLibrary = (name, sources) => `cmake_minimum_required(VERSION 3.20)
project(${name} CXX)

set(CMAKE_CXX_STANDARD 17)
add_library(${name} ${sources})
target_include_directories(${name} PUBLIC include)
`;
