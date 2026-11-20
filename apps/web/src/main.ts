import { GEO_KEY, ICONS_KEY, MEDIA_KEY } from "@sekaran-ind/yaxb-journeys/vue";
import { geoHost } from "@/composables/geo";
import { mediaHost } from "@/composables/media";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createApp } from "vue";
import { iconFor } from "./lib/icons";
import { queryClient } from "./lib/queries";
import { installNativeFetch } from "./lib/platform";
import App from "./App.vue";
import { router } from "./router";
// The yaxb-journeys components (the adaptive nav, the designer, confirmations) everywhere; the site's
// styles come after, and map the package's tokens to the theme.
import "@sekaran-ind/yaxb-journeys/style.css";
import "./styles.css";
// Applies the saved theme before the first paint.
import "./composables/settings";

// The native app sends /api calls to the kiosk server (lib/platform.ts).
installNativeFetch();
// The yaxb-journeys components draw YAML icon names with the site's icons.
// Photo fields keep their photos on this device and the box (MED-1), read on the device (MED-5).
// Place and area fields search through the Worker and never locate the device under the child lock (VIS-8).
createApp(App).provide(ICONS_KEY, iconFor).provide(MEDIA_KEY, mediaHost).provide(GEO_KEY, geoHost).use(router).use(VueQueryPlugin, { queryClient }).mount("#app");
