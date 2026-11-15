// Which surface this build is (SUR-1..6): `vite build --mode family` or `--mode business` sets
// VITE_SURFACE (the plain build is "all", the combined site). What a surface offers is the core's
// call (yaxb-core context), shared with the Worker.
import { offers as contextOffers, resolveContext, surfaceName, type Feature } from "@sekaran-ind/yaxb-core/context";

export const CONTEXT = resolveContext({ surface: import.meta.env.VITE_SURFACE ?? "all" });
export const SURFACE = CONTEXT.surface;
/** Whether this build offers a feature (the catalogue, requests, staff, the child lock…). */
export const offers = (f: Feature) => contextOffers(CONTEXT, f);
export const SURFACE_NAME = surfaceName(CONTEXT);
