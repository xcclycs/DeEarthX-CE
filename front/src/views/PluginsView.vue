<script lang="ts" setup>
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import {
  ApiOutlined,
  PlusOutlined,
  ExportOutlined,
  DeleteOutlined,
  UploadOutlined,
  ToolOutlined
} from '@ant-design/icons-vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
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
  hasSidebar?: boolean;
  sidebarItems?: Array<{ key: string; label: string; icon?: string; route: string }>;
  defaultConfig?: Record<string, any>;
}

interface PluginInfo {
  manifest: PluginManifest;
  enabled: boolean;
  config: {
    enabled: boolean;
    settings: Record<string, any>;
  };
}

const plugins = ref<PluginInfo[]>([]);
const loading = ref(false);
const installModalVisible = ref(false);
const createModalVisible = ref(false);
const creating = ref(false);

function generateRandomId(): string {
  let id = '';
  for (let i = 0; i < 10; i++) {
    id += Math.floor(Math.random() * 10).toString();
  }
  return id;
}

const createForm = reactive({
  name: '',
  author: '',
  url: '',
  withTutorial: false
});

const generatedId = ref(generateRandomId());

function resetCreateForm() {
  createForm.name = '';
  createForm.author = '';
  createForm.url = '';
  createForm.withTutorial = false;
  generatedId.value = generateRandomId();
}

function openCreateModal() {
  resetCreateForm();
  createModalVisible.value = true;
}

function closeCreateModal() {
  createModalVisible.value = false;
}

