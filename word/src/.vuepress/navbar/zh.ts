import { navbar } from "vuepress-theme-hope";

export const zhNavbar = navbar([
  "/",
  {
    text: "使用指南",
    icon: "lightbulb",
    prefix: "/guide/",
    children: [
      { text: "快速开始", link: "quick-start" },
      { text: "使用指南", link: "usage-guide" },
      { text: "模板管理", link: "template-management" },
    ],
  },
  {
    text: "开发文档",
    icon: "code",
    prefix: "/dev/",
    children: [
      { text: "技术架构", link: "architecture" },
    ],
  },
  {
    text: "错误码",
    icon: "error",
    link: "/error-codes",
  },
  {
    text: "鸣谢",
    icon: "heart",
    link: "/acknowledgements",
  },
]);
