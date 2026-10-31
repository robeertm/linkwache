// Single source of truth for the running version: package.json (shipped in the image next to src/).
import pkg from "../package.json" with { type: "json" };
export const VERSION = pkg.version;