async function handleCreate() {
  if (!createForm.name.trim()) {
    message.warning(t('plugin.create_name_required') || '请输入插件名称');
    return;
  }
  if (!createForm.author.trim()) {
    message.warning(t('plugin.create_author_required') || '请输入作者');
    return;
  }

  creating.value = true;
  try {
    const apiHost = import.meta.env.VITE_API_HOST || 'localhost';
    const apiPort = import.meta.env.VITE_API_PORT || '37019';
    const response = await fetch(`http://${apiHost}:${apiPort}/plugins/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: createForm.name.trim(),
        author: createForm.author.trim(),
        url: createForm.url.trim(),
        withTutorial: createForm.withTutorial
      })
    });
    const result = await response.json();
    if (result.status === 200) {
      message.success(t('plugin.create_success') || '插件创建成功');
      closeCreateModal();
      await loadPlugins();
    } else {
      message.error(result.message || t('plugin.create_failed') || '创建插件失败');
    }
  } catch (error) {
    console.error('创建插件失败:', error);
    message.error(t('plugin.create_failed') || '创建插件失败');
  } finally {
    creating.value = false;
  }
}

async function loadPlugins() {
  loading.value = true;
  try {
    const apiHost = import.meta.env.VITE_API_HOST || 'localhost';
    const apiPort = import.meta.env.VITE_API_PORT || '37019';
    const response = await fetch(`http://${apiHost}:${apiPort}/plugins`);
    const result = await response.json();
    if (result.status === 200) {
      plugins.value = result.data || [];
    } else {
      message.error(t('common.error'));
    }
  } catch (error) {
    console.error('加载插件列表失败:', error);
    message.error(t('common.error'));
  } finally {
    loading.value = false;
  }
}

async function togglePlugin(pluginId: string, enable: boolean) {
  try {
    const apiHost = import.meta.env.VITE_API_HOST || 'localhost';
    const apiPort = import.meta.env.VITE_API_PORT || '37019';
    const action = enable ? 'enable' : 'disable';
    const response = await fetch(`http://${apiHost}:${apiPort}/plugins/${pluginId}/${action}`, {
      method: 'POST'
    });
    const result = await response.json();
    if (result.status === 200) {
      message.success(enable ? t('plugin.enable_success') : t('plugin.disable_success'));
      await loadPlugins();
    } else {
      message.error(enable ? t('plugin.enable_failed') : t('plugin.disable_failed'));
    }
  } catch (error) {
    console.error('切换插件状态失败:', error);
    message.error(enable ? t('plugin.enable_failed') : t('plugin.disable_failed'));
  }
}

function deletePlugin(plugin: PluginInfo) {
  Modal.confirm({
    title: t('plugin.delete_title'),
    content: t('plugin.delete_confirm', { name: plugin.manifest.name }),
    okText: t('common.delete'),
    cancelText: t('common.cancel'),
    okButtonProps: { danger: true },
    onOk: async () => {
      try {
        const apiHost = import.meta.env.VITE_API_HOST || 'localhost';
        const apiPort = import.meta.env.VITE_API_PORT || '37019';
        const response = await fetch(`http://${apiHost}:${apiPort}/plugins/${plugin.manifest.id}?keepConfig=true`, {
          method: 'DELETE'
        });
        const result = await response.json();
        if (result.status === 200) {
          message.success(t('plugin.delete_success'));
          await loadPlugins();
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

function exportPlugin(plugin: PluginInfo) {
  try {
    const apiHost = import.meta.env.VITE_API_HOST || 'localhost';
    const apiPort = import.meta.env.VITE_API_PORT || '37019';
    window.open(`http://${apiHost}:${apiPort}/plugins/${plugin.manifest.id}/export`);
    message.success(t('plugin.export_success'));
  } catch (error) {
    console.error('导出插件失败:', error);
    message.error(t('plugin.export_failed'));
  }
}

function navigateToDetail(plugin: PluginInfo) {
  router.push(`/plugin/${plugin.manifest.id}`);
}

function openInstallModal() {
  installModalVisible.value = true;
}

function closeInstallModal() {
  installModalVisible.value = false;
}

async function handleInstallFile(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const apiHost = import.meta.env.VITE_API_HOST || 'localhost';
    const apiPort = import.meta.env.VITE_API_PORT || '37019';
    const response = await fetch(`http://${apiHost}:${apiPort}/plugins/install`, {
      method: 'POST',
      body: formData
    });
    const result = await response.json();
    if (result.status === 200) {
      message.success(t('plugin.install_success'));
      closeInstallModal();
      await loadPlugins();
    } else {
      message.error(t('plugin.install_failed'));
    }
  } catch (error) {
    console.error('安装插件失败:', error);
    message.error(t('plugin.install_failed'));
  }
}

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    const file = input.files[0];
    if (!file.name.endsWith('.zip')) {
      message.warning(t('home.only_zip_mrpack'));
      return;
    }
    handleInstallFile(file);
  }
}

onMounted(() => {
  loadPlugins();
});
</script>

<template>
  <div class="tw:h-full tw:w-full tw:flex tw:flex-col tw:p-6 tw:overflow-hidden">
    <div class="tw:flex tw:justify-between tw:items-center tw:mb-6">
      <div>
        <h1 class="tw:text-2xl tw:font-bold tw:text-gray-800">{{ t('plugin.title') }}</h1>
        <p class="tw:text-sm tw:text-gray-500 tw:mt-1">{{ t('plugin.description') }}</p>
      </div>
      <div class="tw:flex tw:gap-2">
        <a-button @click="openCreateModal">
          <template #icon><ToolOutlined /></template>
          {{ t('plugin.create_button') || '创建插件' }}
        </a-button>
        <a-button type="primary" @click="openInstallModal">
          <template #icon><PlusOutlined /></template>
          {{ t('plugin.install_button') }}
        </a-button>
      </div>
    </div>

    <a-spin :spinning="loading" class="tw:flex-1">
      <div v-if="plugins.length === 0 && !loading" class="tw:h-full tw:flex tw:flex-col tw:items-center tw:justify-center tw:text-gray-400">
        <ApiOutlined class="tw:text-6xl tw:mb-4" />
        <p class="tw:text-lg">{{ t('plugin.no_plugins') }}</p>
        <p class="tw:text-sm">{{ t('plugin.no_plugins_hint') }}</p>
      </div>

      <div v-else class="tw:grid tw:grid-cols-1 tw:md:grid-cols-2 tw:lg:grid-cols-3 tw:gap-4">
        <div
          v-for="plugin in plugins"
          :key="plugin.manifest.id"
          class="tw:bg-white tw:rounded-xl tw:shadow-sm tw:border tw:border-gray-100 tw:p-5 tw:cursor-pointer tw:transition-all tw:duration-300 hover:tw:shadow-md hover:tw:border-gray-200 tw:flex tw:flex-col"
          @click="navigateToDetail(plugin)"
        >
          <div class="tw:flex tw:items-start tw:justify-between tw:mb-3">
            <div class="tw:flex-1 tw:min-w-0">
              <h3 class="tw:text-base tw:font-semibold tw:text-gray-800 tw:truncate">{{ plugin.manifest.name }}</h3>
              <p class="tw:text-xs tw:text-gray-500 tw:mt-0.5">
                {{ plugin.manifest.author }} · v{{ plugin.manifest.version }}
              </p>
            </div>
            <a-tag
              :color="plugin.enabled ? 'green' : 'default'"
              class="tw:shrink-0 tw:ml-2"
            >
              {{ plugin.enabled ? t('plugin.plugin_status_enabled') : t('plugin.plugin_status_disabled') }}
            </a-tag>
          </div>

          <p v-if="plugin.manifest.description" class="tw:text-sm tw:text-gray-600 tw:line-clamp-2 tw:mb-4 tw:flex-1">
            {{ plugin.manifest.description }}
          </p>

          <div class="tw:flex tw:items-center tw:gap-2 tw:pt-3 tw:border-t tw:border-gray-50" @click.stop>
            <a-switch
              :checked="plugin.enabled"
              @change="(checked: boolean) => togglePlugin(plugin.manifest.id, checked)"
              size="small"
            />
            <span class="tw:text-xs tw:text-gray-500">
              {{ plugin.enabled ? t('common.start') : t('common.close') }}
            </span>
            <div class="tw:flex-1" />
            <a-button size="small" type="text" @click="exportPlugin(plugin)" :title="t('plugin.export_button')">
              <template #icon><ExportOutlined /></template>
            </a-button>
            <a-button size="small" type="text" danger @click="deletePlugin(plugin)" :title="t('plugin.delete_button')">
              <template #icon><DeleteOutlined /></template>
            </a-button>
          </div>
        </div>
      </div>
    </a-spin>

    <a-modal
      v-model:open="installModalVisible"
      :title="t('plugin.install_title')"
      :footer="null"
      :closable="true"
      width="480px"
    >
      <div class="tw:p-4">
        <div
          class="tw:border-2 tw:border-dashed tw:border-gray-300 tw:rounded-lg tw:p-8 tw:text-center tw:cursor-pointer hover:tw:border-blue-400 hover:tw:bg-blue-50 tw:transition-all"
          @click="($event) => ($event.target as HTMLElement)?.querySelector('input')?.click()"
          @dragover.prevent
          @drop.prevent="(e) => {
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) handleInstallFile(files[0]);
          }"
        >
          <UploadOutlined class="tw:text-4xl tw:text-gray-400 tw:mb-3" />
          <p class="tw:text-gray-600">{{ t('plugin.install_hint') }}</p>
          <input
            type="file"
            accept=".zip"
            class="tw:hidden"
            @change="handleFileSelect"
          />
        </div>
      </div>
    </a-modal>

    <a-modal
      v-model:open="createModalVisible"
      :title="t('plugin.create_title') || '创建插件'"
      :closable="true"
      width="520px"
      @cancel="closeCreateModal"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }">
        <a-form-item :label="t('plugin.create_id_label') || '插件 ID'" required>
          <a-input
            :value="generatedId"
            disabled
            class="tw:bg-gray-50"
          >
            <template #suffix>
              <span class="tw:text-xs tw:text-gray-400">自动生成</span>
            </template>
          </a-input>
          <p class="tw:text-xs tw:text-gray-400 tw:mt-1">{{ t('plugin.create_id_hint') || '由系统自动生成 10 位数字 ID，不可修改' }}</p>
        </a-form-item>

        <a-form-item :label="t('plugin.create_name_label') || '插件名称'" required>
          <a-input
            v-model:value="createForm.name"
            :placeholder="t('plugin.create_name_placeholder') || '请输入插件名称'"
          />
        </a-form-item>

        <a-form-item :label="t('plugin.create_author_label') || '作者'" required>
          <a-input
            v-model:value="createForm.author"
            :placeholder="t('plugin.create_author_placeholder') || '请输入作者名称'"
          />
        </a-form-item>

        <a-form-item :label="t('plugin.create_url_label') || '链接'">
          <a-input
            v-model:value="createForm.url"
            :placeholder="t('plugin.create_url_placeholder') || '可选，如 https://github.com/...'"
          />
        </a-form-item>

        <a-form-item :wrapper-col="{ offset: 5, span: 19 }">
          <a-checkbox v-model:checked="createForm.withTutorial">
            {{ t('plugin.create_with_tutorial') || '创建教程插件（包含中文注释的完整示例代码）' }}
          </a-checkbox>
        </a-form-item>
      </a-form>

      <template #footer>
        <a-button @click="closeCreateModal">{{ t('common.cancel') }}</a-button>
        <a-button type="primary" :loading="creating" @click="handleCreate">
          {{ t('plugin.create_confirm') || '创建' }}
        </a-button>
      </template>
    </a-modal>
  </div>
</template>