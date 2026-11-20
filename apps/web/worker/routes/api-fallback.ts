// Routes: api-fallback. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { jsonError } from "../http";

app.all("/api/*", (c) => jsonError(c, 404, "Not found"));
