import { createRouter, createWebHashHistory, createWebHistory, type RouteRecordRaw } from "vue-router";
import { NATIVE } from "./lib/platform";

// Pages load on demand, so the home page doesn't download the kiosk (or its models' code).
// The native app (PLT-10) opens straight into the kiosk: its only pages are the kiosk and Settings.
const NATIVE_ROUTES: RouteRecordRaw[] = [
  { path: "/", redirect: "/kiosk" },
  { path: "/kiosk", component: () => import("./pages/KioskPage.vue"), meta: { title: "AI Kiosk" } },
  { path: "/settings", redirect: (to) => ({ path: "/kiosk", query: { prefs: typeof to.query.section === "string" ? to.query.section : "profile" } }) },
  { path: "/:rest(.*)*", redirect: "/kiosk" },
];

/** An old staff page's address, as that staff section inside the kiosk's Services. */
const staff = (section: string) => (to: { query: Record<string, unknown> }) => ({ path: "/kiosk", query: { ...(to.query as Record<string, string>), screen: "services", staff: section } });

export const router = createRouter({
  // The app's pages are files on the device: hash URLs need no server.
  history: NATIVE ? createWebHashHistory() : createWebHistory(),
  routes: NATIVE ? NATIVE_ROUTES : [
    { path: "/", component: () => import("./pages/HomePage.vue"), meta: { title: "Meet YAXB" } },
    { path: "/kiosk", component: () => import("./pages/KioskPage.vue"), meta: { title: "AI Kiosk" } },
    // The staff pages live inside the kiosk (Services → For staff); their old addresses open the section.
    { path: "/kiosk/curate", redirect: staff("moderation") },
    { path: "/kiosk/review", redirect: staff("review") },
    { path: "/kiosk/quality", redirect: staff("quality") },
    { path: "/kiosk/team", redirect: staff("team") },
    { path: "/kiosk/moderator", redirect: staff("profile") },
    { path: "/kiosk/admin", redirect: staff("admin") },
    // Preferences open inside the kiosk (KioskPreferences); old links and commands still land there.
    { path: "/settings", redirect: (to) => ({ path: "/kiosk", query: { prefs: typeof to.query.section === "string" ? to.query.section : "profile" } }) },
    // The Service Catalogue (LIB-14): anyone designs services (journeys, screens, roles); reviewers publish them for kiosks.
    { path: "/catalogue", component: () => import("./pages/CataloguePage.vue"), meta: { title: "Service catalogue" } },
    { path: "/studio", redirect: "/catalogue" },
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
