<script lang="ts" setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { message, Modal, Empty, Progress } from 'ant-design-vue';
import {
  PlayCircleOutlined, PauseCircleOutlined, ReloadOutlined,
  DeleteOutlined, FolderOpenOutlined, CloudServerOutlined,
  ApiOutlined, SettingOutlined, CoffeeOutlined, DesktopOutlined,
  GlobalOutlined, CloseCircleOutlined
} from '@ant-design/icons-vue';

const { t } = useI18n();

// ==================== 通用工具 ====================
function getApiHost(): string {
  return `http://${import.meta.env.VITE_API_HOST || 'localhost'}:${import.meta.env.VITE_API_PORT || '37019'}`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 MB';
  return Math.round(bytes / 1024 / 1024) + ' MB';
}

// ==================== Java 检测 ====================
const javaVersions = ref<Array<{ path: string; version: string; vendor: string }>>([]);
const javaLoading = ref(false);
const javaError = ref('');
const javaPopoverVisible = ref(false);

async function detectJava() {
  javaLoading.value = true;
  javaError.value = '';
  try {
    const res = await fetch(`${getApiHost()}/java/detect`);
    const data = await res.json();
    if (data.status === 200) {
      javaVersions.value = data.data || [];
    } else {
      javaError.value = data.message || t('server.java_detect_failed');
    }
  } catch {
    javaError.value = t('server.java_detect_failed');
  } finally {
    javaLoading.value = false;
  }
}

const primaryJava = computed(() => javaVersions.value[0] || null);

// ==================== 本地服务端 ====================
interface LocalServer {
  id: string;
  name: string;
  path: string;
  status: 'running' | 'stopped' | 'starting' | 'stopping';
  javaVersion: string;
  port: number;
  version: string;
  loaderType: string;
  pid?: number;
  cpu?: number;
  memory?: number;
  players?: number;
  maxPlayers?: number;
}

const localServers = ref<LocalServer[]>([]);
const localLoading = ref(false);
const localRefreshTimer = ref<ReturnType<typeof setInterval> | null>(null);

async function fetchLocalServers() {
  localLoading.value = true;
  try {
    const res = await fetch(`${getApiHost()}/servers/local`);
    const data = await res.json();
    if (data.status === 200) {
      localServers.value = (data.data || []).map((s: any) => ({ ...s, _type: 'local' as const }));
    }
  } catch { /* ignore */ }
  finally { localLoading.value = false; }
}

async function startLocalServer(server: LocalServer) {
  try {
    await fetch(`${getApiHost()}/servers/local/${server.id}/start`, { method: 'POST' });
    message.success(t('server.starting', { name: server.name }));
    fetchLocalServers();
  } catch { message.error(t('server.start_failed')); }
}

async function stopLocalServer(server: LocalServer) {
  try {
    await fetch(`${getApiHost()}/servers/local/${server.id}/stop`, { method: 'POST' });
    message.success(t('server.stopping', { name: server.name }));
    fetchLocalServers();
  } catch { message.error(t('server.stop_failed')); }
}

function deleteLocalServer(server: LocalServer) {
  Modal.confirm({
    title: t('server.delete_confirm_title'),
    content: t('server.delete_confirm_content', { name: server.name }),
    okText: t('server.delete_ok'),
    cancelText: t('server.delete_cancel'),
    okType: 'danger',
    onOk: async () => {
      try {
        await fetch(`${getApiHost()}/servers/local/${server.id}`, { method: 'DELETE' });
        message.success(t('server.deleted', { name: server.name }));
        fetchLocalServers();
      } catch { message.error(t('server.delete_failed')); }
    }
  });
}

function openServerFolder(path: string) {
  fetch(`${getApiHost()}/open-folder?path=${encodeURIComponent(path)}`);
}

// ==================== 远程 MCSM ====================
const mcsmUrl = ref(localStorage.getItem('mcsm_url') || '');
const mcsmApiKey = ref(localStorage.getItem('mcsm_api_key') || '');
const mcsmConnected = ref(false);
const mcsmLoading = ref(false);
const mcsmError = ref('');
const mcsmDrawerVisible = ref(false);

