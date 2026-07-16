{
  description = "A very basic flake";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      forAllSystems =
        function:
        (nixpkgs.lib.genAttrs [
          "aarch64-darwin"
          "aarch64-linux"
          "x86_64-darwin"
          "x86_64-linux"
        ])
          (
            system:
            function (
              import nixpkgs {
                inherit system;
              }
            )
          );
    in
    {
      packages = forAllSystems (pkgs: {
        barnguard-web = pkgs.buildNpmPackage {
          pname = "barnguard-web";
          version = "0.0.1";

          src = ./web;

          npmDepsFetcherVersion = 2;
          npmDepsHash = "sha256-4dn9BEMycdCyWD5xCeMaA/IVBU4gA3GD9hJFfuClQSg=";
        };

        barnguard-server = pkgs.rustPlatform.buildRustPackage (
          finalAttrs:
          let
            webBundle =
              self.packages.${pkgs.stdenv.system}.barnguard-web + "/lib/node_modules/barnguard-web/dist";
          in
          {
            pname = "barnguard-server";
            version = "0.1.0";

            src = ./.;

            postPatch = ''
              substituteInPlace "crates/server/src/web.rs" \
                --replace-fail '"../../web/dist"' '"${webBundle}"'
            '';

            cargoLock = {
              lockFile = ./Cargo.lock;
            };

            buildFeatures = [ "embed-web" ];

            meta = {
              mainProgram = finalAttrs.pname;
            };
          }
        );
      });

      nixosModules.barnguard =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.services.barnguard;
          settingsFormat = pkgs.formats.toml { };
          configFile = settingsFormat.generate "config.toml" cfg.settings;
        in
        {
          options.services.barnguard = {
            enable = lib.mkEnableOption "barnguard printer daemon and web server";

            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.stdenv.system}.barnguard-server;
              description = "The barnguard-server package to run.";
            };

            dataDir = lib.mkOption {
              type = lib.types.path;
              default = "/var/lib/barnguard";
              description = "Directory for persisted state (state.json, games.json).";
            };

            settings = lib.mkOption {
              type = settingsFormat.type;
              default = { };
              description = "barnguard-server configuration, written to config.toml.";
            };
          };

          config = lib.mkIf cfg.enable {
            systemd.services.barnguard = {
              description = "barnguard printer daemon and web server";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" ];

              serviceConfig = {
                ExecStart = "${lib.getExe cfg.package} --config ${configFile} --data-dir ${cfg.dataDir}";
                DynamicUser = true;
                StateDirectory = "barnguard";
                Restart = "on-failure";
              };
            };
          };
        };
    };
}
