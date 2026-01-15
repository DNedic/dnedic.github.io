let
  pkgs = import (builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/398b16e16cc688d8ffcf820d1ec50a55da44a108.tar.gz";
  }) {};

in pkgs.mkShell {
  packages = [
    pkgs.zola
    pkgs.git
  ];
}