const mcsmNodes = ref<Array<{
  uuid: string; ip: string; port: number; remarks: string; available: boolean;
  system?: { type: string; hostname: string; cpuUsage: number; memUsage: number; totalmem: number };
}>>([]);

const mcsmInstances = ref<Array<{
  instanceUuid: string; daemonId: string; nickname: string; status: number;
  config: any; processInfo: any; info: any;
}>>([]);

const mcsmInstancesLoading = ref(false);
const selectedNodeId = ref<string>('');

async function connectMcsm() {
  if (!mcsmUrl.value.trim() || !mcsmApiKey.value.trim()) {
    message.warning(t('server.mcsm_need_config'));
    return;
  }
  mcsmLoading.value = true;
  mcsmError.value = '';
  try {
    const baseUrl = mcsmUrl.value.replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/api/overview?apikey=${mcsmApiKey.value}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json; charset=utf-8' }
    });
    const data = await res.json();
    if (data.status === 200) {
      mcsmConnected.value = true;
      localStorage.setItem('mcsm_url', mcsmUrl.value);
      localStorage.setItem('mcsm_api_key', mcsmApiKey.value);
      if (data.data.remote) {
        mcsmNodes.value = data.data.remote.map((r: any) => ({
          uuid: r.uuid, ip: r.ip, port: r.port,
          remarks: r.remarks || r.ip, available: r.available,
          system: r.system
        }));
        if (mcsmNodes.value.length > 0) {
          selectedNodeId.value = mcsmNodes.value[0].uuid;
          fetchMcsmInstances();
        }
      }
      mcsmDrawerVisible.value = false;
      message.success(t('server.mcsm_connected'));
    } else {
      mcsmError.value = data.status === 403 ? t('server.mcsm_permission_denied') : t('server.mcsm_connect_failed');
    }
  } catch {
    mcsmError.value = t('server.mcsm_connect_failed');
  } finally {
    mcsmLoading.value = false;
  }
}

function disconnectMcsm() {
  mcsmConnected.value = false;
  mcsmNodes.value = [];
  mcsmInstances.value = [];
  selectedNodeId.value = '';
}

