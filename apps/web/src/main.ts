import { createApp } from "vue";
import { installNativeFetch } from "./lib/platform";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";
// Applies the saved theme before the first paint.
import "./composables/settings";

// The native app sends /api calls to the kiosk server (lib/platform.ts).
installNativeFetch();
createApp(App).use(router).mount("#app");
