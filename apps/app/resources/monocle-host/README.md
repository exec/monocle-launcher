# Bundled Monocle host · 0.7.30

Built from the Monocle Client host-service and coordinator-core projects. The launcher runs the existing Java entry point, not a Rust workflow engine. Java 25 is required; no Minecraft account or Lua installation is needed for the host.

Source: https://github.com/exec/monocle-client. `source.tar.gz` contains the local corresponding source, Gradle wrapper/build files, resources and notices for this development snapshot. It excludes build output and private incident notes. Public releases must continue providing the exact source and dependency notices for their bundled runtime, not merely an upstream version tag.

Keep LICENSE and licenses/ alongside lib/. Dependency license information is also embedded in the upstream JARs. Refresh this directory from an extracted `:host-service:distZip` distribution when updating the host, and update the pinned runtime filename in src/bots.rs.
