<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { message } from 'ant-design-vue';
import { ArrowLeftOutlined, SettingOutlined } from '@ant-design/icons-vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const pluginId = computed(() => route.params.pluginId as string);
const pageKey = computed(() => route.params.pageKey as string);

interface PluginPageInfo {
  title: string;
  pluginId: string;
  pluginName: string;
  pluginAuthor: string;
  pluginVersion: string;
  pageKey: string;
  description: string;
  hasFrontend: boolean;
  defaultConfig: Record<string, any>;
}

const pageInfo = ref<PluginPageInfo | null>(null);
const loading = ref(true);
const hasFrontend = ref(false);
const frontendUrl = ref('');

async function loadPage() {
  loading.value = true;
  try {
    const apiHost = import.meta.env.VITE_API_HOST || 'localhost';
    const apiPort = import.meta.env.VITE_API_PORT || '37019';
    const url = `http://${apiHost}:${apiPort}/plugin-page/${pluginId.value}/${pageKey.value}`;

    const response = await fetch(url);
    if (!response.ok) {
      message.error(t('common.error') || '加载页面失败');
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const html = await response.text();
      const blob = new Blob([html], { type: 'text/html' });
      frontendUrl.value = URL.createObjectURL(blob);
      hasFrontend.value = true;
    } else {
      const result = await response.json();
      if (result.status === 200) {
        pageInfo.value = result.data;
        hasFrontend.value = false;
      }
    }
  } catch (error) {
    console.error('加载插件页面失败:', error);
    message.error(t('common.error') || '加载页面失败');
  } finally {
    loading.value = false;
  }
}

function goBack() {
  router.push('/plugins');
}

function goToPluginDetail() {
  router.push(`/plugin/${pluginId.value}`);
}

const configKeys = computed(() => {
  if (!pageInfo.value?.defaultConfig) return [];
  return Object.keys(pageInfo.value.defaultConfig);
});

function getFieldType(key: string): string {
  const value = pageInfo.value?.defaultConfig?.[key];
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

onMounted(() => {
  loadPage();
});
</script>

<template>
  <div class="tw:h-full tw:w-full tw:flex tw:flex-col tw:overflow-hidden">
    <div v-if="loading" class="tw:flex tw:items-center tw:justify-center tw:h-full">
      <a-spin />
    </div>

    <template v-else-if="hasFrontend">
      <div class="tw:flex tw:items-center tw:gap-2 tw:p-3 tw:bg-white tw:border-b tw:border-gray-100">
        <a-button type="text" @click="goBack">
          <template #icon><ArrowLeftOutlined /></template>
        </a-button>
        <span class="tw:text-sm tw:font-medium">{{ pageInfo?.title || pageKey }}</span>
      </div>
      <iframe
        :src="frontendUrl"
        class="tw:flex-1 tw:w-full tw:border-none"
        sandbox="allow-scripts allow-same-origin"
      />
    </template>

    <div v-else class="tw:h-full tw:overflow-y-auto tw:p-8">
      <div class="tw:max-w-4xl tw:mx-auto">
        <div class="tw:flex tw:items-center tw:gap-3 tw:mb-6">
          <a-button type="text" @click="goBack">
            <template #icon><ArrowLeftOutlined /></template>
          </a-button>
          <div>
            <h1 class="tw:text-xl tw:font-bold tw:text-gray-800">{{ pageInfo?.title || pageKey }}</h1>
            <p class="tw:text-sm tw:text-gray-500">
              {{ pageInfo?.pluginName }} · {{ pageInfo?.pluginAuthor }}
            </p>
          </div>
          <div class="tw:flex-1" />
          <a-button @click="goToPluginDetail">
            <template #icon><SettingOutlined /></template>
            {{ t('plugin.config_title') || '配置' }}
          </a-button>
        </div>

        <a-card class="tw:mb-6">
          <div class="tw:text-center tw:py-12">
            <div class="tw:text-5xl tw:mb-4 tw:opacity-30">📄</div>
            <h3 class="tw:text-lg tw:font-medium tw:text-gray-600 tw:mb-2">
              {{ pageInfo?.title || '插件页面' }}
            </h3>
            <p class="tw:text-sm tw:text-gray-400 tw:mb-6">
              {{ pageInfo?.description || '该页面暂无自定义界面内容' }}
            </p>
            <div class="tw:bg-gray-50 tw:rounded-lg tw:p-4 tw:text-left">
              <p class="tw:text-xs tw:text-gray-500 tw:mb-2 tw:font-medium">插件信息</p>
              <div class="tw:grid tw:grid-cols-2 tw:gap-2 tw:text-sm">
                <div><span class="tw:text-gray-400">ID：</span>{{ pageInfo?.pluginId }}</div>
                <div><span class="tw:text-gray-400">名称：</span>{{ pageInfo?.pluginName }}</div>
                <div><span class="tw:text-gray-400">作者：</span>{{ pageInfo?.pluginAuthor }}</div>
                <div><span class="tw:text-gray-400">版本：</span>{{ pageInfo?.pluginVersion }}</div>
                <div><span class="tw:text-gray-400">页面：</span>{{ pageKey }}</div>
              </div>
            </div>

            <div v-if="configKeys.length > 0" class="tw:mt-4 tw:bg-blue-50 tw:rounded-lg tw:p-4 tw:text-left">
              <p class="tw:text-xs tw:text-blue-600 tw:mb-2 tw:font-medium">{{ t('plugin.config_title') || '默认配置' }}</p>
              <div class="tw:grid tw:grid-cols-2 tw:gap-2 tw:text-sm">
                <div v-for="key in configKeys" :key="key" class="tw:flex tw:items-center tw:gap-2">
                  <span class="tw:text-blue-500">{{ key }}：</span>
                  <a-tag v-if="getFieldType(key) === 'boolean'" :color="pageInfo?.defaultConfig[key] ? 'green' : 'default'">
                    {{ pageInfo?.defaultConfig[key] ? '是' : '否' }}
                  </a-tag>
                  <span v-else class="tw:text-gray-700">{{ pageInfo?.defaultConfig[key] }}</span>
                </div>
              </div>
            </div>

            <div class="tw:mt-6 tw:bg-yellow-50 tw:rounded-lg tw:p-4 tw:text-left">
              <p class="tw:text-xs tw:text-yellow-700 tw:mb-1 tw:font-medium">💡 如何自定义此页面？</p>
              <p class="tw:text-xs tw:text-yellow-600">
                在插件目录中创建 <code class="tw:bg-yellow-100 tw:px-1 tw:rounded">frontend/{{ pageKey }}.html</code> 或
                <code class="tw:bg-yellow-100 tw:px-1 tw:rounded">frontend/{{ pageKey }}/index.html</code> 文件，
                即可替换此默认页面。
              </p>
            </div>
          </div>
        </a-card>
      </div>
    </div>
  </div>
</template>