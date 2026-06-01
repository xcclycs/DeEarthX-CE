<script lang="ts" setup>
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import {
  ArrowLeftOutlined,
  GlobalOutlined,
  CodeOutlined,
  ExportOutlined,
  DeleteOutlined,
  SettingOutlined,
  ToolOutlined
} from '@ant-design/icons-vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  url?: string;
  description?: string;
  openSource?: boolean;
  sourceUrl?: string;
  icon?: string;
  hasSidebar?: boolean;
  sidebarItems?: Array<{ key: string; label: string; icon?: string; route: string }>;
  defaultConfig?: Record<string, any>;
  configLabels?: Record<string, string>;
}

interface PluginInfo {
  manifest: PluginManifest;
  enabled: boolean;
  config: {
    enabled: boolean;
    settings: Record<string, any>;
  };
}

const pluginId = computed(() => route.params.id as string);
const plugin = ref<PluginInfo | null>(null);
const loading = ref(false);
const saving = ref(false);
const configSettings = ref<Record<string, any>>({});
const defaultConfig = ref<Record<string, any>>({});

async function loadPlugin() {
  loading.value = true;
  try {
    const apiHost = import.meta.env.VITE_API_HOST || 'localhost';
    const apiPort = import.meta.env.VITE_API_PORT || '37019';
    const response = await fetch(`http://${apiHost}:${apiPort}/plugins/${pluginId.value}`);
    const result = await response.json();
    if (result.status === 200) {
      plugin.value = result.data;
      configSettings.value = { ...(result.data.config?.settings || {}) };
    } else {
      message.error(t('common.error'));
      router.push('/plugins');
    }
  } catch (error) {
    console.error('加载插件详情失败:', error);
    message.error(t('common.error'));
    router.push('/plugins');
  } finally {
    loading.value = false;
  }
}

async function loadPluginConfig() {
  try {
    const apiHost = import.meta.env.VITE_API_HOST || 'localhost';
    const apiPort = import.meta.env.VITE_API_PORT || '37019';
    const response = await fetch(`http://${apiHost}:${apiPort}/plugins/${pluginId.value}/config`);
    const result = await response.json();
    if (result.status === 200) {
      defaultConfig.value = result.data.defaults || {};
      configSettings.value = { ...result.data.settings };
    }
  } catch {
    // ignore
  }
}

async function saveConfig() {
  saving.value = true;
  try {
    const apiHost = import.meta.env.VITE_API_HOST || 'localhost';
    const apiPort = import.meta.env.VITE_API_PORT || '37019';
    const response = await fetch(`http://${apiHost}:${apiPort}/plugins/${pluginId.value}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: configSettings.value })
    });
    const result = await response.json();
    if (result.status === 200) {
      message.success(t('plugin.config_saved'));
    } else {
      message.error(t('plugin.config_save_failed'));
    }
  } catch (error) {
    console.error('保存配置失败:', error);
    message.error(t('plugin.config_save_failed'));
  } finally {
    saving.value = false;
  }
}

async function togglePlugin() {
  if (!plugin.value) return;
  const enable = !plugin.value.enabled;
  try {
    const apiHost = import.meta.env.VITE_API_HOST || 'localhost';
    const apiPort = import.meta.env.VITE_API_PORT || '37019';
    const action = enable ? 'enable' : 'disable';
    const response = await fetch(`http://${apiHost}:${apiPort}/plugins/${pluginId.value}/${action}`, {
      method: 'POST'
    });
    const result = await response.json();
    if (result.status === 200) {
      message.success(enable ? t('plugin.enable_success') : t('plugin.disable_success'));
      await loadPlugin();
    } else {
      message.error(enable ? t('plugin.enable_failed') : t('plugin.disable_failed'));
    }
  } catch (error) {
    console.error('切换插件状态失败:', error);
    message.error(enable ? t('plugin.enable_failed') : t('plugin.disable_failed'));
  }
}

