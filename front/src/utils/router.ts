import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: "/",
            component: () => import("../views/Main.vue"),
        },
        {
            path: "/setting",
            component: () => import("../views/SettingView.vue"),
            meta: {
                requiresConfigRefresh: true
            }
        },
        {
            path: "/about",
            component: () => import("../views/AboutView.vue")
        },
        {
            path: "/error",
            component: () => import("../views/ErrorView.vue")
        },
        {
            path: "/galaxy",
            component: () => import("../views/GalaxyView.vue")
        },
        {
            path: "/deearth",
            component: () => import("../views/DeEarthView.vue")
        },
        {
            path: "/template",
            component: () => import("../views/TemplateView.vue")
        },
        {
            path: "/download",
            component: () => import("../views/DownloadView.vue")
        },
        {
            path: "/server",
            component: () => import("../views/ServerView.vue")
        },
        {
            path: "/plugins",
            component: () => import("../views/PluginsView.vue")
        },
        {
            path: "/plugin/:id",
            component: () => import("../views/PluginDetailView.vue")
        },
        {
            path: "/plugin-page/:pluginId/:pageKey",
            component: () => import("../views/PluginPageView.vue")
        }
    ]
})

export default router