import { ICONS_KEY } from "@sekaran-ind/yaxb-journeys/vue";
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
createApp(App).provide(ICONS_KEY, iconFor).use(router).mount("#app");
