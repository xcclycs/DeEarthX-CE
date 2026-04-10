import { defineUserConfig } from "vuepress";

import theme from "./theme.js";

export default defineUserConfig({
  base: "/",

  locales: {
    "/": {
      lang: "zh-CN",
      title: "DeEarthX-CE 文档",
      description: "DeEarthX-CE 软件文档",
    },
  },

  theme,

  // Enable it with pwa
  // shouldPrefetch: false,
});
