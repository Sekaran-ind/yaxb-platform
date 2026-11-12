import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";
// Applies the saved theme before the first paint.
import "./composables/settings";

createApp(App).use(router).mount("#app");
