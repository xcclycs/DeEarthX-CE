<script lang="ts" setup>
import { ref, computed } from 'vue';
import { MinusOutlined, CloseOutlined, LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons-vue';
import { useI18n } from 'vue-i18n';

defineProps<{
    version: string;
    backendStatus: 'loading' | 'success' | 'error';
    backendErrorInfo: string;
    showAds: boolean;
}>();

const { t } = useI18n();

// 窗口控制 API — 懒初始化，仅在 Tauri 环境下可用
let appWindow: any = null;
let appWindowInit = false;

async function getAppWindow() {
    if (!appWindowInit) {
        appWindowInit = true;
        try {
            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            appWindow = getCurrentWindow();
        } catch {
            // 浏览器开发模式下不可用，忽略
        }
    }
    return appWindow;
}
const isCloseHover = ref(false);

// 开始拖拽窗口
async function startDragging(e: MouseEvent) {
    const win = await getAppWindow();
    if (e.button === 0 && win) {
        win.startDragging();
    }
}

// 最小化
async function minimize() {
    const win = await getAppWindow();
    if (win) {
        await win.minimize();
    }
}

// 关闭
async function close() {
    const win = await getAppWindow();
    if (win) {
        await win.close();
    }
}

const displayTitle = computed(() => {
    return isCloseHover.value ? 'Systemmmm' : t('common.app_name');
});
</script>

<template>
    <div class="titlebar" @mousedown="startDragging">
        <div class="titlebar-left">
            <img src="/icons/32x32.png" class="app-logo" alt="logo" />
            <span class="app-title">{{ displayTitle }}</span>
            <span class="app-version">{{ version }}</span>
            <span
                class="backend-status"
                :title="backendErrorInfo || t('message.backend_running')"
            >
                <LoadingOutlined v-if="backendStatus === 'loading'" style="color: #1890ff;" />
                <CheckCircleOutlined v-else-if="backendStatus === 'success'" style="color: #52c41a;" />
                <CloseCircleOutlined v-else style="color: #ff4d4f;" />
                <span class="status-text"
                      :style="{
                          color: backendStatus === 'loading' ? '#1890ff' :
                                 backendStatus === 'success' ? '#52c41a' : '#ff4d4f'
                      }">
                    {{ backendStatus === 'loading' ? t('common.status_loading') :
                       backendStatus === 'success' ? t('common.status_success') : t('common.status_error') }}
                </span>
            </span>
            <!-- 右侧额外内容插槽（广告位 + 制作进度指示器） -->
            <div class="titlebar-extra">
                <slot name="extra" />
            </div>
        </div>
        <div class="titlebar-buttons">
            <button class="titlebar-btn minimize" @mousedown.stop @click="minimize" :title="t('common.minimize')">
                <MinusOutlined />
            </button>
            <button class="titlebar-btn close" @mouseenter="isCloseHover = true" @mouseleave="isCloseHover = false" @mousedown.stop @click="close" :title="t('common.close')">
                <CloseOutlined />
            </button>
        </div>
        <div class="titlebar-close-overlay"></div>
    </div>
</template>

<style scoped>
.titlebar {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 40px;
    background: linear-gradient(180deg, #ffffff 0%, #fafafa 100%);
    border-bottom: 1px solid #e5e7eb;
    padding-left: 16px;
    user-select: none;
    -webkit-user-select: none;
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
    z-index: 10;
}

.titlebar-close-overlay {
    position: absolute;
    top: 0;
    right: 0;
    width: 0;
    height: 100%;
    background: #ef4444;
    z-index: 0;
    transition: width 0.5s ease;
}

.titlebar:has(.titlebar-btn.close:hover) .titlebar-close-overlay {
    width: 100%;
}

.titlebar-left {
    display: flex;
    align-items: center;
    gap: 12px;
    position: relative;
    z-index: 1;
    flex: 1;
    min-width: 0;
}

.app-logo {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
}

.app-title {
    font-size: 14px;
    font-weight: 600;
    color: #1f2937;
    font-family: "Plus Jakarta Sans", "Noto Sans SC", "Microsoft YaHei", sans-serif;
    transition: color 0.4s ease;
    white-space: nowrap;
}

.titlebar:has(.titlebar-btn.close:hover) .app-title {
    color: #ffffff;
}

.app-version {
    font-size: 11px;
    color: #9ca3af;
    font-family: "JetBrains Mono", "Cascadia Code", monospace;
    transition: color 0.4s ease;
    white-space: nowrap;
}

.titlebar:has(.titlebar-btn.close:hover) .app-version {
    color: rgba(255, 255, 255, 0.8);
}

.backend-status {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 8px;
    flex-shrink: 0;
}

.status-text {
    font-size: 12px;
    transition: color 0.4s ease;
}

.titlebar:has(.titlebar-btn.close:hover) .status-text {
    color: rgba(255, 255, 255, 0.9) !important;
}

.titlebar:has(.titlebar-btn.close:hover) .anticon {
    color: rgba(255, 255, 255, 0.9) !important;
}

.titlebar-extra {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: 16px;
    flex-shrink: 1;
    min-width: 0;
    overflow: hidden;
}

.titlebar-buttons {
    display: flex;
    height: 100%;
    position: relative;
    z-index: 1;
    flex-shrink: 0;
}

.titlebar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 100%;
    border: none;
    background: transparent;
    color: #6b7280;
    cursor: pointer;
    font-size: 12px;
    position: relative;
    z-index: 1;
    transition: color 0.4s ease;
}

.titlebar-btn:hover {
    color: #374151;
}

.titlebar-btn.close:hover {
    color: #ffffff;
}

.titlebar-btn.close:active ~ .titlebar-close-overlay {
    background: #dc2626;
}
</style>