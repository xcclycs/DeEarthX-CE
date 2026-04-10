import { sidebar } from "vuepress-theme-hope";

export const zhSidebar = sidebar({
  "/": [
    "",
    {
      text: "使用指南",
      icon: "lightbulb",
      prefix: "guide/",
      children: [
        "quick-start",
        "usage-guide",
        "template-management",
      ],
    },
    {
      text: "开发文档",
      icon: "code",
      prefix: "dev/",
      children: [
        "architecture",
      ],
    },
    "error-codes",
    "acknowledgements",
  ],
});