async function fetchMcsmInstances() {
  if (!selectedNodeId.value) return;
  mcsmInstancesLoading.value = true;
  try {
    const baseUrl = mcsmUrl.value.replace(/\/$/, '');
    const res = await fetch(
      `${baseUrl}/api/service/remote_service_instances?apikey=${mcsmApiKey.value}&daemonId=${selectedNodeId.value}&page=1&page_size=50`,
      { headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json; charset=utf-8' } }
    );
    const data = await res.json();
    if (data.status === 200) {
      mcsmInstances.value = data.data.data || [];
    }
  } catch { /* ignore */ }
  finally { mcsmInstancesLoading.value = false; }
}

async function mcsmAction(instance: any, action: string) {
  try {
    const baseUrl = mcsmUrl.value.replace(/\/$/, '');
    const res = await fetch(
      `${baseUrl}/api/protected_instance/${action}?apikey=${mcsmApiKey.value}&uuid=${instance.instanceUuid}&daemonId=${instance.daemonId}`,
      { headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json; charset=utf-8' } }
    );
    const data = await res.json();
    if (data.status === 200) {
      message.success(t(`server.mcsm_${action}_success`));
      fetchMcsmInstances();
    } else {
      message.error(t(`server.mcsm_${action}_failed`));
    }
  } catch {
    message.error(t(`server.mcsm_${action}_failed`));
  }
}

// ==================== 混合服务端列表 ====================
interface ServerCard {
  id: string;
  name: string;
  remote: boolean;
  status: 'running' | 'stopped' | 'starting' | 'stopping';
  loaderType: string;
  version: string;
  port: number;
  players?: number;
  maxPlayers?: number;
  cpu?: number;
  memory?: number;
  path?: string;
  pid?: number;
  // 本地
  localServer?: LocalServer;
  // 远程
  mcsmInstance?: any;
}

const allServers = computed<ServerCard[]>(() => {
  const local: ServerCard[] = localServers.value.map(s => ({
    id: s.id,
    name: s.name,
    remote: false,
    status: s.status,
    loaderType: s.loaderType,
    version: s.version,
    port: s.port,
    players: s.players,
    maxPlayers: s.maxPlayers,
    cpu: s.cpu,
    memory: s.memory,
    path: s.path,
    pid: s.pid,
    localServer: s,
  }));

  const remote: ServerCard[] = mcsmInstances.value.map(inst => ({
    id: inst.instanceUuid,
    name: inst.config?.nickname || inst.instanceUuid.slice(0, 8),
    remote: true,
    status: inst.status === 3 ? 'running' : inst.status === 2 ? 'starting' : inst.status === 1 ? 'stopping' : 'stopped',
    loaderType: inst.info?.loaderType || '',
    version: inst.info?.version || '',
    port: inst.config?.port || 0,
    cpu: inst.processInfo?.cpu || 0,
    memory: inst.processInfo?.memory || 0,
    mcsmInstance: inst,
  }));

  return [...local, ...remote];
});

// ==================== 详情抽屉 ====================
const detailDrawerVisible = ref(false);
const selectedServer = ref<ServerCard | null>(null);

function openDetail(server: ServerCard) {
  selectedServer.value = server;
  detailDrawerVisible.value = true;
}

function getStatusText(status: string): string {
  const map: Record<string, string> = {
    running: t('server.status_running'),
    stopped: t('server.status_stopped'),
    starting: t('server.status_starting'),
    stopping: t('server.status_stopping'),
  };
  return map[status] || status;
}

function getStatusBadge(status: string): string {
  const map: Record<string, string> = {
    running: 'success',
    stopped: 'default',
    starting: 'processing',
    stopping: 'warning',
  };
  return map[status] || 'default';
}

// 生命周期
onMounted(() => {
  detectJava();
  fetchLocalServers();
  localRefreshTimer.value = setInterval(fetchLocalServers, 10000);
});

onUnmounted(() => {
  if (localRefreshTimer.value) {
    clearInterval(localRefreshTimer.value);
    localRefreshTimer.value = null;
  }
});
</script>

<template>
  <div class="server-container">
    <!-- 顶部操作栏 -->
    <div class="server-toolbar">
      <h2 class="server-title">
        <CloudServerOutlined /> {{ t('server.title') }}
      </h2>
      <div class="toolbar-right">
        <a-button v-if="mcsmConnected" size="small" @click="mcsmDrawerVisible = true">
          <SettingOutlined /> {{ t('server.mcsm_config_title') }}
        </a-button>
        <a-button v-else size="small" type="dashed" @click="mcsmDrawerVisible = true">
          <GlobalOutlined /> {{ t('server.mcsm_connect') }}
        </a-button>
        <a-button size="small" @click="fetchLocalServers(); fetchMcsmInstances(); detectJava();">
          <ReloadOutlined /> {{ t('server.refresh') }}
        </a-button>
        <!-- Java 版本徽章 -->
        <a-popover
          v-model:open="javaPopoverVisible"
          trigger="click"
          placement="bottomRight"
          title="Java 版本"
        >
          <template #content>
            <div v-if="javaLoading" style="text-align:center;padding:12px;">
              <a-spin size="small" />
            </div>
            <div v-else-if="javaError" style="color:#f5222d;max-width:300px;">{{ javaError }}</div>
            <div v-else-if="javaVersions.length === 0" style="color:#999;">{{ t('server.java_not_found') }}</div>
            <div v-else class="java-popover-list">
              <div v-for="(java, i) in javaVersions" :key="i" class="java-popover-item">
                <CoffeeOutlined class="java-popover-icon" />
                <div>
                  <div class="java-popover-version">{{ java.version }}</div>
                  <div class="java-popover-vendor">{{ java.vendor }}</div>
                  <div class="java-popover-path">{{ java.path }}</div>
                </div>
              </div>
            </div>
          </template>
          <a-tag :color="primaryJava ? 'green' : 'default'" class="java-badge" @click="detectJava">
            <CoffeeOutlined />
            <span v-if="primaryJava">{{ primaryJava.version }}</span>
            <span v-else>{{ t('server.java_not_found') }}</span>
          </a-tag>
        </a-popover>
      </div>
    </div>

    <!-- 服务端卡片网格 -->
    <div class="server-grid">
      <a-spin :spinning="localLoading || mcsmInstancesLoading">
        <div v-if="allServers.length === 0 && !localLoading" class="empty-state">
          <Empty :description="t('server.local_empty')" />
        </div>
        <div v-else class="card-grid">
          <div
            v-for="server in allServers"
            :key="server.id"
            class="server-card"
            @click="openDetail(server)"
          >
            <!-- 卡片头部 -->
            <div class="card-header">
              <div class="card-name-row">
                <a-badge :status="getStatusBadge(server.status) as any" />
                <span class="card-name">{{ server.name }}</span>
              </div>
              <div class="card-tags">
                <a-tag v-if="server.remote" color="blue" size="small">
                  <GlobalOutlined /> 远程
                </a-tag>
                <a-tag v-else color="green" size="small">
                  <DesktopOutlined /> 本地
                </a-tag>
                <a-tag :color="getStatusBadge(server.status)" size="small">
                  {{ getStatusText(server.status) }}
                </a-tag>
              </div>
            </div>
            <!-- 卡片中部 -->
            <div class="card-body">
              <div class="card-info">
                <span v-if="server.loaderType" class="card-info-item">
                  <a-tag>{{ server.loaderType }}</a-tag>
                </span>
                <span v-if="server.version" class="card-info-item card-version">
                  {{ server.version }}
                </span>
              </div>
              <div class="card-meta">
                <span v-if="server.port" class="card-meta-item">
                  :{{ server.port }}
                </span>
                <span v-if="server.players !== undefined" class="card-meta-item">
                  {{ server.players }}/{{ server.maxPlayers || '?' }}
                </span>
              </div>
            </div>
            <!-- 卡片底部 -->
            <div v-if="server.status === 'running'" class="card-footer">
              <span>CPU: {{ server.cpu || 0 }}%</span>
              <span>{{ t('server.memory') }}: {{ formatBytes(server.memory || 0) }}</span>
            </div>
          </div>
        </div>
      </a-spin>
    </div>

    <!-- 详情抽屉 -->
    <a-drawer
      :title="selectedServer?.name || t('server.detail_title')"
      placement="right"
      :width="400"
      :open="detailDrawerVisible"
      @close="detailDrawerVisible = false"
    >
      <template v-if="selectedServer">
        <div class="detail-section">
          <div class="detail-row">
            <span class="detail-label">{{ t('server.detail_status') }}</span>
            <a-badge :status="getStatusBadge(selectedServer.status) as any" :text="getStatusText(selectedServer.status)" />
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('server.detail_type') }}</span>
            <a-tag :color="selectedServer.remote ? 'blue' : 'green'">
              {{ selectedServer.remote ? t('server.detail_remote') : t('server.detail_local') }}
            </a-tag>
          </div>
          <div v-if="selectedServer.loaderType" class="detail-row">
            <span class="detail-label">{{ t('server.detail_loader') }}</span>
            <span>{{ selectedServer.loaderType }}</span>
          </div>
          <div v-if="selectedServer.version" class="detail-row">
            <span class="detail-label">{{ t('server.version') }}</span>
            <span>{{ selectedServer.version }}</span>
          </div>
          <div v-if="selectedServer.port" class="detail-row">
            <span class="detail-label">{{ t('server.port') }}</span>
            <span>{{ selectedServer.port }}</span>
          </div>
          <div v-if="selectedServer.path" class="detail-row">
            <span class="detail-label">{{ t('server.detail_path') }}</span>
            <span class="detail-path">{{ selectedServer.path }}</span>
          </div>
          <div v-if="selectedServer.pid" class="detail-row">
            <span class="detail-label">PID</span>
            <span>{{ selectedServer.pid }}</span>
          </div>
        </div>

        <!-- 资源监控 -->
        <div v-if="selectedServer.status === 'running'" class="detail-section">
          <div class="detail-section-title">{{ t('server.detail_monitor') }}</div>
          <div class="detail-row">
            <span class="detail-label">CPU</span>
            <Progress :percent="selectedServer.cpu || 0" :size="'small'" :status="(selectedServer.cpu || 0) > 80 ? 'exception' : 'normal'" />
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('server.memory') }}</span>
            <span>{{ formatBytes(selectedServer.memory || 0) }}</span>
          </div>
          <div v-if="selectedServer.players !== undefined" class="detail-row">
            <span class="detail-label">{{ t('server.detail_players') }}</span>
            <span>{{ selectedServer.players }}/{{ selectedServer.maxPlayers || '?' }}</span>
          </div>
        </div>

        <!-- MCSM 额外信息 -->
        <div v-if="selectedServer.remote && selectedServer.mcsmInstance" class="detail-section">
          <div class="detail-section-title">{{ t('server.detail_node') }}</div>
          <div class="detail-row">
            <span class="detail-label">UUID</span>
            <span class="detail-path">{{ selectedServer.mcsmInstance.instanceUuid }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Daemon</span>
            <span>{{ selectedServer.mcsmInstance.daemonId }}</span>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="detail-actions">
          <template v-if="!selectedServer.remote">
            <a-button
              v-if="selectedServer.status === 'stopped'"
              type="primary" block @click="startLocalServer(selectedServer.localServer!)"
            >
              <PlayCircleOutlined /> {{ t('server.start') }}
            </a-button>
            <a-button
              v-if="selectedServer.status === 'running'"
              block @click="stopLocalServer(selectedServer.localServer!)"
            >
              <PauseCircleOutlined /> {{ t('server.stop') }}
            </a-button>
            <a-button block @click="openServerFolder(selectedServer.path!)">
              <FolderOpenOutlined /> {{ t('server.open_folder') }}
            </a-button>
            <a-button danger block @click="deleteLocalServer(selectedServer.localServer!)"
              :disabled="selectedServer.status === 'running'">
              <DeleteOutlined /> {{ t('server.delete_ok') }}
            </a-button>
          </template>
          <template v-else>
            <a-button
              v-if="selectedServer.mcsmInstance?.status === 0"
              type="primary" block @click="mcsmAction(selectedServer.mcsmInstance, 'open')"
            >
              <PlayCircleOutlined /> {{ t('server.start') }}
            </a-button>
            <a-button
              v-if="selectedServer.mcsmInstance?.status === 3"
              block @click="mcsmAction(selectedServer.mcsmInstance, 'stop')"
            >
              <PauseCircleOutlined /> {{ t('server.stop') }}
            </a-button>
            <a-button block @click="mcsmAction(selectedServer.mcsmInstance, 'restart')"
              :disabled="selectedServer.mcsmInstance?.status !== 3">
              <ReloadOutlined /> {{ t('server.restart') }}
            </a-button>
          </template>
        </div>
      </template>
    </a-drawer>

    <!-- MCSM 连接配置抽屉 -->
    <a-drawer
      :title="t('server.mcsm_config_title')"
      placement="right"
      :width="400"
      :open="mcsmDrawerVisible"
      @close="mcsmDrawerVisible = false"
    >
      <div class="mcsm-config-form">
        <div class="mcsm-field">
          <label>{{ t('server.mcsm_url') }}</label>
          <a-input v-model:value="mcsmUrl" placeholder="http://your-mcsm-panel:23333" :disabled="mcsmConnected" />
        </div>
        <div class="mcsm-field">
          <label>{{ t('server.mcsm_api_key') }}</label>
          <a-input-password v-model:value="mcsmApiKey" placeholder="API Key" :disabled="mcsmConnected" />
        </div>
        <div class="mcsm-actions">
          <a-button v-if="!mcsmConnected" type="primary" @click="connectMcsm" :loading="mcsmLoading" block>
            <ApiOutlined /> {{ t('server.mcsm_connect') }}
          </a-button>
          <a-button v-else @click="disconnectMcsm" block danger>
            <CloseCircleOutlined /> {{ t('server.mcsm_disconnect') }}
          </a-button>
        </div>
        <div v-if="mcsmError" class="error-text">{{ mcsmError }}</div>
      </div>

      <!-- 节点选择 -->
      <div v-if="mcsmConnected" class="mcsm-node-section">
        <div class="mcsm-node-label">{{ t('server.mcsm_node') }}</div>
        <a-select v-model:value="selectedNodeId" style="width: 100%" @change="fetchMcsmInstances">
          <a-select-option v-for="node in mcsmNodes" :key="node.uuid" :value="node.uuid">
            {{ node.remarks || node.ip }} ({{ node.available ? t('server.mcsm_online') : t('server.mcsm_offline') }})
          </a-select-option>
        </a-select>
      </div>
    </a-drawer>
  </div>
</template>

<style scoped>
.server-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow-y: auto;
}

