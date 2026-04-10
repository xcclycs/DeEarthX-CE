---
home: true
icon: house
title: DeEarthX-CE 文档
heroImage: /logo.svg
bgImage: https://theme-hope-assets.vuejs.press/bg/6-light.svg
bgImageDark: https://theme-hope-assets.vuejs.press/bg/6-dark.svg
bgImageStyle:
  background-attachment: fixed
heroText: DeEarthX-CE
tagline: Minecraft 整合包服务端制作工具
actions:
  - text: 快速开始
    icon: lightbulb
    link: ./guide/quick-start
    type: primary

  - text: 了解更多
    icon: book
    link: ./guide/usage-guide

features:
  - title: 整合包支持
    icon: package
    details: 支持 CurseForge、Modrinth、MCBBS 等平台的整合包

  - title: 智能模组筛选
    icon: filter
    details: 自动区分客户端和服务端模组，剔除客户端专用模组

  - title: 多加载器支持
    icon: code
    details: 支持 Forge、NeoForge、Fabric 等主流模组加载器

  - title: 模板管理
    icon: layout
    details: 支持创建、编辑、导入/导出模板，提供模板商店

  - title: 多模式工作
    icon: git-branch
    details: 支持开服模式和上传模式，满足不同需求

  - title: 多语言支持
    icon: globe
    details: 支持中文、英文等多种语言

copyright: false
footer: DeEarthX-CE 文档 © 2026
---

## 什么是 DeEarthX-CE？

DeEarthX-CE 是一款开源的 Minecraft 整合包服务端制作工具，旨在帮助用户快速将客户端整合包转换为可运行的服务端，同时提供强大的模板管理功能。

### 主要功能

- **整合包支持**：支持 CurseForge、Modrinth、MCBBS 等平台的整合包
- **智能模组筛选**：自动区分客户端和服务端模组，保留服务端需要的，剔除客户端专用的（光影、材质包等）
- **多加载器支持**：支持 Forge、NeoForge、Fabric 等主流模组加载器
- **多模式工作**：开服模式（完整生成服务端）和上传模式（仅做模组筛选）
- **模板管理**：创建、编辑、删除本地模板，导入/导出模板，模板商店
- **多语言支持**：支持中文、英文等多种语言
- **镜像源加速**：内置 BMCLAPI 和 MCIM 镜像源，加速下载

### 适用场景

- 服务器管理员快速制作服务端
- 整合包作者测试服务端兼容性
- 玩家自行搭建服务器
- 教育机构搭建 Minecraft 教学服务器

### 技术特点

- 基于 TypeScript + Node.js 后端
- Vue 3 + TypeScript 前端
- Tauri 2 桌面框架
- WebSocket 实时通信
- 模块化架构设计
- 友好的用户界面

## 快速导航

- [使用指南](./guide/quick-start)
- [开发文档](./dev/architecture)
- [错误码参考](./error-codes)
- [鸣谢](./acknowledgements)
