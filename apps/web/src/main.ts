import { ICONS_KEY, MEDIA_KEY } from "@sekaran-ind/yaxb-journeys/vue";
import { mediaHost } from "@/composables/media";
import { createApp } from "vue";
import { iconFor } from "./lib/icons";
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
createApp(App).provide(ICONS_KEY, iconFor).provide(MEDIA_KEY, mediaHost).use(router).mount("#app");
