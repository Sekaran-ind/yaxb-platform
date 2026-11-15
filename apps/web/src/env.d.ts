/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_SURFACE?: string;
  readonly VITE_NATIVE?: string;
  readonly VITE_API_BASE?: string;
  /** The Yaxb.ai portal's links to its platforms (SUR-7..9). */
  readonly VITE_FAMILY_URL?: string;
  readonly VITE_BUSINESS_URL?: string;
  readonly VITE_ENTERPRISE_URL?: string;
}
