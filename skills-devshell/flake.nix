{
  description = "agentree-statusline dev-shell skill set — an isolated sub-flake invoked at RUNTIME by the root devShell, never a root input. The skill sources (skillspkgs' claude-code-tools combination and the Python addition) live only in THIS flake's lock, so the root flake stays a leaf with zero skill inputs and transitive consumers never drag the skill mesh in.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    systems.url = "github:nix-systems/default";

    # `agent-skill-flake` is the builder library, not a skill — it provides
    # `mkDevshellSkillsFlake`.
    agent-skill-flake = {
      url = "github:nhooey/agent-skill-flake";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Every input below this divider is a skill source.

    # skillspkgs' combinations; this repository takes its family's,
    # `claude-code-tools`.
    skillspkgs-combinations = {
      url = "github:nhooey/skillspkgs?dir=sources/combinations";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Python style, for the scripts under tools/: Python is a language the
    # rest of the Claude Code tools family doesn't use.
    python-skills = {
      url = "github:nhooey/python-skills";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      nixpkgs,
      agent-skill-flake,
      ...
    }@inputs:
    agent-skill-flake.lib.mkDevshellSkillsFlake {
      inherit nixpkgs;
      systems = import inputs.systems;
      name = "agentree-statusline-skills";
      sources = [
        { source = inputs.skillspkgs-combinations.combinations.claude-code-tools; }
        {
          source = inputs.python-skills;
          skills = [ "python-hygiene-functional-style" ];
        }
      ];
    };
}
