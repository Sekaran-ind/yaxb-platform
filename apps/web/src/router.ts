import { createRouter, createWebHistory } from "vue-router";

// Pages load on demand, so the home page doesn't download the kiosk (or its models' code).
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: () => import("./pages/HomePage.vue"), meta: { title: "Meet YAXB" } },
    { path: "/kiosk", component: () => import("./pages/KioskPage.vue"), meta: { title: "AI Kiosk" } },
    { path: "/kiosk/curate", component: () => import("./pages/CuratePage.vue"), meta: { title: "Curate" } },
    { path: "/settings", component: () => import("./pages/SettingsPage.vue"), meta: { title: "Settings" } },
    { path: "/contact", component: () => import("./pages/ContactPage.vue"), meta: { title: "Contact" } },
    { path: "/faq", component: () => import("./pages/FaqPage.vue"), meta: { title: "FAQ" } },
    { path: "/terms-conditions", component: () => import("./pages/TermsPage.vue"), meta: { title: "Terms & Privacy" } },
    // The portal's about page only held placeholder copy; the real content is on the home page.
    { path: "/about-us", redirect: { path: "/", hash: "#about" } },
    { path: "/yaxb", redirect: "/kiosk" },
    { path: "/:rest(.*)*", component: () => import("./pages/NotFoundPage.vue"), meta: { title: "Page not found" } },
  ],
  scrollBehavior(to, _from, saved) {
    if (saved) return saved;
    if (to.hash) return { el: to.hash, behavior: "smooth" };
    return { top: 0 };
  },
});

router.afterEach((to) => {
  const title = to.meta.title as string | undefined;
  document.title = !title || title === "Meet YAXB" ? "Meet YAXB" : `${title} | YAXB`;
});