/* 顶部操作栏 */
.server-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.server-title {
  font-size: 20px;
  font-weight: 700;
  color: #1a1a1a;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.java-badge {
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: 12px;
  transition: all 0.2s;
}

.java-badge:hover {
  transform: scale(1.05);
}

/* Java 弹窗 */
.java-popover-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 320px;
}

.java-popover-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  background: #f0fdf4;
  border-radius: 6px;
}

.java-popover-icon {
  margin-top: 2px;
  color: #10b981;
  font-size: 16px;
}

.java-popover-version {
  font-size: 13px;
  font-weight: 600;
  color: #1a1a1a;
}

.java-popover-vendor {
  font-size: 11px;
  color: #888;
}

.java-popover-path {
  font-size: 10px;
  color: #aaa;
  font-family: monospace;
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 空状态 */
.empty-state {
  padding: 80px 0;
}

/* 卡片网格 */
.server-grid {
  flex: 1;
  overflow-y: auto;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

/* 卡片 */
.server-card {
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.server-card:hover {
  border-color: #10b981;
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.12);
  transform: translateY(-2px);
}

.card-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-name {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-info-item {
  font-size: 12px;
}

.card-version {
  color: #666;
  font-size: 12px;
}

.card-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #888;
}

.card-meta-item {
  font-family: monospace;
}

.card-footer {
  display: flex;
  gap: 16px;
  padding-top: 10px;
  border-top: 1px solid #f0f0f0;
  font-size: 12px;
  color: #666;
}

/* 详情抽屉 */
.detail-section {
  margin-bottom: 20px;
}

.detail-section-title {
  font-size: 13px;
  font-weight: 600;
  color: #888;
  margin-bottom: 10px;
  text-transform: uppercase;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #f5f5f5;
}

.detail-label {
  font-size: 13px;
  color: #888;
  min-width: 60px;
}

.detail-path {
  font-size: 11px;
  font-family: monospace;
  color: #666;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}

/* MCSM 配置 */
.mcsm-config-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mcsm-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mcsm-field label {
  font-size: 12px;
  font-weight: 500;
  color: #666;
}

.mcsm-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.error-text {
  color: #f5222d;
  padding: 8px;
  background: #fff2f0;
  border-radius: 6px;
  font-size: 13px;
}

.mcsm-node-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}

.mcsm-node-label {
  font-size: 12px;
  font-weight: 500;
  color: #666;
  margin-bottom: 8px;
}
</style>