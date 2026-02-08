+++
title = "Linker Script Generation for Firmware Projects: A Primer"
[taxonomies]
tags = [ "Linker script", "Embedded", "CMake", "STM32", "Zephyr", "ESP-IDF"]
+++

If you've worked on firmware for any length of time, chances are you had to modify or write a linker script at some point.
The core principles are pretty straightforward - define memory regions, place sections inside, respect alignment requirements, define a few symbols and you're good to go.

While this is enough initially, projects can grow unpredictably.
At some point you might need to add support for multiple chips or different external memories.
Maybe you end up needing support for different bootloaders?
Perhaps you might want to load the code into RAM directly for debugging purposes?
Before you know it, these variations pile up, and suddenly you’re juggling a bunch of nearly identical linker scripts you have to keep in sync, which becomes tedious and error-prone.

In this article, we'll talk about how this happens and dive into a practical example that shows how to keep linker scripts manageable as firmware projects grow.

> **Note:** If it’s been a while since you last tinkered with linker scripts, check out [this great blogpost](https://mcyoung.xyz/2021/06/01/linker-script/) and the [official GNU documentation](https://sourceware.org/binutils/docs/ld/Scripts.html)

[TOC]

## Why variants break linker scripts

Consider a common scenario:

* You start developing a product using a single chip and a straightforward memory layout. At this stage, your linker script is simple, easy to maintain, and just does what it needs to do.

* Later, the original chip becomes hard to source, so you add support for a pin-compatible replacement with more flash and RAM.
  To accommodate both chips, you copy the original linker script, changing only the region sizes.

* Next, you decide to add optional bootloader support for devices that can update over the air.
  This introduces another layer of variation: each chip can be built with or without the bootloader, doubling the number of linker scripts.

* Finally, a new variant of your product includes an LCD and requires external memory for bitmaps. Now you’re managing eight linker script variants across different configurations!

This illustrates why linker scripts can become hard to maintain: each change has to be duplicated across all variations with some falling out of sync over time, making it harder to tell if changes are intentional or not.
To stay in control, we have to find a way to approach them like other software: **factor out the parts that stay the same, and only configure the parts that change**.

## Building the mental framework

Let’s take a step back and figure out what really changes and what usually stays the same.

No matter what we do, the linker needs a valid script at the end of the day.
That means the overall structure, syntax, and required sections are mostly fixed: we'll always have a `.text` section, a `.data` section, and certain architecture-specific details like alignment rules or symbol definitions.
We could use these to create a **template**, which we can then fill out with configurable parts, such as
* memory properties
* section region mappings
* reservations for optional features

As an example, the memory region part of the linker script template could look like this:

```ld
MEMORY {
  FLASH (rx) : ORIGIN = ${flash_start}, LENGTH = ${flash_size}
  RAM   (rwx): ORIGIN = ${ram_start},   LENGTH = ${ram_size}
}
```

Then, we can store the changing values in the build system itself or in separate YAML/JSON files and somehow **generate** the final linker script by combining them with the template.
The output will still be a normal `.ld` file - the linker should never see the template or the configuration.

## A minimal example project
Let’s look at a concrete example to see how all this works in practice.
We’ll start from a [simple CMake firmware project](https://github.com/DNedic/most_commented_embedded_cmakelists) for an STM32 microcontroller.
For the impatient, the end result lives on the [linker_script_generation branch](https://github.com/DNedic/most_commented_embedded_cmakelists/tree/linker_script_generation).

For demonstration purposes, we will set aside the STM32CubeMX-provided linker script and use the simplest linker script that can still build and run the project correctly:
```ld
ENTRY(Reset_Handler)

MEMORY
{
    RAM (xrw)  : ORIGIN = 0x20000000, LENGTH = 20K
    FLASH (rx) : ORIGIN = 0x8000000, LENGTH = 64K
}

SECTIONS
{
    .isr_vector : ALIGN(4)
    {
        KEEP(*(.isr_vector))
    } > FLASH

    .text : ALIGN(4)
    {
        *(.text)
        *(.text*)
        KEEP (*(.init))
        KEEP (*(.fini))
    } > FLASH

    .preinit_array : ALIGN(4)
    {
        PROVIDE_HIDDEN(__preinit_array_start = .);
        KEEP(*(.preinit_array*))
        PROVIDE_HIDDEN(__preinit_array_end = .);
    } > FLASH

    .init_array : ALIGN(4)
    {
        PROVIDE_HIDDEN(__init_array_start = .);
        KEEP(*(SORT(.init_array.*)))
        KEEP(*(.init_array))
        PROVIDE_HIDDEN(__init_array_end = .);
    } > FLASH

    .fini_array : ALIGN(4)
    {
        PROVIDE_HIDDEN(__fini_array_start = .);
        KEEP(*(SORT(.fini_array.*)))
        KEEP(*(.fini_array))
        PROVIDE_HIDDEN(__fini_array_end = .);
    } > FLASH

    .rodata : ALIGN(4)
    {
        *(.rodata)
        *(.rodata*)
    } > FLASH

    _sidata = LOADADDR(.data);

    .data : ALIGN(4)
    {
        _sdata = .;
        *(.data)
        *(.data*)
        _edata = ALIGN(4);
    } > RAM AT> FLASH

    .bss : ALIGN(4)
    {
        _sbss = .;
        __bss_start__ = _sbss;
        *(.bss)
        *(.bss*)
        _ebss = ALIGN(4);
        __bss_end__ = _ebss;
    } > RAM

    .heap (NOLOAD) : ALIGN(8)
    {
        PROVIDE ( end = . );
        PROVIDE ( _end = . );
        . = . + 0x200;
    } > RAM

    .stack (NOLOAD) : ALIGN(8)
    {
        . = . + 0x400; /* A minimum beyond which linking will fail */
    } > RAM

    _estack = ORIGIN(RAM) + LENGTH(RAM);
}
```

## Turning the linker script into a template

We could generate linker scripts from templates in a couple of ways.
For instance, we could use Python and Jinja templates, CMake’s built-in `configure_file()` to replace placeholders or even go wild and use `sed`.
In our case however, we'll be using the C preprocessor!
It lives inside your toolchain, can substitute placeholders and conditionally include or not whole sections of text.

Our first step is to factor out constants like the stack and heap size so that we can configure them dynamically:
```ld
/* --snip-- */
MEMORY
{
    RAM (xrw)  : ORIGIN = RAM_ORIGIN, LENGTH = RAM_LENGTH
    FLASH (rx) : ORIGIN = FLASH_ORIGIN, LENGTH = FLASH_LENGTH
}

SECTIONS
{
    /* --snip-- */
    .heap (NOLOAD) : ALIGN(8)
    {
        PROVIDE ( end = . );
        PROVIDE ( _end = . );
        . = . + HEAP_SIZE;
    } > RAM

    .stack (NOLOAD) : ALIGN(8)
    {
        . = . + MINIMUM_STACK_SIZE;
    } > RAM
   /* --snip-- */
}
```
and rename the linker script to `linker.ld.in` to make it clear that that it is indeed a template.
Now we can run the preprocessor to verify that we haven't broken anything:
```bash
arm-none-eabi-gcc \
    -E -P -x c \
    -DRAM_ORIGIN=0x20000000 \
    -DRAM_LENGTH=20K \
    -DFLASH_ORIGIN=0x08000000 \
    -DFLASH_LENGTH=64K \
    -DHEAP_SIZE=0x200 \
    -DMINIMUM_STACK_SIZE=0x400 \
    linker.ld.in > linker.ld
```
> **Note:** The `-E` argument invokes the preprocessor only, despite us calling the compiler binary, whereas `-x c` flag forces the file to be treated as a preprocessor input, and `-P` suppresses line markers which the preprocessor normally emits.

If all goes well, the generated linker script should match the one we started with.

Now that we know that this works, we can integrate it into our build system.
First we will move these values into CMake variables.
```CMake
set(RAM_ORIGIN 0x20000000)
set(RAM_LENGTH 20480)
set(FLASH_ORIGIN 0x08000000)
set(FLASH_LENGTH 65536)
set(HEAP_SIZE 0x200)
set(MINIMUM_STACK_SIZE 0x400)
```
> **Note:** We are making them purely numeric in order to be able to do operations on them later.

Then, we can use a CMake [custom command](https://cmake.org/cmake/help/latest/command/add_custom_command.html):
```CMake
add_custom_command(
    OUTPUT ${CMAKE_BINARY_DIR}/linker.ld
    COMMAND ${CMAKE_C_COMPILER}
            -E -P -x c
            -DRAM_ORIGIN=${RAM_ORIGIN}
            -DRAM_LENGTH=${RAM_LENGTH}
            -DFLASH_ORIGIN=${FLASH_ORIGIN}
            -DFLASH_LENGTH=${FLASH_LENGTH}
            -DHEAP_SIZE=${HEAP_SIZE}
            -DMINIMUM_STACK_SIZE=${MINIMUM_STACK_SIZE}
            ${CMAKE_SOURCE_DIR}/linker.ld.in
            > ${CMAKE_BINARY_DIR}/linker.ld
    DEPENDS ${CMAKE_SOURCE_DIR}/linker.ld.in
    COMMENT "Generating linker script"
)
```
> **Note:** The `DEPENDS` here makes sure that if the template itself changes, CMake understands that the command needs to be run again.

and make it run at build time by making the executable depend on the generated linker script:
```CMake
add_executable(${EXECUTABLE}
    # --snip--
    ${CMAKE_BINARY_DIR}/linker.ld
)
```

Lastly, we can change the linking options to use our generated linker script:
```CMake
add_link_options(
    # --snip--
    -T${CMAKE_BINARY_DIR}/linker.ld
    # --snip--
)
```
With this, our project builds and we can finally get to the fun part - making the linker script configurable!

## Adding options

Let's start simple by making the stack and heap size configurable.
After deleting the constants we previously added, we need simply define cached values when configuring the project:
```bash
cmake -S . -B build -DHEAP_SIZE=0 -DMINIMUM_STACK_SIZE=0x800 -DCMAKE_BUILD_TYPE=Debug -DCMAKE_TOOLCHAIN_FILE=arm-none-eabi-gcc.cmake
```

We can now check the resultant `linker.ld` file in our build folder:

```ld
    /* --snip-- */

    .heap (NOLOAD) : ALIGN(8)
    {
        PROVIDE ( end = . );
        PROVIDE ( _end = . );
        . = . + 0;
    } > RAM

    .stack (NOLOAD) : ALIGN(8)
    {
        . = . + 0x800;
    } > RAM

    /* --snip-- */
```

Nice!
This should be our starting point when debugging any linker generation issues in the future.

Since it is good practice to introduce default values for user configuration in CMake, we can handle the case when variables aren't defined:
```CMake
if (NOT DEFINED HEAP_SIZE)
    set(HEAP_SIZE 0x200)
endif()
if (NOT DEFINED MINIMUM_STACK_SIZE)
    set(MINIMUM_STACK_SIZE 0x400)
endif()
```

Next, let’s tackle optional bootloader support.
The STM32 [chip we are using](https://www.st.com/resource/en/reference_manual/rm0008-stm32f101xx-stm32f102xx-stm32f103xx-stm32f105xx-and-stm32f107xx-advanced-armbased-32bit-mcus-stmicroelectronics.pdf) has uniform 1KB pages, so the bootloader could be sized any multiple of that.
Additionally, some of those sectors could also be used for EEPROM emulation or other purposes.
For the most general solution, we can handle this by introducing a `FIRMWARE_FLASH_OFFSET` variable:

```CMake
if (DEFINED FIRMWARE_FLASH_OFFSET)
    math(EXPR FLASH_ORIGIN "${FLASH_ORIGIN} + ${FIRMWARE_FLASH_OFFSET}")
    math(EXPR FLASH_LENGTH "${FLASH_LENGTH} - ${FIRMWARE_FLASH_OFFSET}")
endif()
```

Another way to verify that our changes worked is to look at the `.map` file in our build folder:
```ld
.isr_vector     0x08001000      0x10c
 *(.isr_vector)
 .isr_vector    0x08001000      0x10c CMakeFiles/most_commented_embedded_cmakelists.elf.dir/startup_stm32f103xb.S.obj
                0x08001000                g_pfnVectors

.text           0x0800110c      0xbd4
```
In this case we used an offset of 4 Kilobytes and that is clearly reflected in the output.

In some situations, you might want to upload the entire firmware into RAM.
What you get this way is much faster firmware uploads, don't add wear to the flash and in some cases avoid the flash application image format requirements when bringing up new chips.

To get a RAM-only firmware image, we have to replace the output section to region placement everywhere `FLASH` is used.
For example, `.data` normally resides in RAM but is initialized from FLASH:
```ld
.data : ALIGN(4)
{
    _sdata = .;
    *(.data)
    *(.data*)
    _edata = ALIGN(4);
} > RAM AT > FLASH
```
For a RAM-only build, we change it to:
```ld
.data : ALIGN(4)
{
    _sdata = .;
    *(.data)
    *(.data*)
    _edata = ALIGN(4);
} > RAM
```

Since we're using the C preprocessor, we can just `#ifdef` the mapping:
```ld
.data : ALIGN(4)
{
    _sdata = .;
    *(.data)
    *(.data*)
    _edata = ALIGN(4);
#ifndef RAM_ONLY_BUILD
} > RAM AT > FLASH
#else
} > RAM
#endif
```

To get the define from the user to the linker script preprocessing, first we want to add a configuration option and conditionally define `RAM_ONLY_BUILD`.
```CMake
option(RAM_ONLY_BUILD "If set, the entire firmware is placed in RAM")
```

and then conditionally define it for the linker script preprocessing using the `BOOL` generator expression:
```CMake
add_custom_command(
    OUTPUT ${CMAKE_BINARY_DIR}/linker.ld
    COMMAND ${CMAKE_C_COMPILER}
            -E -P -x c
            # -- snip --
            $<$<BOOL:${RAM_ONLY_BUILD}>:-DRAM_ONLY_BUILD>
            ${CMAKE_SOURCE_DIR}/linker.ld.in
            > ${CMAKE_BINARY_DIR}/linker.ld
    DEPENDS ${CMAKE_SOURCE_DIR}/linker.ld.in
    COMMENT "Generating the linker script"
)
```
> **Note:** If you haven't used [generator expressions](https://cmake.org/cmake/help/latest/manual/cmake-generator-expressions.7.html) previously, what this essentially means is: if the boolean representation of the `RAM_ONLY_BUILD` value is true, add the text after `>:`, otherwise not.

Also, since non-zero initialized variables are normally copied from FLASH to RAM, we should also disable this behavior in the startup script:
```asm
#ifndef RAM_ONLY_BUILD
/* Copy the data segment initializers from flash to SRAM */
  ldr r0, =_sdata
  ldr r1, =_edata
  ldr r2, =_sidata
  movs r3, #0
  b LoopCopyDataInit

CopyDataInit:
  ldr r4, [r2, r3]
  str r4, [r0, r3]
  adds r3, r3, #4

LoopCopyDataInit:
  adds r4, r0, r3
  cmp r4, r1
  bcc CopyDataInit
#endif
```
And pass the `RAM_ONLY_BUILD` definition to the executable in CMake:
```CMake
target_compile_definitions(${EXECUTABLE} PRIVATE
    $<$<BOOL:${RAM_ONLY_BUILD}>:RAM_ONLY_BUILD>
)
```

If you try building with our new option however, you might notice that the copy loop is still there:
```asm
/* -- snip -- */
  ldr r0, =_sdata
20000238:	480c      	ldr	r0, [pc, #48]	; (2000026c <LoopFillZerobss+0x12>)
  ldr r1, =_edata
2000023a:	490d      	ldr	r1, [pc, #52]	; (20000270 <LoopFillZerobss+0x16>)
  ldr r2, =_sidata
2000023c:	4a0d      	ldr	r2, [pc, #52]	; (20000274 <LoopFillZerobss+0x1a>)
  movs r3, #0
2000023e:	2300      	movs	r3, #0
  b LoopCopyDataInit
20000240:	e002      	b.n	20000248 <LoopCopyDataInit>

20000242 <CopyDataInit>:

CopyDataInit:
  ldr r4, [r2, r3]
20000242:	58d4      	ldr	r4, [r2, r3]
/* -- snip -- */
```

This is because by default, GCC does not preprocess assembly files with the **lowercase** .s extension, which the STM32CubeMX provided startup file uses.
This goes away when we rename the file to use the `.S` extension, intended for preprocessing.
When we do this, we can see that the loop is gone:
```asm
/* -- snip -- */
20000274 <Reset_Handler>:
  cmp r4, r1
  bcc CopyDataInit
#endif

/* Zero fill the bss segment. */
  ldr r2, =_sbss
20000274:	4a07      	ldr	r2, [pc, #28]	@ (20000294 <LoopFillZerobss+0x14>)
  ldr r4, =_ebss
20000276:	4c08      	ldr	r4, [pc, #32]	@ (20000298 <LoopFillZerobss+0x18>)
/* -- snip -- */
```

With this, we can place the entire firmware into RAM with a debugger!

## Letting your imagination run wild

At this point we've built a framework using a single, configurable linker script, with the build system being a single source of truth for both the linking and source-level configuration.

From here, you can easily extend this to:
* Generate security or monitoring canaries between sections
* Conditionally add logging or RTTI sections
* Move things into tightly coupled memories conditionally
* Enforce MPU or DMA required alignment based on where they are used

or go even further and split the single linker script template into multiple sources depending on the complexity of the project.

## Real-world examples

It might come as a no surprise that we're not the first ones to think of doing this - infact, several high-profile embedded projects already use linker script generation.

* For instance, the [Zephyr RTOS](https://github.com/zephyrproject-rtos/zephyr) also generates its linker scripts from a collection of sources.
The memory regions are defined by the device tree, while the sections are defined in a multitude of linker script fragments, which can come from the SoC architecture, the concrete SoC that is being used and even third party software modules!
All of this is then processed by the C preprocessor with configuration variables originating from Zephyr's KConfig configuration system.

* Another example would be the ESP-IDF SDK from Espressif, which has a [deep and extensible](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/linker-script-generation.html) linker script generation process built with Python.
Initial reasons for linker script generation in ESP-IDF come from external flash use - where one chip can be paired with differenly sized flash and the peculiarities of the full Harvard architecture of their Xtensa-based chips however it has grown to be an useful tool for customers too.
It too uses KConfig and assembles the final linker script from fragments, some of which can come from user or third party code.

* Finally, one (at least for me) unexpected project which uses linker script processing is the [Linux kernel](https://github.com/torvalds/linux/blob/master/arch/x86/kernel/vmlinux.lds.S)!
It has a C preprocessor pass on the linker scripts and uses KConfig variables for customization.

## Closing

In this blogpost we've shown how regular linker scripts can be a limitation for complex firmware projects and built a simple framework for getting around them.

Hopefully, this gives you a taste of what's possible and turns linker scripts from something you just have to deal with to something that is a regular part of the software you are building, or helps you debug an issue when working with some of the industry-standard projects which use linker script generation in the future!
