// Bundled stand-in for `require("util")` in CommonJS dependencies (deepagents → micromatch): the
// bundler can't leave a runtime require in the Worker, so this re-exports workerd's node:util.
import * as util from "node:util";
export * from "node:util";
export default util;