function exportPlugin() {
  if (!plugin.value) return;
  try {
    const apiHost = import.meta.env.VITE_API_HOST || 'localhost';
    const apiPort = import.meta.env.VITE_API_PORT || '37019';
    window.open(`http://${apiHost}:${apiPort}/plugins/${pluginId.value}/export`);
    message.success(t('plugin.export_success'));
  } catch (error) {
    console.error('导出插件失败:', error);
    message.error(t('plugin.export_failed'));
  }
}

function deletePlugin() {
  if (!plugin.value) return;
  Modal.confirm({
    title: t('plugin.delete_title'),
    content: t('plugin.delete_confirm', { name: plugin.value.manifest.name }),
    okText: t('common.delete'),
    cancelText: t('common.cancel'),
    okButtonProps: { danger: true },
    onOk: async () => {
      try {
        const apiHost = import.meta.env.VITE_API_HOST || 'localhost';
        const apiPort = import.meta.env.VITE_API_PORT || '37019';
        const response = await fetch(`http://${apiHost}:${apiPort}/plugins/${pluginId.value}?keepConfig=true`, {
          method: 'DELETE'
        });
        const result = await response.json();
        if (result.status === 200) {
          message.success(t('plugin.delete_success'));
          router.push('/plugins');
        } else {
          message.error(t('plugin.delete_failed'));
        }
      } catch (error) {
        console.error('删除插件失败:', error);
        message.error(t('plugin.delete_failed'));
      }
    }
  });
}

const hasConfig = computed(() => {
  return plugin.value?.manifest.defaultConfig && Object.keys(plugin.value.manifest.defaultConfig).length > 0;
});

const configKeys = computed(() => {
  if (!hasConfig.value) return [];
  return Object.keys(plugin.value!.manifest.defaultConfig!);
});

function getConfigFieldType(key: string): string {
  const defaultValue = plugin.value?.manifest.defaultConfig?.[key];
  if (typeof defaultValue === 'boolean') return 'boolean';
  if (typeof defaultValue === 'number') return 'number';
  return 'string';
}

onMounted(async () => {
  await loadPlugin();
  await loadPluginConfig();
});
</script>

