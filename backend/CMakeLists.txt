cmake_minimum_required(VERSION 3.22)
project(hash CXX C)
set(CMAKE_CXX_STANDARD 17)
set(${PROJECT_NAME}_SOURCE
        src/main.cpp
        src/util.cpp
        src/HashCHD.cpp
)

set(RCHEEVOS_SOURCE
        src/rcheevos/src/rc_compat.c
        src/rcheevos/src/rhash/cdreader.c
        src/rcheevos/src/rhash/aes.c
        src/rcheevos/src/rhash/hash.c
        src/rcheevos/src/rhash/hash_disc.c
        src/rcheevos/src/rhash/hash_encrypted.c
        src/rcheevos/src/rhash/hash_rom.c
        src/rcheevos/src/rhash/hash_zip.c
        src/rcheevos/src/rhash/md5.c
)


add_subdirectory(${PROJECT_SOURCE_DIR}/src/libchdr)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "disable libarchive shared libs")
set(ENABLE_TAR OFF CACHE BOOL "disable libarchive tar binary")
set(ENABLE_CPIO OFF CACHE BOOL "disable libarchive cpio binary")
set(ENABLE_CAT OFF CACHE BOOL "disable libarchive cat binary")
set(ENABLE_UNZIP OFF CACHE BOOL "disable libarchive unzip binary")
set(ENABLE_TEST OFF CACHE BOOL "disable libarchive unit tests")
# Disable optional libarchive features to avoid version-specific dynamic dependencies
set(ENABLE_LIBXML2 OFF CACHE BOOL "disable libxml2 (removes ICU dependency)" FORCE)
set(ENABLE_EXPAT OFF CACHE BOOL "disable expat" FORCE)
set(ENABLE_OPENSSL OFF CACHE BOOL "disable openssl" FORCE)
set(ENABLE_LIBB2 OFF CACHE BOOL "disable libb2" FORCE)
set(ENABLE_LZ4 OFF CACHE BOOL "disable lz4" FORCE)
set(ENABLE_ZSTD OFF CACHE BOOL "disable zstd" FORCE)
set(ENABLE_ACL OFF CACHE BOOL "disable acl" FORCE)
set(ENABLE_WERROR OFF CACHE BOOL "disable warnings as errors" FORCE)
add_subdirectory(${PROJECT_SOURCE_DIR}/src/libarchive)

add_executable(${PROJECT_NAME}
        ${${PROJECT_NAME}_SOURCE}
        ${RCHEEVOS_SOURCE}
)

target_link_libraries(${PROJECT_NAME} chdr-static archive_static)
target_link_options(${PROJECT_NAME} PRIVATE -static-libgcc -static-libstdc++)

target_include_directories(${PROJECT_NAME}
        PRIVATE
        src/rcheevos/include
        src/miniz
)

