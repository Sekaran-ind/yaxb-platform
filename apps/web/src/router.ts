import { createRouter, createWebHashHistory, createWebHistory, type RouteRecordRaw } from "vue-router";
import { NATIVE } from "./lib/platform";

// Pages load on demand, so the home page doesn't download the kiosk (or its models' code).
// The native app (PLT-10) opens straight into the kiosk: its only pages are the kiosk and Settings.
const NATIVE_ROUTES: RouteRecordRaw[] = [
  { path: "/", redirect: "/kiosk" },
  { path: "/kiosk", component: () => import("./pages/KioskPage.vue"), meta: { title: "AI Kiosk" } },
  { path: "/settings", component: () => import("./pages/SettingsPage.vue"), meta: { title: "Settings" } },
  { path: "/:rest(.*)*", redirect: "/kiosk" },
];

export const router = createRouter({
  // The app's pages are files on the device: hash URLs need no server.
  history: NATIVE ? createWebHashHistory() : createWebHistory(),
  routes: NATIVE ? NATIVE_ROUTES : [
    { path: "/", component: () => import("./pages/HomePage.vue"), meta: { title: "Meet YAXB" } },
    { path: "/kiosk", component: () => import("./pages/KioskPage.vue"), meta: { title: "AI Kiosk" } },
    { path: "/kiosk/curate", component: () => import("./pages/CuratePage.vue"), meta: { title: "Curate" } },
    { path: "/kiosk/review", component: () => import("./pages/ReviewPage.vue"), meta: { title: "Review answers" } },
    { path: "/kiosk/quality", component: () => import("./pages/QualityPage.vue"), meta: { title: "Answer quality" } },
    { path: "/kiosk/moderator", component: () => import("./pages/ModeratorPage.vue"), meta: { title: "Moderator profile" } },
    { path: "/kiosk/admin", component: () => import("./pages/AdminPage.vue"), meta: { title: "Administration" } },
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
  document.title = NATIVE ? "YAXB Kiosk" : !title || title === "Meet YAXB" ? "Meet YAXB" : `${title} | YAXB`;
});
