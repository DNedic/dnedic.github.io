+++
title = "The most thoroughly commented embedded CMakeLists file"
[taxonomies]
tags = [ "CMake", "Build System", "Embedded", "STM32" ]
+++

Many embedded software engineers have had to deal with build systems that are either non cross-platform or a part of the IDE they are using, don't offer easy composability or per-library configuration, provide no testing support or ways to generate or package files without using a third party scripting language.

[CMake](https://cmake.org/) is a build system that offers solutions to many of those problems and is already well adopted in the world of traditional software development.
Inspired by [The most thoroughly commented linker script](https://blog.thea.codes/the-most-thoroughly-commented-linker-script/) blogpost and having used CMake in two different professional environments, I have decided to write an overview of a minimal CMakeLists file for an embedded project.

[Here](https://github.com/DNedic/most_commented_embedded_cmakelists/blob/main/CMakeLists.txt) is the CMakeLists file we are going to be taking a look at. It is a part of a [CMake STM32 project](https://github.com/DNedic/most_commented_embedded_cmakelists) i created as a demonstration and uses an STM32F103 MCU.

## The minimum version
```cmake
cmake_minimum_required(VERSION 3.21)
```
This call is required at the top of every CMakeLists file, it sets the minimum CMake version our project can be built with, and this decides the features that can be used.
Generally it is advisable to set it as low as possible until features from the newer versions are required.
Another good approach is to check [repology](https://repology.org/project/cmake/versions) for the CMake versions shipped in most used Linux distributions.

## Project declaration
```cmake
project(most_commented_embedded_cmakelists
    VERSION 1.0.0
    DESCRIPTION "This is a demo project"
)
```
The [project()](https://cmake.org/cmake/help/latest/command/project.html) call sets up the project name and optionally version, description, homepage and more and stores them in variables that can be used later.
For instance, the project name is stored in `PROJECT_NAME`, description in `PROJECT_DESCRIPTION` and so on.

## Language settings
```cmake
enable_language(C ASM)
```

This sets the languages the project is going to be using, if C++ support is desired add `CXX` to the list.

```cmake
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
```
This sets the language standard globally and whether the standard is a requirement.
This may not be required, however due to the non-backward compatible nature of C and C++ it is preferred.

C11 is a good first choice for projects as it provides useful additions like [atomics](https://en.cppreference.com/w/c/atomic), however it does away with optional features like [VLAs](https://en.wikipedia.org/wiki/Variable-length_array), so C99 or lower might be preferable when working with legacy projects.

```cmake
set(CMAKE_C_EXTENSIONS OFF)
```
This controls the inclusion of the [GNU extensions](https://gcc.gnu.org/onlinedocs/gcc/C-Extensions.html) to the C language globally, `OFF` is preferred for more standard and portable C however GNU extensions can provide useful things on top of the base standard.

## Compiler options
```cmake
set(MCU_OPTIONS
    -mcpu=cortex-m3
    -mthumb
)
```
This sets a custom [microcontroller specific compiler flags](https://gcc.gnu.org/onlinedocs/gcc/ARM-Options.html) variable.
First, the cpu variant is set and then the compiler is told to emit [thumb instructions](https://developer.arm.com/documentation/ddi0337/e/Programmer-s-Model/Instruction-set).

```cmake
set(EXTRA_OPTIONS
    -fdata-sections
    -ffunction-sections
)
```
This sets up a variable containing extra functionality compiler flags.
The flags added here ensure that all objects are placed in separate linker sections. We will see later why that is important.

```cmake
set(OPTIMIZATION_OPTIONS
    $<$<CONFIG:Debug>:-Og>
)
```
Here the compiler optimization flags custom variable is created. The weird looking expression conditionally sets compiler optimization level to `-Og` when building with the Debug [configuration](https://cmake.org/cmake/help/latest/manual/cmake-buildsystem.7.html#build-configurations).

As most microcontrollers are rather limited in terms of flash size and cpu speed, the default
optimization level of `-O0` is not suitable. `-Og` is an optimization level created for the best tradeoff
between size, speed and debugging viability.

Other configurations use their default compiler optimization levels, `-O2` for the `Release` configuration and `-Os` for the `MinSizeRel` configuration, so nothing else is added.

```cmake
set(DEPENDENCY_INFO_OPTIONS
```
Here the preprocessor flags custom variable containing dependency info options is created.
```cmake
    -MMD
```
This line tells the preprocessor to generate dependency files for Make-compatible build systems instead of full preprocessor output, while removing mentions to system header files.
> **Note:** If we need the preprocessor output ourselves we can pass the `-E` argument to the compiler instead.
```cmake
    -MP
```
This option instructs the preprocessor to add a phony target for each dependency other than the main file to work around errors the build system gives if you remove header files without updating it.
```cmake
    -MF "$(@:%.o=%.d)"
)
```
The last line specifies that we want the dependency files to be generated with the same name as the corresponding object file.

```cmake
set(DEBUG_INFO_OPTIONS
    -g3
    -gdwarf-2
)
```
This creates a custom variable containing [compiler flags for generating debug information](https://gcc.gnu.org/onlinedocs/gcc/Debugging-Options.html).
The first line tells the compiler to produce the debugging output and the level of detail while the second line configures the debug output format and version.
We are using dwarf version 2 for best debugger compatibility.

```cmake
add_compile_options(
    ${MCU_OPTIONS}
    ${EXTRA_OPTIONS}
    ${DEBUG_INFO_OPTIONS}
    ${DEPENDENCY_INFO_OPTIONS}
    ${OPTIMIZATION_OPTIONS}
)
```
Finally, all the created variables are used to set the global compiler options.
> **Note:** It is possible to override these per-target by using `target_compile_options()`, for instance to apply a higher optimization level to third party libraries we are not going to be debugging.

## Linker options
```cmake
add_link_options(
```
Here we are adding global linker options.
```cmake
    ${MCU_OPTIONS}
```
First, it is required to pass the previously created microcontroller specific flags variable created earlier.
```cmake
    -specs=nano.specs
```
This tells the linker to include the nano variant of the [newlib](https://sourceware.org/newlib/) standard library which is optimized for minimal binary size and RAM use. The regular newlib variant is used simply by not passing this.

```cmake
    -T${CMAKE_SOURCE_DIR}/STM32F103C8Tx_FLASH.ld
```
Here the linkerscript of the chip is passed. The linkerscript tells the linker where to store the objects in memory.
I recommend reading the already mentioned [most thoroughly commented linker script](https://blog.thea.codes/the-most-thoroughly-commented-linker-script/) blogpost.

```cmake
    -Wl,-Map=${PROJECT_NAME}.map,--cref
```
This directive instructs the linker to generate a mapfile. Mapfiles contain information about the final layout of the firmware binary and are an invaluable resource for development.
I recommend reading [this excellent Interrupt blogpost](https://interrupt.memfault.com/blog/get-the-most-out-of-the-linker-map-file) for a quick introduction.

```cmake
    -Wl,--gc-sections
)
```
This is the linker flag for removing the unused sections from the final binary, it works in conjunction with the previously mentioned ```-fdata-sections``` and ```-ffunction-sections``` compiler flags to remove all unused objects from the final binary.

## Linking the standard library
```cmake
link_libraries("-lc -lm -lnosys")
```
This call tells the linker to link the standard library components to all the libraries and executables
added after the call.

The order of the standard library calls is important as the linker evaluates arguments one by one, with libraries being able to see symbols from libraries on their right:
* -lc is the libc containing most standard library features
* -lm is the libm containing math functionality
* -lnosys provides stubs for the syscalls, essentially placeholders for what would be operating system calls

> **Note:** CMake also offers the `CMAKE_C_STANDARD_LIBRARIES` variable, whose value is always appended at the end of the final linking command.

## Adding library subprojects
```cmake
add_subdirectory(Drivers)
```
When a subdirectory is added, the CMakeLists file contained in that subdirectory is evaluated, this is usually chained for composability.
In this case the ```Drivers``` CMakeLists file creates a static library called ```Drivers```.

```cmake
target_include_directories(Drivers
PRIVATE
    Core/Inc
)
```
We need to include the ```Core/Inc``` for the ```Drivers``` library, as it depends on the definitions inside the ```Core``` headers.

## The executable
```cmake
set(EXECUTABLE ${PROJECT_NAME}.elf)
```
This creates a variable containing the executable name by appending the [ELF](https://en.wikipedia.org/wiki/Executable_and_Linkable_Format) extension to the project name.

```cmake
add_executable(${EXECUTABLE}
    Core/Src/main.c
    Core/Src/stm32f1xx_hal_msp.c
    Core/Src/stm32f1xx_it.c
    Core/Src/system_stm32f1xx.c
    startup_stm32f103xb.s
)
```
Here we are creating the executable target and adding top-level sources to it.
An executable is the final product of the build process, in this case our firmware.
Note the startup file gets added along with the C sources.

```cmake
target_include_directories(${EXECUTABLE}
PRIVATE
    Core/Inc
)
```
Add the include directories for the executable.
Since we don't need the includes to propagate up as our executable is the final product of the build process, we are including as `PRIVATE`.

```cmake
target_compile_options(${EXECUTABLE}
PRIVATE
    -Wall
    -Wextra
    -Wshadow
    -Wconversion
    -Wdouble-promotion
)
```
This adds [additional warning compiler flags](https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html) to our executable target, enabling them for our sources, but not third party libraries.
All of these provide much more safety if not ignored.

```cmake
target_link_libraries(${EXECUTABLE}
PRIVATE
    Drivers
)
```
Here we link the libraries to the executable. Same principle applies to the reasoning behind `PRIVATE`.

## Post-build commands
```cmake
add_custom_command(TARGET ${EXECUTABLE}
    POST_BUILD
    COMMAND ${CMAKE_SIZE_UTIL} ${EXECUTABLE}
)
```
This creates a custom command that prints out the firmware binary size information.
Example:

```
text   data    bss    dec    hex filename
3432     20   1572   5024   13a0 most_commented_embedded_cmakelists.elf
```

`text` is the code, `data` stores variables that have a non-zero initial value and have to be stored in flash,
`bss` stores zero initial values that only take up ram. `dec` and `hex` are just the cumulative size in decimal and hexadecimal notation respectively.

[Here](https://mcuoneclipse.com/2013/04/14/text-data-and-bss-code-and-data-size-explained/) is a good resource for understanding these sections and to learn more about output options.

```cmake
add_custom_command(TARGET ${EXECUTABLE}
    POST_BUILD
    COMMAND ${CMAKE_OBJCOPY} -O ihex ${EXECUTABLE} ${PROJECT_NAME}.hex
    COMMAND ${CMAKE_OBJCOPY} -O binary ${EXECUTABLE} ${PROJECT_NAME}.bin
)
```
This creates a custom command to generate binary and hex files.
These can be used depending on which method of loading the firmware to the MCU is used.

## Closing
Hopefully this gives you an overview of how a minimal CMakeLists file for an embedded project looks like and peaked your curiosity if you've never used CMake for embedded projects.

It is worth keeping in mind that this article is not a complete guide to CMake and doesn't go into toolchain files, library CMakeLists and other things required for a complete CMake-based embedded project, however the [project on GitHub](https://github.com/DNedic/most_commented_embedded_cmakelists) used for demonstration contains all of those and can be used as a template.
