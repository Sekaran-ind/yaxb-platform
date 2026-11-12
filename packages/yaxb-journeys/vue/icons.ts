// Icons are the host's: YAML names an icon ("clipboard-list"), and the host maps names to its own
// components with provideIcons(). Without one, no icons are drawn (the labels carry the meaning).
import { inject, provide, type Component, type InjectionKey } from "vue";

export type IconResolver = (name?: string) => Component | null;

export const ICONS_KEY: InjectionKey<IconResolver> = Symbol("yaxb-journeys.icons");

const none: IconResolver = () => null;

/** Call in a parent's setup: components below draw YAML icon names with this resolver. */
export function provideIcons(resolve: IconResolver) {
  provide(ICONS_KEY, resolve);
}

export function useIcons(): IconResolver {
  return inject(ICONS_KEY, none);
}
