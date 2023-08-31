+++
title = "Using nix-shell to create and share reproducible embedded development environments"
[taxonomies]
tags = [ "Nix", "Embedded", "Docker", "CMake", "STM32", "ESP-IDF", "Rust" ]
+++

Historically, working on embedded software meant using proprietary manufacturer-provided IDEs with tools like the toolchain, build system and debugger all integrated.
As open source tooling eventually caught up and even surpassed closed source solutions in many regards we often no longer have to rely on closed solutions and can adopt traditional software development tools and practices.

Unfortunately, this means that our development environment suddenly relies on a number of tools that have to work together and be correctly set up on every developer's system.
Keeping track of this can be a time-consuming process and issues can arise, including implicit tool dependencies and incompatibilities from tool version mismatches.

In this post we will leverage the [Nix](https://nixos.org/) package manager to create a shareable and reproducible development environment, take a look at advantages it offers over existing solutions and by the end of the post, you should be able to quickly spin up a development environment, share it in the form of a single text file and be sure everyone using it will have the same exact setup.

[TOC]

## Our example project
In [the previous blogpost](/blog/the-most-thoroughly-commented-embedded-cmakelists/), we explored setting up a [simple CMake project](https://github.com/DNedic/most_commented_embedded_cmakelists) for an STM32 microcontroller using open source tooling.
To build the project, we need a few tools:
* The [ARM Embedded GCC toolchain](https://developer.arm.com/downloads/-/arm-gnu-toolchain-downloads) to compile and link the sources as well as bundle the standard library
* `CMake` to generate our build system
* `Make` or `Ninja` to run the generated build system

Additionally, if we want to have a usable development environment, we need `git` for version control and `openocd` or another GDB server implementation for embedded in order to debug our firmware.

## Challenges of manual tool management
There are a couple of ways to manually obtain the necessary tools for building the project, let's go through some of them.
### The system package manager
One thing we could do is use our system's package repositories, for instance on Arch Linux we would do:
```
# pacman -Syu cmake make git arm-none-eabi-gcc arm-none-eabi-binutils arm-none-eabi-newlib openocd
```
This is quite convenient as it only involves a single command and has ensured compatibility with our system.
There are however quite a few hidden downsides with this approach:
* Different developers working on the same project could be using different systems, leading to mismatches in tool versions
* Developers could be updating their system at different times
* The tools we need could be missing from our systems repositories

### Obtaining binary releases
Alternatively, we could obtain binary releases of these tools. There is a bit more work involved with this approach, as we have to manually find, unpack and add all of these tools to our `PATH`. This process can quickly become time consuming with the number of machines we have to perform the procedure on. We could forget to update one and have the same exact version mismatch issues. Additionally, we no longer have ensured compatibility with the systems the developers are using due to fixed dependencies on python versions, glibc versions or system folder structure expectations.

### Third party repositories
Finally, we can use third party repositories, like [xPack](https://xpack.github.io/)'s `xpm`. This approach combines the benefits of the first two approaches, as we can still use a single command to install all of the tools and packagers try their best to ensure compatibility with all systems. We can observe however that some critical issues do not go away, like someone forgetting to update their packages.

### Universal problems
On top of issues specific to one of these approaches, the manual approach to tool management requires meticulous checking for compatibility between tools themselves and their various versions working together, which can be a very time consuming process.

To sum everything up, our development enviroments are not **self-contained**, **reproducible** or **managed**.

## Docker
The most popular tool to deal with these issues at the moment is [Docker](https://www.docker.com/).
Docker is a container runtime, created to run lightweight isolated environments in some ways akin to virtual machines on top of our system.
What this means for us is that we can create images which will hold all of our tools and can be used to build and debug our project.

### Building and using images
Let's take a look at a minimal image recipe required to build our project in the form of a `Dockerfile`:

```Dockerfile
# Choose a base image
FROM ubuntu:23.04

# Refresh the package index
RUN apt-get -qq update

# Get the required packages
RUN apt-get -y install cmake \
                       make \
                       git \
                       gcc-arm-none-eabi \
                       binutils-arm-none-eabi \
                       libnewlib-arm-none-eabi

# Specify the working directory inside the container
WORKDIR /usr/project
```

To build our image and give it a name, we can run:
```
$ docker build -t most_commented_embedded_cmakelists .
```

And to enter an interactive shell inside the container built from our image, we can use this command:
```
$ docker run -v $(pwd):/usr/project -it most_commented_embedded_cmakelists
```

Where the `-v` argument maps our current working directory to the containers `/usr/project` directory and `-it` runs the container in the interactive mode.

In order to be able to debug our project, we have to add `openocd` and any debugger drivers to the list of packages:

```Dockerfile
RUN apt-get -y install openocd libusb-1.0-0
```

then pass all usb devices through to the container every time we run it:

```
$ docker run -v $(pwd):/usr/project -v /dev/bus/usb:/dev/bus/usb --privileged -it most_commented_embedded_cmakelists
```

### Disadvantages of Docker
Those observant enough have probably noticed a few downsides of this approach along the way.

One major issue is that Docker images are not reproducible - the `apt-get` command in the `Dockerfile` gets the latest versions of the packages from the chosen base image repositories.
This means that any time we run it, we may get different versions of packages.
To combat this, we have to share images themselves, which can be rather large - the minimal image required to build our project alone is `2.9GB`.
As an individual, we can upload these to [Dockerhub](https://hub.docker.com/) with an account, however businesses will have to pay a subscription for hosting these.

Another issue is that we don't have access to our system's shell - our aliases, shell settings and more are not available to us in Docker images.

Finally, it's easy to see that Docker commands can get very unwieldy due to the number of things we have to pass through to the container.

## Enter Nix
The Nix package manager released over 20 years ago but has recently caught the programming community spotlight with its ability to solve the dependency hell issues, work together with [NixOS](https://nixos.org/) to create reproducible Linux machines as well as create reproducible development environments.

### nix-shell
For this blogpost, we will be utilizing the [nix-shell](https://nixos.org/manual/nix/stable/command-ref/nix-shell.html) command provided by the Nix package manager.
Using nix-shell, you can:
1. Create temporary environments for development, experimentation, or debugging without affecting your main system.
2. Share these environments with others in the form of a simple text file, ensuring everyone is on the same page.

A `nix-shell` environment is usually defined with a `shell.nix` or a `default.nix` file containing a Nix language expression.
Here's a basic example of what a `shell.nix` file might look like for our embedded project:
```nix
let pkgs = import <nixpkgs> {};

in pkgs.mkShell {
  packages = [
    pkgs.gcc-arm-embedded
    pkgs.cmake
    pkgs.gnumake
    pkgs.git
    pkgs.openocd
  ];
}
```

By running `nix-shell` inside our project directory, the Nix package manager will download specified packages from the Nix repositories along with their dependencies and place them in `/nix/store` and then export the executables of these packages to our shells `PATH`.

We can easily check this by running `which` on one of our tools:
```
$ which arm-none-eabi-gcc
/nix/store/im3iiikm684j0dn166k78japxlknsrki-gcc-arm-embedded-12.2.rel1/bin/arm-none-eabi-gcc
```

We can also run `nix-shell` with the `--pure` argument in order to verify that all of our tools are present and that building or debugging the project isn't using our system's tools by accident.
This removes almost everything from our PATH before evaluating `nix-shell`.

Additionally, if we want to execute any commands in the shell on entry, we can use the `shellHook` argument of `mkShell`:

```nix
pkgs.mkShell {
  # --snip--
  shellHook = "echo \"Hello from our shell\"";
}
```
This can be useful if we want to start a server to talk to our device or automatically build the project upon entry.

### Version pinning
With this configuration, package versions can change every time we run `nix-shell` depending on the package versions in the `nixpkgs` collection however.
To get true reproducibility, we have to somehow specify the package versions.

Usually, this is done by pinning `nixpkgs` to a specific point in time.
This can be done in one of the following ways:
* By using `builtins.fetchTarball` and specifying the `nixpkgs` tarball
```nix
let pkgs = import (builtins.fetchTarball {
  url = "https://github.com/NixOS/nixpkgs/archive/976fa3369d722e76f37c77493d99829540d43845.tar.gz";
}) {};
```
* By using `builtins.fetchGit` and specifying a git revision
```nix
let pkgs = import (builtins.fetchGit {
  url = "https://github.com/nixos/nixpkgs/";
  ref = "refs/heads/nixos-unstable";
  rev = "976fa3369d722e76f37c77493d99829540d43845";
}) {};
```

While Nix itself does not provide an easy way to obtain these arguments based on the package versions we need the [nix-versions](https://lazamar.co.uk/nix-versions/) website can be used to obtain them and even generate code blocks shown above.

> **Note:** It is possible that `mkShell` will fail when going too far back in time with `nixpkgs` versions. This is because `mkShell` was introduced in 2018 as a convenience wrapper around `stdenv.mkDerivation` for `nix-shell` purposes. Here is how we would achieve the same result using `stdenv.mkDerivation`:
> ```nix
> pkgs.stdenv.mkDerivation {
>   name = "my-shell";
>   buildInputs = [
>     pkgs.gcc-arm-embedded
>     pkgs.cmake
>     pkgs.gnumake
>     pkgs.git
>     pkgs.openocd
>   ];
> }
> ```

If however the nixpkgs revision for one package does not provide the desired version of another package, it is possible to import multiple `nixpkgs` revisions like so:

```nix
let
  pkgs = import (builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/976fa3369d722e76f37c77493d99829540d43845.tar.gz";
  }) {};
  pkgs_arm_gcc = import (builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/b0f0b5c6c021ebafbd322899aa9a54b87d75a313.tar.gz";
  }) {};


in pkgs.mkShell {
  packages = [
    pkgs_arm_gcc.gcc-arm-embedded
    pkgs.cmake
    pkgs.gnumake
    pkgs.git
    pkgs.openocd
  ];
}
```

With this, we have a fully reproducible and managed embedded development environment!
This means that we can **treat our development environment as code** and anyone pulling our repository can instantly obtain the same environment we had when developing or deploying the project.

### Using overlays
Our example project so far required a relatively small number of tools compared to some manufacturer SDKs which can bundle a large number of tools and dependencies.
An example of such an SDK would be [ESP-IDF](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/get-started/) from Espressif, which has a host of toolchains, python tools and dependencies.
In situations like this, we may not want to manually specify our development environment, but instead rely on manufacturer or community maintained solutions and build on top of them.

[nixpkgs-esp-dev](https://github.com/mirrexagon/nixpkgs-esp-dev) offers such a solution for ESP-IDF, and looking at the code you will quickly realize the futility of maintaining such a solution yourself.
To demonstrate the power of `nixpkgs-esp-dev` we will use the [esp-usb-bridge](https://github.com/espressif/esp-usb-bridge) project as an example.
`esp-usb-bridge` lets you create your own programmer and `JTAG` probe with an `ESP32-S2` or `ESP32-S3` based board.

After pulling the project, we can create a `shell.nix` file according to the `nixpkgs-esp-dev` instructions and pin the ESP-IDF version:

```nix
let
  nixpkgs-esp-dev = builtins.fetchGit {
    url = "https://github.com/mirrexagon/nixpkgs-esp-dev.git";
    rev = "4cc9ec3f8e992ed15924672192a2ce5fb0223121";
  };

  pkgs = import <nixpkgs> {
    overlays = [ (import "${nixpkgs-esp-dev}/overlay.nix") ];
  };

in pkgs.mkShell {
  packages = [
    pkgs.esp-idf-full
  ];
}
```

From this point, we can build, flash and debug the project and continue expanding our new development environment with any new requirements we have by extending the `shell.nix` file.

Another such example is the [rust-overlay](https://github.com/oxalica/rust-overlay) which lets you manage rust channels and architectures easily.

These examples show us an important aspect of Nix - composability, we can import another `.nix` file and use it as an expression.
The `overlay` argument lets us customize the `nixpkgs` collection by overriding packages or introducing new ones.
There are many community maintained overlays, which can also be combined to save you the effort of maintaining huge environments.

### Third party tools
Finally, there are quite a few projects built on top of `nix-shell` that offer user convenience.

* [lorri](https://github.com/nix-community/lorri) for instance offers automatic `nix-shell` invocation upon entering a project's directory providing seamless development, enables downloading newer package versions while in the shell itself and gives you tools to prevent the Nix garbage collector from sweeping away your `nix-shell` obtained tools when invoked.

* Another useful third party tool is [devbox](https://www.jetpack.io/devbox) which offers a convenient wrapper around `nix-shell` and lets you forego the Nix language entirely, specifying your development environment in JSON. It also makes package pinning much more elegant and has a plugin system.

* For those using VSCode, [Nix Environment Selector](https://marketplace.visualstudio.com/items?itemName=arrterian.nix-env-selector) provides an elegant way to run your entire VSCode instance in the `nix-shell` environment.

## Closing

In this blogpost we covered some of the biggest challenges encountered by developers when switching to open tooling development environments, explored state of the art solutions and where they falter and then introduced `nix-shell` as a viable alternative.

At this point you should be ready to give `nix-shell` a shot the next time you're required to manage an embedded development environment and save yourself and your team from the pains of manual tool management.

For further reading you might be interested in reading about [providing reproducible firmware builds](https://interrupt.memfault.com/blog/reproducible-firmware-builds) for your customers or partners, which Nix takes you a long way to or exploring [Nix flakes](https://www.tweag.io/blog/2020-05-25-flakes/) as a newer, experimental way to achieve the same goals.
