// Bundled stand-in for `require("path")` in CommonJS dependencies (deepagents → picomatch): the
// bundler can't leave a runtime require in the Worker, so this re-exports workerd's node:path.
import * as path from "node:path";
export * from "node:path";
export default path;
