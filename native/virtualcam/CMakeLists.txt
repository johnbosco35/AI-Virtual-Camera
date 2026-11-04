cmake_minimum_required(VERSION 3.20)
project(avc_virtualcam LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)

# Skeleton build. The media source DLL target is added when that source exists.
add_executable(vcamctl vcamctl/vcamctl.cpp)
target_link_libraries(vcamctl PRIVATE mfplat mf mfuuid ole32)
