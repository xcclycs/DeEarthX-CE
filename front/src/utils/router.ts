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
            path: "/guardian",
            component: () => import("../views/GuardianView.vue")
        }
    ]
})

export default router