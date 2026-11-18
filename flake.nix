{
  description = "Your Claude Code session and its subagents as a live tree above the prompt, with cost, plan usage and timing.";

  inputs = {
    # Rolling, for a current Node: the mod's tests run TypeScript straight
    # through `node --test`, and its TypeScript 7 wants a recent runtime.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts = {
      url = "github:hercules-ci/flake-parts";
      inputs.nixpkgs-lib.follows = "nixpkgs";
    };
    systems.url = "github:nix-systems/default";
    # The dev-shell skills wiring (flakeModules.devshellSkills), which
    # bundles numtide/devshell.  The skill sources are not inputs here: they
    # live only in skills-devshell/'s lock, which the dev shell runs on
    # entry, so this flake stays a leaf with no skill inputs.
    agent-skill-flake = {
      url = "github:nhooey/agent-skill-flake";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      nixpkgs,
      flake-parts,
      systems,
      ...
    }@inputs:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = import systems;
      imports = [
        # Bundles numtide/devshell, the skills startup that installs
        # skills-devshell/'s skills into .claude/skills, and the check, fmt,
        # update-flake, reap-skills and update-skills-devshell commands.
        inputs.agent-skill-flake.flakeModules.devshellSkills
        inputs.treefmt-nix.flakeModule
      ];

      agent-skill-flake.devshellSkills = {
        name = "agentree";
        motd = ''
          {bold}{14}📊 Entering the agentree dev shell{reset}
          Run {bold}menu{reset} to list available commands.
        '';
      };

      perSystem =
        { pkgs, ... }:
        let
          # The one Node: the mod's node_modules are built with it, and the
          # dev shell runs it.
          nodejs = pkgs.nodejs_26;

          # mod/'s npm dependencies (TypeScript, Node's types), each fetched
          # by the integrity hash its package-lock.json records: no
          # `npm ci`, and no hash to keep beside the lock.  Built from the
          # two files alone, so an edit elsewhere in mod/ rebuilds nothing.
          modNodeModules = pkgs.importNpmLock.buildNodeModules {
            package = builtins.fromJSON (builtins.readFile ./mod/package.json);
            packageLock = builtins.fromJSON (builtins.readFile ./mod/package-lock.json);
            inherit nodejs;
          };
        in
        {
          # Repo-specific packages and commands, merged onto the module's.
          devshells.default = {
            packages = [
              nodejs
              pkgs.git
              # For the scripts under tools/: usage-dev and the fixture and
              # palette reviews.
              pkgs.python3
            ];
            env = [
              {
                name = "MOD_NODE_MODULES";
                value = "${modNodeModules}/node_modules";
              }
            ];
            devshell.startup.link-node-modules.text = builtins.readFile ./nix/link-node-modules.sh;
            # One tool, tools/usage-dev.py, holds the repository's commands
            # (`usage-dev --list`); the menu adds the two run most.
            commands = [
              # dev
              {
                category = "dev";
                name = "usage-dev";
                help = "test, generate, draw and update: usage-dev --list names each command";
                command = ''python3 "$PRJ_ROOT/tools/usage-dev.py" "$@"'';
              }

              # test
              {
                category = "test";
                name = "tests";
                help = "run every suite, or the ones named; --repeat N to catch a flake (usage-dev test)";
                command = ''python3 "$PRJ_ROOT/tools/usage-dev.py" test "$@"'';
              }
              {
                category = "test";
                name = "typecheck";
                help = "type-check the mod (usage-dev typecheck)";
                command = ''python3 "$PRJ_ROOT/tools/usage-dev.py" typecheck "$@"'';
              }
            ];
          };

          # Every suite tests/all.sh runs that a build can (nix/check-tests.sh
          # names those left out), with the fixture generators checked too.
          checks.tests =
            pkgs.runCommand "agentree-tests"
              {
                nativeBuildInputs = [
                  nodejs
                  pkgs.git
                  pkgs.python3
                ];
                src = ./.;
                modNodeModules = "${modNodeModules}/node_modules";
              }
              ''
                bash ${./nix/check-tests.sh}
                touch $out
              '';

          treefmt = {
            projectRootFile = "flake.nix";
            programs.nixfmt.enable = true;
          };
        };
    };
}