<template>
  <div class="tw:h-full tw:w-full tw:flex tw:flex-col tw:p-6 tw:overflow-y-auto">
    <div v-if="loading" class="tw:flex tw:items-center tw:justify-center tw:h-full">
      <a-spin />
    </div>

    <template v-else-if="plugin">
      <div class="tw:flex tw:items-center tw:gap-3 tw:mb-6">
        <a-button type="text" class="tw:inline-flex tw:items-center tw:justify-center" @click="router.push('/plugins')">
          <template #icon><ArrowLeftOutlined /></template>
        </a-button>
        <div v-if="plugin.manifest.icon" class="tw:w-10 tw:h-10 tw:rounded-xl tw:bg-gradient-to-br tw:from-blue-50 tw:to-indigo-100 tw:flex tw:items-center tw:justify-center tw:text-xl">
          {{ plugin.manifest.icon }}
        </div>
        <div v-else class="tw:w-10 tw:h-10 tw:rounded-xl tw:bg-gradient-to-br tw:from-blue-50 tw:to-indigo-100 tw:flex tw:items-center tw:justify-center tw:text-lg">
          <ToolOutlined class="tw:text-blue-500" />
        </div>
        <div>
          <h1 class="tw:text-2xl tw:font-bold tw:text-gray-800">{{ plugin.manifest.name }}</h1>
          <p class="tw:text-sm tw:text-gray-500">{{ plugin.manifest.author }} · v{{ plugin.manifest.version }}</p>
        </div>
        <div class="tw:flex-1" />
        <a-switch
          :checked="plugin.enabled"
          @change="togglePlugin"
        />
        <a-button class="tw:inline-flex tw:items-center" @click="exportPlugin">
          <template #icon><ExportOutlined /></template>
          <span>{{ t('plugin.export_button') }}</span>
        </a-button>
        <a-button danger class="tw:inline-flex tw:items-center" @click="deletePlugin">
          <template #icon><DeleteOutlined /></template>
          <span>{{ t('plugin.delete_button') }}</span>
        </a-button>
      </div>

      <div class="tw:grid tw:grid-cols-1 tw:lg:grid-cols-3 tw:gap-6">
        <div class="tw:lg:col-span-1">
          <a-card :title="t('plugin.plugin_info')" class="tw:mb-4">
            <a-descriptions :column="1" size="small">
              <a-descriptions-item :label="t('plugin.plugin_id')">
                <a-tag>{{ plugin.manifest.id }}</a-tag>
              </a-descriptions-item>
              <a-descriptions-item :label="t('plugin.plugin_name')">
                {{ plugin.manifest.name }}
              </a-descriptions-item>
              <a-descriptions-item :label="t('plugin.plugin_version')">
                {{ plugin.manifest.version }}
              </a-descriptions-item>
              <a-descriptions-item :label="t('plugin.plugin_author')">
                {{ plugin.manifest.author }}
              </a-descriptions-item>
              <a-descriptions-item v-if="plugin.manifest.url" :label="t('plugin.plugin_url')">
                <a :href="plugin.manifest.url" target="_blank" class="tw:text-blue-500">
                  <GlobalOutlined class="tw:mr-1" />{{ plugin.manifest.url }}
                </a>
              </a-descriptions-item>
              <a-descriptions-item :label="t('plugin.plugin_open_source')">
                <a-tag :color="plugin.manifest.openSource ? 'green' : 'default'">
                  {{ plugin.manifest.openSource ? t('plugin.plugin_open_source_yes') : t('plugin.plugin_open_source_no') }}
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item v-if="plugin.manifest.sourceUrl" :label="t('plugin.plugin_source_url')">
                <a :href="plugin.manifest.sourceUrl" target="_blank" class="tw:text-blue-500">
                  <CodeOutlined class="tw:mr-1" />{{ plugin.manifest.sourceUrl }}
                </a>
              </a-descriptions-item>
              <a-descriptions-item :label="t('plugin.plugin_has_sidebar')">
                {{ plugin.manifest.hasSidebar ? t('plugin.plugin_has_sidebar_yes') : t('plugin.plugin_has_sidebar_no') }}
              </a-descriptions-item>
            </a-descriptions>
          </a-card>

          <a-card v-if="plugin.manifest.description" :title="t('template.description')" class="tw:mb-4">
            <p class="tw:text-sm tw:text-gray-600">{{ plugin.manifest.description }}</p>
          </a-card>

          <a-card v-if="plugin.manifest.sidebarItems && plugin.manifest.sidebarItems.length > 0" :title="t('plugin.plugin_sidebar_items')">
            <div v-for="item in plugin.manifest.sidebarItems" :key="item.key" class="tw:py-1">
              <a-tag color="blue">{{ item.label }}</a-tag>
              <span class="tw:text-xs tw:text-gray-500 tw:ml-2">{{ item.route }}</span>
            </div>
          </a-card>
        </div>

        <div class="tw:lg:col-span-2">
          <a-card :title="t('plugin.config_title')">
            <div v-if="!hasConfig" class="tw:text-center tw:py-8 tw:text-gray-400">
              <SettingOutlined class="tw:text-3xl tw:mb-2" />
              <p>{{ t('plugin.config_no_config') }}</p>
            </div>

            <a-form v-else :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item
                v-for="key in configKeys"
                :key="key"
                :label="plugin.manifest.configLabels?.[key] || key"
              >
                <a-switch
                  v-if="getConfigFieldType(key) === 'boolean'"
                  v-model:checked="configSettings[key]"
                />
                <a-input-number
                  v-else-if="getConfigFieldType(key) === 'number'"
                  v-model:value="configSettings[key]"
                  class="tw:w-full"
                />
                <a-input
                  v-else
                  v-model:value="configSettings[key]"
                  :placeholder="String(defaultConfig[key] || '')"
                />
              </a-form-item>

              <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
                <a-button type="primary" :loading="saving" @click="saveConfig">
                  {{ t('plugin.config_save') }}
                </a-button>
              </a-form-item>
            </a-form>
          </a-card>
        </div>
      </div>
    </template>
  </div>
</template>