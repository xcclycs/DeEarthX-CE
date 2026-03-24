# 项目介绍

## 项目背景

DeEarthX-CE 是由 XCC 团队开发的 Minecraft 整合包服务端制作工具，旨在解决 Minecraft 服务器管理员在将客户端整合包转换为服务端时遇到的各种问题。随着 Minecraft 模组生态的不断发展，整合包的规模和复杂度持续增长，手动筛选模组和配置服务端变得越来越繁琐。DeEarthX-CE 的诞生正是为了简化这一过程，让服务器管理员能够更加专注于服务器的运营和管理。

## 什么是 DeEarthX-CE？

DeEarthX-CE 是一个功能强大的 Minecraft 整合包服务端制作工具，旨在简化客户端整合包到服务端的转换过程，同时提供模组管理和模板系统功能。本文档详细介绍了 DeEarthX-CE 项目的核心功能、技术实现、使用方法和贡献指南，为用户和开发者提供全面的参考资料。

## 核心功能

- **整合包支持**：支持 CurseForge、Modrinth、MCBBS 等多个平台的整合包
- **智能模组处理**：自动区分客户端和服务端模组，保留服务端需要的，剔除客户端专用的（光影、材质包等）
- **双工作模式**：
  - 开服模式：下载服务端和模组加载器，完整生成服务端
  - 上传模式：只做模组筛选，不下载服务端文件
- **多模组加载器支持**：支持 Forge、NeoForge、Fabric
- **版本兼容**：支持 Minecraft 1.16.5 到最新版本
- **模板管理**：
  - 创建、编辑、删除本地模板
  - 导入/导出模板
  - 模板商店，支持从远程下载模板
  - 智能下载速度测试，选择最快的下载链接
- **多语言支持**：内置多种语言支持，满足不同地区用户的需求
- **用户友好界面**：直观的图形界面，降低使用门槛

## 技术架构

DeEarthX-CE 采用前后端分离架构：

- **后端**：使用 TypeScript + Node.js 开发，Express 提供 Web 服务，WebSocket 实时通信，使用 Node.js SEA 打包为独立 exe
- **前端**：使用 Vue 3 + TypeScript 开发，Tauri 2 桌面框架，Ant Design Vue UI 组件，Tailwind CSS 样式

## 适用场景

- 服务器管理员快速将客户端整合包转换为服务端
- 模组开发者测试不同版本的模组兼容性
- 模组包制作者创建和分享模组包
- 普通玩家管理个人模组集合和模板

## 项目状态

DeEarthX-CE 目前处于积极开发阶段，欢迎社区贡献和反馈。项目仓库地址：[https://git.xcclyc.com.cn/xcclyc/DeEarthX-CE](https://git.xcclyc.com.cn/xcclyc/DeEarthX-CE)

## 相关文档

- [安装指南](/guide/installation) - 系统要求和安装方法
- [使用指南](/guide/usage) - 详细的使用方法和操作步骤
- [API 文档](/api/core) - 核心功能的 API 接口
- [贡献指南](/contributing) - 如何参与项目开发

## 术语表

### 核心术语

- **整合包**：Minecraft 模组的集合，包含多个模组和配置文件
- **服务端**：Minecraft 服务器端软件，用于运行多人游戏
- **客户端**：玩家使用的 Minecraft 游戏客户端
- **模组**：修改 Minecraft 游戏功能的插件
- **模组加载器**：允许 Minecraft 加载模组的工具，如 Forge、Fabric 等
- **模板**：预配置的模组集合，可重复使用

### 技术术语

- **前后端分离**：将应用分为前端（用户界面）和后端（业务逻辑）两部分
- **TypeScript**：JavaScript 的超集，添加了类型系统
- **Vue 3**：前端 JavaScript 框架，用于构建用户界面
- **Node.js**：基于 Chrome V8 引擎的 JavaScript 运行环境
- **Express**：Node.js 的 Web 应用框架
- **WebSocket**：提供全双工通信通道的网络协议
- **Tauri**：使用 Rust 和 Web 技术构建桌面应用的框架
- **Ant Design Vue**：基于 Vue 的 UI 组件库
- **Tailwind CSS**：实用优先的 CSS 框架

### 平台术语

- **CurseForge**：Minecraft 模组和整合包的主要分发平台
- **Modrinth**：开源的 Minecraft 模组分发平台
- **MCBBS**：中文 Minecraft 论坛，提供模组和整合包下载
- **SEA**：Node.js 单可执行应用程序，将 Node.js 应用打包为独立可执行文件