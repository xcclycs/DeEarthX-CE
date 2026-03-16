# DeEarthX-CE

[简体中文](README.md) | English

## Project Overview

DeEarthX V3 is a Minecraft server-side modpack creation tool that helps you quickly convert client-side modpacks into runnable servers, while also providing template management capabilities.

QQ Group: 1090666196

Documentation: [https://dex.xcclyc.cn/](https://dex.xcclyc.cn/)

## Core Features

### Modpack Support
- CurseForge
- Modrinth
- MCBBS

### Mod Processing
Automatically distinguish between client-side and server-side mods, keeping what the server needs and removing client-exclusive ones (shaders, resource packs, etc.).

### Working Modes
- **Server Mode**: Downloads server and mod loaders, fully generates the server
- **Upload Mode**: Only performs mod filtering, without downloading server files

### Mod Loaders
- Forge
- NeoForge
- Fabric

### Version Support
Supports versions from 1.16.5 to the latest.

### Template Management
- Create, edit, and delete local templates
- Import/export templates
- Template store, support downloading templates from remote servers
- Smart download speed test, select the fastest download link

## Technical Architecture

### Backend
TypeScript + Node.js, Express provides web services, WebSocket real-time communication, packaged as standalone exe using Node.js SEA.

### Frontend
Vue 3 + TypeScript, Tauri 2 desktop framework, Ant Design Vue UI components, Tailwind CSS styling.

## Usage Process

1. Prepare the modpack file
2. Select the mode (Server/Upload)
3. Upload the file
4. Wait for processing to complete
5. Download the server

## Template Management Process

1. Enter the template management page
2. Select local templates or template store
3. Local templates: Create, edit, delete, export templates
4. Template store: Browse and download templates

## Project Features

- Upload and use immediately, no configuration required
- Real-time progress display
- Built-in BMCLAPI and MCIM mirror sources for accelerated downloads
- Multi-language support
- Smart template management system
- Template store provides rich preset templates

> [!WARNING]
> Mods may not be filtered completely, and the generated server is prohibited from being used for sale!

## Installation Instructions

Simply download and install the installer to use.

**Note**: It is recommended not to install on drive C to avoid permission issues.

## System Requirements

- Operating System: Windows
- Server mode requires Java environment
- Upload mode does not require Java

## Development Team

- **Tianpao**: Core development, original author
- **XCC**: Feature optimization, CE version author