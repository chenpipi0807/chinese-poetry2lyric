// ============================================================
// 歌词创作助手 — 前端主逻辑
// ============================================================
(function () {
  'use strict';

  // ─── Utils ─────────────────────────────────────────────────
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  function splitLines(text) {
    return (text || '').split(/\r?\n/);
  }

  function $(id) { return document.getElementById(id); }

  // ─── Diff Engine (LCS) ─────────────────────────────────────
  const DiffOp = { EQUAL: 'equal', DELETE: 'delete', INSERT: 'insert' };

  class DiffChunk {
    constructor(op, oldLines, newLines, oldText, newText) {
      this.op = op;
      this.oldLines = oldLines;
      this.newLines = newLines;
      this.oldText = oldText;
      this.newText = newText;
      this.id = generateId();
      this.accepted = false;
      this.rejected = false;
    }
    get isChanged() { return this.op !== DiffOp.EQUAL; }
    get label() {
      return this.op === DiffOp.DELETE ? '删除' : this.op === DiffOp.INSERT ? '新增' : '';
    }
  }

  class DiffResult {
    constructor(chunks, oldLines, newLines) {
      this.chunks = chunks;
      this.oldLines = oldLines;
      this.newLines = newLines;
    }
    get hasChanges() { return this.chunks.some(c => c.isChanged); }
    get changeCount() { return this.chunks.filter(c => c.isChanged).length; }

    getAcceptedText() {
      const result = [];
      for (const chunk of this.chunks) {
        if (chunk.op === DiffOp.EQUAL) {
          result.push(...chunk.oldText);
        } else if (chunk.op === DiffOp.INSERT) {
          result.push(...(chunk.accepted ? chunk.newText : chunk.oldText));
        } else if (chunk.op === DiffOp.DELETE) {
          if (!chunk.accepted) result.push(...chunk.oldText);
        }
      }
      return result.join('\n');
    }
  }

  function computeLcsTable(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
    return dp;
  }

  function backtrack(a, b, dp, i, j, ops) {
    if (i === 0 && j === 0) return;
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
      backtrack(a, b, dp, i-1, j-1, ops);
      ops.push({ op: DiffOp.EQUAL, oldLine: i-1, newLine: j-1 });
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      backtrack(a, b, dp, i, j-1, ops);
      ops.push({ op: DiffOp.INSERT, oldLine: null, newLine: j-1 });
    } else {
      backtrack(a, b, dp, i-1, j, ops);
      ops.push({ op: DiffOp.DELETE, oldLine: i-1, newLine: null });
    }
  }

  function mergeOpsToChunks(ops, a, b) {
    if (!ops.length) return [new DiffChunk(DiffOp.EQUAL, [], [], [], [])];
    const chunks = [];
    let cur = ops[0].op, oldLs = [], newLs = [], oldT = [], newT = [];
    function flush() {
      if (oldLs.length || newLs.length)
        chunks.push(new DiffChunk(cur, oldLs, newLs, oldT, newT));
      oldLs = []; newLs = []; oldT = []; newT = [];
    }
    for (const op of ops) {
      if (op.op !== cur) { flush(); cur = op.op; }
      if (op.oldLine !== null) { oldLs.push(op.oldLine); oldT.push(a[op.oldLine]); }
      if (op.newLine !== null) { newLs.push(op.newLine); newT.push(b[op.newLine]); }
    }
    flush();
    return chunks;
  }

  function computeDiff(oldText, newText) {
    const a = splitLines(oldText);
    const b = splitLines(newText);
    const dp = computeLcsTable(a, b);
    const ops = [];
    backtrack(a, b, dp, a.length, b.length, ops);
    return new DiffResult(mergeOpsToChunks(ops, a, b), a, b);
  }

  // ─── State ─────────────────────────────────────────────────
  const state = {
    taskId: null,
    isLoading: false,
    configExpanded: false,
    ragEnabled: true,
    templateOpen: false,
    currentTemplateCat: 'poetry',
    diffState: { title: null, style: null, lyrics: null },
  };

  // ─── DOM refs ──────────────────────────────────────────────
  const dom = {
    chatMessages:    $('chat-messages'),
    chatInput:       $('chat-input'),
    btnSend:         $('btn-send'),
    btnNewTask:      $('btn-new-task'),
    taskBadge:       $('task-badge'),
    btnTemplate:     $('btn-template'),
    templatePanel:   $('template-panel'),
    templateTabs:    $('template-tabs'),
    templateList:    $('template-list'),
    loadingOverlay:  $('loading-overlay'),
    loadingText:     $('loading-text'),
    ragToggle:       $('rag-toggle'),
    ragToggleLabel:  $('rag-toggle-label'),
    ragHint:         $('rag-hint'),
    chkAll:          $('chk-all'),
    chkTitle:        $('chk-title'),
    chkStyle:        $('chk-style'),
    chkLyrics:       $('chk-lyrics'),
    apiConfig:       $('api-config'),
    configHeader:    $('config-header'),
    configBody:      $('config-body'),
    configToggle:    $('config-toggle'),
    apiKeyInput:     $('api-key'),
    modelSelect:     $('model-select'),
    btnSaveSettings: $('btn-save-settings'),
    btnTestKey:      $('btn-test-key'),
    btnToggleKey:    $('btn-toggle-key'),
    settingsStatus:  $('settings-status'),
    apiStatusChip:   $('api-status-chip'),
    btnSettingsToggle: $('btn-settings-toggle'),
    resizeHandle:    $('resize-handle'),
    // Action buttons
    btnPolish:   $('btn-action-polish'),
    btnRewrite:  $('btn-action-rewrite'),
    btnContinue: $('btn-action-continue'),
    // History drawer
    btnHistory:      $('btn-history'),
    historyPanel:    $('history-panel'),
    historyOverlay:  $('history-overlay'),
    historyList:     $('history-list'),
    btnCloseHistory: $('btn-close-history'),
  };

  const FIELDS = ['title', 'style', 'lyrics'];

  function textarea(field) { return $(`textarea-${field}`); }
  function diffView(field) { return $(`diff-${field}`); }
  function diffActions(field) { return $(`diff-actions-${field}`); }
  function diffBadge(field) { return $(`badge-${field}`); }

  // ─── Init ──────────────────────────────────────────────────
  async function init() {
    await loadSettings();
    await createNewTask();
    bindEvents();
    initCheckboxes();
    initResizeHandle();
  }

  // ─── Settings ──────────────────────────────────────────────
  async function loadSettings() {
    try {
      const r = await fetch('/api/settings');
      const d = await r.json();
      if (d.api_key_set) {
        dom.apiKeyInput.value = d.api_key_preview || '';
        dom.apiStatusChip.textContent = '✅ 已配置';
        dom.apiStatusChip.style.color = 'var(--success)';
      } else {
        dom.apiStatusChip.textContent = '⚠ 未配置';
        dom.apiStatusChip.style.color = 'var(--danger)';
        // Auto-expand settings if no key
        setConfigExpanded(true);
        dom.apiConfig.classList.add('unconfigured');
      }
      if (d.model) dom.modelSelect.value = d.model;
    } catch (e) { /* server not ready yet */ }
  }

  async function saveSettings() {
    const apiKey = dom.apiKeyInput.value.trim();
    const model = dom.modelSelect.value;
    if (!apiKey || apiKey.startsWith('*')) {
      showSettingsStatus('请输入有效的 API Key', 'error');
      return;
    }
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, model }),
    });
    showSettingsStatus('保存成功 ✅', 'success');
    dom.apiStatusChip.textContent = '✅ 已配置';
    dom.apiStatusChip.style.color = 'var(--success)';
    dom.apiConfig.classList.remove('unconfigured');
  }

  async function testKey() {
    const apiKey = dom.apiKeyInput.value.trim();
    if (!apiKey || apiKey.startsWith('*')) {
      showSettingsStatus('请先输入 API Key', 'error');
      return;
    }
    showSettingsStatus('测试中...', 'info');
    dom.btnTestKey.disabled = true;
    try {
      const r = await fetch('/api/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey }),
      });
      const d = await r.json();
      if (d.ok) showSettingsStatus('连接成功 ✅ API Key 有效', 'success');
      else showSettingsStatus(`连接失败: ${d.error}`, 'error');
    } catch (e) {
      showSettingsStatus(`网络错误: ${e.message}`, 'error');
    } finally {
      dom.btnTestKey.disabled = false;
    }
  }

  function showSettingsStatus(msg, type) {
    dom.settingsStatus.textContent = msg;
    dom.settingsStatus.className = 'form-status' + (type ? ` ${type}` : '');
    dom.settingsStatus.style.display = 'block';
  }

  function setConfigExpanded(val) {
    state.configExpanded = val;
    dom.configBody.style.display = val ? 'block' : 'none';
    dom.configToggle.textContent = val ? '▼' : '▶';
  }

  // ─── Task Management ───────────────────────────────────────
  async function createNewTask() {
    const r = await fetch('/api/task/new', { method: 'POST' });
    const d = await r.json();
    state.taskId = d.task_id;
    dom.taskBadge.textContent = `任务 ${state.taskId}`;
  }

  async function newTask() {
    // Clear editors
    FIELDS.forEach(f => {
      exitDiffMode(f);
      textarea(f).value = '';
    });
    // Clear chat
    dom.chatMessages.innerHTML = `
      <div class="message ai">
        <div class="message-avatar">AI</div>
        <div class="message-content">
          <p>新任务已开始，历史已清除。</p>
          <p>输入关键词或描述开始创作。</p>
        </div>
      </div>`;
    await createNewTask();
  }

  // ─── Target Fields ─────────────────────────────────────────
  function initCheckboxes() {
    dom.chkAll.addEventListener('change', () => {
      if (dom.chkAll.checked) {
        dom.chkTitle.checked = false;
        dom.chkStyle.checked = false;
        dom.chkLyrics.checked = false;
      }
    });
    [dom.chkTitle, dom.chkStyle, dom.chkLyrics].forEach(chk => {
      chk.addEventListener('change', () => {
        if (chk.checked) dom.chkAll.checked = false;
      });
    });
  }

  function getTargetFields() {
    if (dom.chkAll.checked) return ['title', 'style', 'lyrics'];
    const f = [];
    if (dom.chkTitle.checked)  f.push('title');
    if (dom.chkStyle.checked)  f.push('style');
    if (dom.chkLyrics.checked) f.push('lyrics');
    return f.length ? f : ['title', 'style', 'lyrics'];
  }

  function getEditorContext() {
    return {
      title:  textarea('title').value.trim(),
      style:  textarea('style').value.trim(),
      lyrics: textarea('lyrics').value.trim(),
    };
  }

  // ─── RAG ───────────────────────────────────────────────────
  function _isKeywordLike(t) {
    if (t.length < 1 || t.length > 12) return false;
    if (/[\n，。！？,.!?、；：""''（）【】]/.test(t)) return false;
    const sentenceStarters = /^(以|写|帮|请|创|生|想|让|需|把|将|根|基|按|用|做|来|去|是|有|在|从|到)/;
    if (sentenceStarters.test(t)) return false;
    return true;
  }

  // Returns the keyword to RAG-search, or null if RAG should be skipped.
  // Handles three cases:
  //   1. Short direct keyword ("青青")
  //   2. Template message — long body, but ends with a short keyword the user typed in
  //      e.g. "...用户提供的古诗词如下：\n青青"
  //   3. Long natural-language request → null (skip RAG)
  function extractRagKeyword(text) {
    const t = text.trim();

    // Case 1: the whole message is a simple keyword
    if (_isKeywordLike(t) && !t.includes('\n')) return t;

    // Case 2: template pattern — look for "如下：\n<short term>" at the end
    if (t.length > 80) {
      const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        const last = lines[lines.length - 1];
        const secondLast = lines[lines.length - 2];
        // Last line is a short content insertion after a "如下：" style line
        const isAfterIntro = /[下词材容]+[：:]\s*$/.test(secondLast) || /\{\{/.test(last);
        // Skip placeholder lines
        if (!last.includes('{{') && !last.includes('请在此') && _isKeywordLike(last)) {
          if (isAfterIntro || secondLast.length > 10) {
            return last;
          }
        }
      }
    }

    return null;
  }

  async function doRagSearch(keyword) {
    const r = await fetch('/api/rag/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword }),
    });
    return r.json();
  }

  async function doAgentSearch(keyword) {
    const r = await fetch('/api/rag/agent-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword }),
    });
    return r.json();
  }

  function showRagCard(results, keyword, agentKeywords) {
    if (!results || !results.length) return;

    const card = document.createElement('div');
    card.className = 'rag-card';

    let headerTitle = `📚 RAG 参考「${keyword}」— 找到 ${results.length} 首相关诗词`;
    if (agentKeywords && agentKeywords.length) {
      headerTitle += ` · 扩展词：${agentKeywords.join('、')}`;
    }

    const header = document.createElement('div');
    header.className = 'rag-card-header';
    header.innerHTML = `<span class="rag-card-title-text">${escapeHtml(headerTitle)}</span><span class="rag-expand-btn">▶ 展开</span>`;

    const content = document.createElement('div');
    content.className = 'rag-card-content';
    content.style.display = 'none';

    let html = '';
    for (const poem of results.slice(0, 15)) {
      const pTitle = poem.title || '无题';
      const author = poem.author || '佚名';
      const lines = (poem.lines || []).slice(0, 4).join('\n');
      const matched = poem.matched_keyword ? ` (${poem.matched_keyword})` : '';
      html += `
        <div class="rag-poem">
          <div class="rag-poem-header">《${escapeHtml(pTitle)}》— ${escapeHtml(author)}${escapeHtml(matched)}</div>
          <div class="rag-poem-lines">${escapeHtml(lines)}</div>
        </div>`;
    }
    content.innerHTML = html;

    header.addEventListener('click', () => {
      const expanded = content.style.display !== 'none';
      content.style.display = expanded ? 'none' : 'block';
      header.querySelector('.rag-expand-btn').textContent = expanded ? '▶ 展开' : '▼ 收起';
    });

    card.appendChild(header);
    card.appendChild(content);
    dom.chatMessages.appendChild(card);
    scrollChatToBottom();
  }

  // ─── Chat / Send ───────────────────────────────────────────
  async function sendMessage(overrideText) {
    const text = overrideText || dom.chatInput.value.trim();
    if (!text || state.isLoading) return;
    if (!overrideText) dom.chatInput.value = '';

    addUserMessage(text);

    const ragEnabled = dom.ragToggle.checked;
    const targetFields = getTargetFields();
    const context = getEditorContext();

    let ragResults = [];
    let agentKeywords = [];

    // RAG phase — triggered for simple keywords OR template messages with a short keyword at the end
    const ragKeyword = ragEnabled ? extractRagKeyword(text) : null;
    if (ragKeyword) {
      showLoading('RAG 检索中...');

      const ragData = await doRagSearch(ragKeyword);
      if (ragData.results && ragData.results.length) {
        ragResults = ragData.results;
        showRagCard(ragResults, ragKeyword, null);
        dom.ragHint.textContent = `找到 ${ragResults.length} 首相关诗词`;
      } else {
        // Agent decides to search related keywords
        addAIMessage(`🔍 「${ragKeyword}」未直接匹配，正在智能扩展搜索词...`);
        const agentData = await doAgentSearch(ragKeyword);
        if (agentData.results && agentData.results.length) {
          ragResults = agentData.results;
          agentKeywords = agentData.keywords || [];
          showRagCard(ragResults, ragKeyword, agentKeywords);
          dom.ragHint.textContent = `扩展搜索找到 ${ragResults.length} 首相关诗词`;
        } else {
          dom.ragHint.textContent = '未找到相关诗词，直接创作';
        }
      }
    } else if (ragEnabled) {
      dom.ragHint.textContent = '非关键词输入，直接创作';
    }

    // Stream AI response
    showLoading('AI 创作中...');

    let streamEl = null;
    let streamText = '';

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: state.taskId,
          message: text,
          context,
          rag_results: ragResults,
          target_fields: targetFields,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        addAIMessage(`❌ ${err.error || '请求失败'}`);
        hideLoading();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          const raw = part.slice(6);
          let evt;
          try { evt = JSON.parse(raw); } catch { continue; }

          if (evt.type === 'chunk') {
            streamText += evt.content;
            if (!streamEl) {
              streamEl = document.createElement('div');
              streamEl.className = 'ai-message streaming';
              dom.chatMessages.appendChild(streamEl);
            }
            streamEl.textContent = streamText;
            scrollChatToBottom();

          } else if (evt.type === 'done') {
            if (streamEl) { streamEl.remove(); streamEl = null; }
            hideLoading();
            applyAiParts(evt.parts, context);
            // Persist AI output immediately — merge new parts over the context we sent.
            // This runs before the user reviews diffs, so the latest AI content is always saved.
            if (evt.parts && Object.keys(evt.parts).length) {
              const merged = { ...context };
              for (const [k, v] of Object.entries(evt.parts)) {
                if (v) merged[k] = v;
              }
              saveContextToServer(merged);
            }

          } else if (evt.type === 'error') {
            if (streamEl) { streamEl.remove(); streamEl = null; }
            hideLoading();
            addAIMessage(`❌ ${evt.error}`);
          }
        }
      }
      hideLoading();
    } catch (e) {
      hideLoading();
      if (streamEl) { streamEl.remove(); }
      addAIMessage(`❌ 网络错误: ${e.message}`);
    }
  }

  // ─── Apply AI parts to editors ─────────────────────────────
  function applyAiParts(parts, originalContext) {
    if (!parts || !Object.keys(parts).length) {
      addAIMessage('⚠ AI 未返回有效内容，请重试');
      return;
    }

    const changedFields = [];
    for (const field of FIELDS) {
      const newVal = (parts[field] || '').trim();
      if (!newVal) continue;
      const oldVal = (originalContext[field] || '').trim();
      const diff = computeDiff(oldVal, newVal);

      changedFields.push(field);
      if (diff.hasChanges) {
        enterDiffMode(field, diff);
      } else {
        textarea(field).value = newVal;
      }
    }

    if (changedFields.length) {
      const labels = { title: '标题', style: '风格描述', lyrics: '歌词' };
      const fieldNames = changedFields.map(f => labels[f]).join('、');
      addAIMessage(`✅ 已更新「${fieldNames}」，请在左侧查看变更（绿=新增，红=删除）`);
    } else {
      addAIMessage('AI 已响应，但无字段变更。');
    }
  }

  // ─── Action shortcuts (润色/重写/续写) ─────────────────────
  function sendActionMessage(action) {
    const labels = { polish: '润色', rewrite: '重写', continue: '续写' };
    const targets = { polish: '歌词', rewrite: '歌词', continue: '歌词' };
    dom.chkAll.checked = false;
    dom.chkTitle.checked = false;
    dom.chkStyle.checked = false;
    dom.chkLyrics.checked = true;
    const msg = `请${labels[action]}以下歌词，保持原有主题：\n${textarea('lyrics').value || '（歌词为空，请先生成歌词）'}`;
    dom.chatInput.value = msg;
  }

  // ─── Diff Mode ─────────────────────────────────────────────
  function enterDiffMode(field, diffResult) {
    state.diffState[field] = diffResult;

    textarea(field).style.display = 'none';
    const dv = diffView(field);
    dv.style.display = 'block';
    dv.innerHTML = '';

    renderDiffTable(field, diffResult, dv);

    const badge = diffBadge(field);
    badge.textContent = `${diffResult.changeCount} 处变更`;
    badge.style.display = 'inline-block';
    diffActions(field).style.display = 'flex';
  }

  function exitDiffMode(field) {
    state.diffState[field] = null;
    textarea(field).style.display = '';
    diffView(field).style.display = 'none';
    diffView(field).innerHTML = '';
    diffBadge(field).style.display = 'none';
    diffActions(field).style.display = 'none';
  }

  function renderDiffTable(field, diffResult, container) {
    const table = document.createElement('div');
    table.className = 'diff-table';

    for (const chunk of diffResult.chunks) {
      if (chunk.isChanged) {
        const bar = document.createElement('div');
        bar.className = 'diff-chunk-actions';
        bar.dataset.chunkId = chunk.id;

        const lbl = document.createElement('span');
        lbl.className = 'chunk-label';
        lbl.textContent = chunk.label;
        bar.appendChild(lbl);

        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'chunk-btn accept';
        acceptBtn.textContent = '⭕ 接受';
        acceptBtn.addEventListener('click', () => toggleChunkAccept(field, chunk.id));
        bar.appendChild(acceptBtn);

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'chunk-btn reject';
        rejectBtn.textContent = '❌ 拒绝';
        rejectBtn.addEventListener('click', () => toggleChunkReject(field, chunk.id));
        bar.appendChild(rejectBtn);

        table.appendChild(bar);
      }

      const maxLines = Math.max(chunk.oldText.length, chunk.newText.length, 1);
      for (let i = 0; i < maxLines; i++) {
        const row = document.createElement('div');
        row.className = 'diff-row';
        row.dataset.chunkId = chunk.id;

        const left = document.createElement('div');
        left.className = `diff-cell old ${chunk.op === DiffOp.DELETE ? 'delete' : chunk.op === DiffOp.EQUAL ? 'equal' : ''}`;
        left.textContent = i < chunk.oldText.length ? chunk.oldText[i] : '';
        row.appendChild(left);

        const right = document.createElement('div');
        right.className = `diff-cell ${chunk.op === DiffOp.INSERT ? 'insert' : chunk.op === DiffOp.EQUAL ? 'equal' : ''}`;
        right.textContent = i < chunk.newText.length ? chunk.newText[i] : '';
        row.appendChild(right);

        table.appendChild(row);
      }
    }

    container.appendChild(table);
  }

  function toggleChunkAccept(field, chunkId) {
    const dr = state.diffState[field];
    if (!dr) return;
    const chunk = dr.chunks.find(c => c.id === chunkId);
    if (!chunk || chunk.rejected) return;
    chunk.accepted = !chunk.accepted;
    updateChunkUI(field, chunk);
    checkAutoApply(field);
  }

  function toggleChunkReject(field, chunkId) {
    const dr = state.diffState[field];
    if (!dr) return;
    const chunk = dr.chunks.find(c => c.id === chunkId);
    if (!chunk || chunk.accepted) return;
    chunk.rejected = !chunk.rejected;
    updateChunkUI(field, chunk);
    checkAutoApply(field);
  }

  function updateChunkUI(field, chunk) {
    const dv = diffView(field);
    const bar = dv.querySelector(`.diff-chunk-actions[data-chunk-id="${chunk.id}"]`);
    if (bar) {
      const acceptBtn = bar.querySelector('.accept, .accepted');
      const rejectBtn = bar.querySelector('.reject, .rejected');
      if (chunk.accepted) {
        acceptBtn.className = 'chunk-btn accepted'; acceptBtn.textContent = '✅ 已接受';
        rejectBtn.className = 'chunk-btn reject';  rejectBtn.textContent = '❌ 拒绝';
      } else if (chunk.rejected) {
        rejectBtn.className = 'chunk-btn rejected'; rejectBtn.textContent = '❌ 已拒绝';
        acceptBtn.className = 'chunk-btn accept';  acceptBtn.textContent = '⭕ 接受';
      } else {
        acceptBtn.className = 'chunk-btn accept'; acceptBtn.textContent = '⭕ 接受';
        rejectBtn.className = 'chunk-btn reject'; rejectBtn.textContent = '❌ 拒绝';
      }
    }

    dv.querySelectorAll(`.diff-row[data-chunk-id="${chunk.id}"]`).forEach(row => {
      const lc = row.querySelector('.diff-cell.old');
      const rc = row.querySelector('.diff-cell:not(.old)');
      if (chunk.accepted) {
        if (chunk.op === DiffOp.DELETE) { lc.style.display = 'none'; rc.style.display = 'none'; }
        else if (chunk.op === DiffOp.INSERT) { lc.style.display = 'none'; rc.className = 'diff-cell insert'; }
      } else if (chunk.rejected) {
        if (chunk.op === DiffOp.INSERT) { lc.style.display = 'none'; rc.style.display = 'none'; }
        else if (chunk.op === DiffOp.DELETE) { rc.style.display = 'none'; lc.className = 'diff-cell old equal'; lc.style.textDecoration = 'none'; }
      } else {
        lc.style.display = ''; rc.style.display = '';
        if (chunk.op === DiffOp.DELETE) lc.className = 'diff-cell old delete';
        else if (chunk.op === DiffOp.INSERT) rc.className = 'diff-cell insert';
      }
    });
  }

  function checkAutoApply(field) {
    const dr = state.diffState[field];
    if (!dr) return;
    const changed = dr.chunks.filter(c => c.isChanged);
    const decided = changed.filter(c => c.accepted || c.rejected).length;
    if (decided >= changed.length) applyDiffField(field);
  }

  function applyDiffField(field) {
    const dr = state.diffState[field];
    if (!dr) return;
    textarea(field).value = dr.getAcceptedText();
    exitDiffMode(field);
    scheduleAutoSave();
  }

  function acceptAllDiff(field) {
    const dr = state.diffState[field];
    if (!dr) return;
    dr.chunks.forEach(c => { if (c.isChanged) { c.accepted = true; c.rejected = false; updateChunkUI(field, c); } });
    applyDiffField(field);
  }

  function rejectAllDiff(field) {
    const dr = state.diffState[field];
    if (!dr) return;
    dr.chunks.forEach(c => { if (c.isChanged) { c.rejected = true; c.accepted = false; updateChunkUI(field, c); } });
    applyDiffField(field);
  }

  // ─── Chat UI ───────────────────────────────────────────────
  function addUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'message user';
    div.innerHTML = `<div class="message-avatar">👤</div><div class="message-content"><p>${escapeHtml(text).replace(/\n/g, '<br>')}</p></div>`;
    dom.chatMessages.appendChild(div);
    scrollChatToBottom();
  }

  function addAIMessage(text) {
    const div = document.createElement('div');
    div.className = 'message ai';
    const fmt = escapeHtml(text).replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    div.innerHTML = `<div class="message-avatar">🤖</div><div class="message-content"><p>${fmt}</p></div>`;
    dom.chatMessages.appendChild(div);
    scrollChatToBottom();
  }

  function scrollChatToBottom() {
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  // ─── Loading ───────────────────────────────────────────────
  function showLoading(msg) {
    state.isLoading = true;
    dom.loadingOverlay.style.display = 'flex';
    dom.loadingText.textContent = msg || 'AI 思考中...';
    dom.btnSend.disabled = true;
  }

  function hideLoading() {
    state.isLoading = false;
    dom.loadingOverlay.style.display = 'none';
    dom.btnSend.disabled = false;
  }

  // ─── Templates ─────────────────────────────────────────────
  const PROMPT_TEMPLATES = {
    poetry: [
      {
        id: 'poetry-rap',
        name: '国风 × 说唱',
        desc: '保留意象，融入说唱节奏与押韵',
        text: `你是一位精通中国传统诗词与现代说唱的跨界创作人。请根据我提供的古诗词，创作一首国风说唱风格的歌词。

创作规则：
- 保留原诗词的核心意象与情感基调，忽略虚词语气词
- 句式讲究对仗，节奏朗朗上口，押韵自然
- 融入现代说唱的流动感，但维持古典美感
- 允许扩展原诗词意境，不偏离主题
- 结构：主歌（叙事铺垫）→ 副歌（情感爆发）→ 主歌 → 副歌 → outro

请直接输出以下格式：

===风格描述===
[详细风格定位：曲风类型（国风说唱/古风戏腔/流行/渐进等可组合）、演唱形式（独唱/男女对唱等）、节奏特点与BPM建议、主要乐器搭配、情感基调，100字以上]

===歌词===
[完整歌词，标注【主歌】【副歌】【Outro】等结构]

===标题===
[建议歌名]

用户提供的古诗词如下：
{{请在此粘贴古诗词内容}}`,
      },
      {
        id: 'poetry-xiqu',
        name: '古韵 × 戏腔',
        desc: '戏曲叙事结构，起承转合，典雅对偶',
        text: `你是一位融合传统戏曲与现代国风流行的音乐创作专家。请根据我提供的古诗词，创作一首古风戏腔风格的歌词。

创作规则：
- 以诗词中最具画面感的意象作为歌词核心意象
- 采用戏曲叙事结构：起（铺陈）→ 承（深入）→ 转（峰回路转）→ 合（升华）
- 语言典雅，大量使用四字格和对偶句
- 保留原诗词最美的原句，可直接引用或化用
- 设计专门的"戏腔段"，模拟戏曲唱腔语感

请直接输出以下格式：

===风格描述===
[详细风格定位：曲风类型（国风说唱/古风戏腔/流行/渐进等可组合）、演唱形式（独唱/男女对唱等）、节奏特点与BPM建议、主要乐器搭配、情感基调，100字以上]

===歌词===
[完整歌词，标注【主歌A】【主歌B】【副歌】【戏腔段】等]

===标题===
[建议歌名]

用户提供的古诗词如下：
{{请在此粘贴古诗词内容}}`,
      },
      {
        id: 'poetry-story',
        name: '诗词 × 故事融合',
        desc: '先构建与诗词契合的故事，再交织入歌词',
        text: `你是一位擅长以古诗词为灵感进行叙事创作的词曲人。请根据我提供的古诗词，先构建一个与之意境契合的故事，再将故事与诗词交织融合成歌词。

创作规则：
- 从诗词中提炼人物处境、时代背景和情感核心
- 构建一个具体的叙事场景（有人物、有事件、有情感转折）
- 歌词将故事叙述与诗词意象交替呈现，相互映衬
- 原诗词最美的句子直接引用或保留在副歌的高光位置
- 结构完整：铺垫 → 矛盾 → 高潮 → 余韵

请按以下格式输出：

===风格描述===
[详细风格定位：曲风类型（国风说唱/古风戏腔/流行/渐进等可组合）、演唱形式（独唱/男女对唱等）、节奏特点与BPM建议、主要乐器搭配、情感基调，100字以上]

===歌词===
[完整歌词]

===标题===
[建议歌名]

用户提供的古诗词如下：
{{请在此粘贴古诗词内容}}`,
      },
    ],
    prose: [
      {
        id: 'prose-lovesong',
        name: '散文 × 情歌',
        desc: '保留散文温度，转化为细腻流行情歌',
        text: `你是一位将文学散文转化为流行音乐的创作人。请根据我提供的散文片段，创作一首情感细腻的流行情歌歌词。

创作规则：
- 提炼散文中最动人的情感核心与关键意象
- 将散文的长句转化为简洁有力的歌词语言
- 保持原散文的情绪温度，不过度煽情
- 散文中最美的句子可直接化用进副歌
- 节奏感强，易于谱曲，有明显的主歌/副歌情感落差

请直接输出以下格式：

===风格描述===
[详细风格定位：曲风类型（国风说唱/古风戏腔/流行/渐进等可组合）、演唱形式（独唱/男女对唱等）、节奏特点与BPM建议、主要乐器搭配、情感基调，100字以上]

===歌词===
[完整歌词，标注【主歌】【副歌】]

===标题===
[建议歌名]

用户提供的散文片段如下：
{{请在此粘贴散文内容}}`,
      },
      {
        id: 'prose-ambient',
        name: '散文 × 氛围感',
        desc: '意象堆叠，沉浸式，偏民谣/indie风格',
        text: `你是一位专注于氛围感音乐创作的词人，风格接近民谣、indie folk 或后摇的文学性。请根据我提供的散文片段，创作一首意境深远、画面感极强的氛围歌词。

创作规则：
- 重点提炼散文中的环境描写、感官意象（光线、气味、声音、触感）
- 歌词可以更诗化、抽象，不必每句都叙事
- 允许大量意象堆叠，用具体细节营造沉浸感
- 情感不外露，藏在意象之中，让听众自行感受
- 语言有克制的美感，不华丽不空洞

请直接输出以下格式：

===风格描述===
[详细风格定位：曲风类型（国风说唱/古风戏腔/流行/渐进等可组合）、演唱形式（独唱/男女对唱等）、节奏特点与BPM建议、主要乐器搭配、情感基调，100字以上]

===歌词===
[完整歌词]

===标题===
[建议歌名]

用户提供的散文片段如下：
{{请在此粘贴散文内容}}`,
      },
    ],
    novel: [
      {
        id: 'novel-theme',
        name: '小说 × 主题曲',
        desc: '提炼核心主题，独立成立的主题曲',
        text: `你是一位专业的影视/小说配乐创作人。请根据我提供的小说内容，创作一首契合该小说气质的主题曲歌词。

创作规则：
- 提炼小说的核心主题、情感基调和人物关系
- 歌词须能独立成立，脱离小说背景也能打动人
- 保留小说中最有张力的意象或金句，化用进副歌
- 风格须与小说类型匹配（古风/现代/奇幻/悬疑等）
- 结构上有电影感：引子 → 主歌（铺垫）→ 副歌（爆发）→ 桥段（转折）→ 尾声

请直接输出以下格式：

===风格描述===
[详细风格定位：曲风类型（国风说唱/古风戏腔/流行/渐进等可组合）、演唱形式（独唱/男女对唱等）、节奏特点与BPM建议、主要乐器搭配、情感基调，100字以上]

===歌词===
[完整歌词]

===标题===
[建议歌名]

用户提供的小说内容如下：
{{请在此粘贴小说段落（建议500字以内的关键场景）}}`,
      },
      {
        id: 'novel-character',
        name: '小说 × 角色视角',
        desc: '选最有张力的角色，以第一人称写心声',
        text: `你是一位擅长角色内心创作的音乐人。请根据我提供的小说内容，选取其中最具戏剧张力的角色，以该角色的第一人称视角创作一首情感真实的歌词。

创作规则：
- 先判断最适合演唱的角色（说明理由）
- 以该角色的内心独白或情感宣泄为歌词主线
- 保留角色在小说中标志性的语气和情感特征
- 情感有层次：压抑 → 挣扎 → 爆发 → 释然（或崩溃）
- 允许结合小说情节进行戏剧性的二次创作，但不改变角色核心性格

请按以下格式输出：

===风格描述===
[详细风格定位：曲风类型（国风说唱/古风戏腔/流行/渐进等可组合）、演唱形式（独唱/男女对唱等）、节奏特点与BPM建议、主要乐器搭配、情感基调，100字以上]

===歌词===
[完整歌词，第一人称]

===标题===
[建议歌名]

用户提供的小说内容如下：
{{请在此粘贴小说段落（建议500字以内的关键场景）}}`,
      },
    ],
  };

  function renderTemplateList(cat) {
    const list = PROMPT_TEMPLATES[cat] || [];
    dom.templateList.innerHTML = list.map(t =>
      `<button class="tmpl-btn" data-id="${t.id}">
        <div class="tmpl-btn-name">${t.name}</div>
        <div class="tmpl-btn-desc">${t.desc}</div>
      </button>`
    ).join('');

    dom.templateList.querySelectorAll('.tmpl-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const tmpl = Object.values(PROMPT_TEMPLATES).flat().find(t => t.id === id);
        if (!tmpl) return;
        dom.chatInput.value = tmpl.text;
        const phStart = tmpl.text.indexOf('{{');
        const phEnd = tmpl.text.indexOf('}}') + 2;
        if (phStart !== -1) {
          dom.chatInput.focus();
          dom.chatInput.setSelectionRange(phStart, phEnd);
        } else {
          dom.chatInput.focus();
        }
        toggleTemplatePanel(false);
      });
    });
  }

  function toggleTemplatePanel(force) {
    state.templateOpen = force !== undefined ? force : !state.templateOpen;
    dom.templatePanel.style.display = state.templateOpen ? 'flex' : 'none';
    dom.btnTemplate.style.borderColor = state.templateOpen ? 'var(--accent)' : '';
    dom.btnTemplate.style.color = state.templateOpen ? 'var(--accent)' : '';
    if (state.templateOpen) renderTemplateList(state.currentTemplateCat);
  }

  // ─── Resize handle ─────────────────────────────────────────
  function initResizeHandle() {
    const handle = dom.resizeHandle;
    const input = dom.chatInput;
    if (!handle || !input) return;
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = input.offsetHeight;
      handle.classList.add('dragging');
      const onMove = ev => {
        const delta = startY - ev.clientY;
        const newH = Math.min(window.innerHeight * 0.55, Math.max(60, startH + delta));
        input.style.height = newH + 'px';
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ─── History Drawer ────────────────────────────────────────
  function formatRelTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1)   return '刚刚';
    if (mins < 60)  return `${mins}分钟前`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)   return `${hrs}小时前`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return '昨天';
    if (days < 30)  return `${days}天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }

  function inferUpdatedFields(content) {
    const fields = [];
    if (/===\s*标题\s*===/.test(content))    fields.push('标题');
    if (/===\s*风格描述\s*===/.test(content)) fields.push('风格描述');
    if (/===\s*歌词\s*===/.test(content))    fields.push('歌词');
    if (fields.length) return fields;
    try {
      const p = JSON.parse(content.trim());
      if (p.title)  fields.push('标题');
      if (p.style)  fields.push('风格描述');
      if (p.lyrics) fields.push('歌词');
    } catch {}
    return fields;
  }

  function renderChatHistory(history) {
    dom.chatMessages.innerHTML = '';
    if (!history || !history.length) {
      dom.chatMessages.innerHTML = `
        <div class="message ai">
          <div class="message-avatar">🤖</div>
          <div class="message-content"><p>任务已加载，继续对话或修改内容。</p></div>
        </div>`;
      return;
    }
    for (const msg of history) {
      if (msg.role === 'user') {
        addUserMessage(msg.content);
      } else if (msg.role === 'assistant') {
        const fields = inferUpdatedFields(msg.content);
        if (fields.length) {
          addAIMessage(`✅ 已更新「${fields.join('、')}」`);
        } else {
          const preview = msg.content.slice(0, 80).replace(/\n/g, ' ');
          addAIMessage(preview + (msg.content.length > 80 ? '…' : ''));
        }
      }
    }
  }

  function toggleHistoryPanel(force) {
    const open = force !== undefined ? force : !dom.historyPanel.classList.contains('open');
    dom.historyPanel.classList.toggle('open', open);
    dom.historyOverlay.classList.toggle('open', open);
    if (open) loadHistoryList();
  }

  async function loadHistoryList() {
    dom.historyList.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:11px;">加载中...</div>';
    try {
      const r = await fetch('/api/tasks');
      const d = await r.json();
      renderHistoryList(d.tasks || []);
    } catch (e) {
      dom.historyList.innerHTML = `<div style="padding:12px;color:var(--danger);font-size:11px;">加载失败: ${e.message}</div>`;
    }
  }

  function renderHistoryList(taskList) {
    if (!taskList.length) {
      dom.historyList.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:11px;">暂无历史任务</div>';
      return;
    }
    dom.historyList.innerHTML = taskList.map(t => {
      const isActive = t.task_id === state.taskId;
      const displayName = t.title || (t.preview ? t.preview.slice(0, 20) : '') || '未命名任务';
      const msgLabel = t.message_count ? `${t.message_count} 条对话` : '无对话';
      const preview = t.preview || '';
      return `
        <div class="history-item${isActive ? ' active' : ''}" data-task-id="${t.task_id}">
          <div class="history-item-title">${escapeHtml(displayName)}</div>
          ${preview ? `<div class="history-item-preview">${escapeHtml(preview.slice(0, 40))}${preview.length > 40 ? '…' : ''}</div>` : ''}
          <div class="history-item-meta">
            <span>${formatRelTime(t.updated_at)}</span>
            <span>${msgLabel}</span>
          </div>
          <button class="history-item-del" data-task-id="${t.task_id}" title="删除此任务">🗑</button>
        </div>`;
    }).join('');

    dom.historyList.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.history-item-del')) return;
        switchTask(el.dataset.taskId);
      });
    });

    dom.historyList.querySelectorAll('.history-item-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        if (!confirm('确定删除此任务？操作不可恢复。')) return;
        await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
        if (state.taskId === taskId) await newTask();
        loadHistoryList();
      });
    });
  }

  async function switchTask(taskId) {
    try {
      const r = await fetch(`/api/tasks/${taskId}`);
      if (!r.ok) { addAIMessage('❌ 无法加载任务'); return; }
      const data = await r.json();

      // Exit any active diff modes and restore editor content
      FIELDS.forEach(f => exitDiffMode(f));
      textarea('title').value  = data.context?.title  || '';
      textarea('style').value  = data.context?.style  || '';
      textarea('lyrics').value = data.context?.lyrics || '';

      // Update task state
      state.taskId = taskId;
      dom.taskBadge.textContent = `任务 ${taskId}`;

      // Restore chat
      renderChatHistory(data.history || []);

      toggleHistoryPanel(false);
    } catch (e) {
      addAIMessage(`❌ 加载任务失败: ${e.message}`);
    }
  }

  function saveContextToServer(ctx) {
    if (!state.taskId) return;
    fetch(`/api/tasks/${state.taskId}/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: ctx }),
    }).catch(() => {});
  }

  // Auto-save context when user edits a textarea directly
  let _autoSaveTimer = null;
  function scheduleAutoSave() {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(() => {
      if (!state.taskId) return;
      saveContextToServer(getEditorContext());
    }, 1500);
  }

  // ─── Event Binding ─────────────────────────────────────────
  function bindEvents() {
    dom.btnSend.addEventListener('click', () => sendMessage());
    dom.chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    dom.btnNewTask.addEventListener('click', newTask);

    // History drawer
    dom.btnHistory.addEventListener('click', () => toggleHistoryPanel());
    dom.btnCloseHistory.addEventListener('click', () => toggleHistoryPanel(false));
    dom.historyOverlay.addEventListener('click', () => toggleHistoryPanel(false));

    // Auto-save context on textarea edits
    FIELDS.forEach(f => {
      textarea(f).addEventListener('input', scheduleAutoSave);
    });

    // Settings
    dom.btnSettingsToggle.addEventListener('click', () => setConfigExpanded(!state.configExpanded));
    dom.configHeader.addEventListener('click', () => setConfigExpanded(!state.configExpanded));
    dom.btnSaveSettings.addEventListener('click', saveSettings);
    dom.btnTestKey.addEventListener('click', testKey);
    dom.btnToggleKey.addEventListener('click', () => {
      dom.apiKeyInput.type = dom.apiKeyInput.type === 'password' ? 'text' : 'password';
    });

    // Action buttons
    dom.btnPolish.addEventListener('click', () => sendActionMessage('polish'));
    dom.btnRewrite.addEventListener('click', () => sendActionMessage('rewrite'));
    dom.btnContinue.addEventListener('click', () => sendActionMessage('continue'));

    // RAG toggle label color
    dom.ragToggle.addEventListener('change', () => {
      dom.ragToggleLabel.classList.toggle('active', dom.ragToggle.checked);
    });

    // Templates
    dom.btnTemplate.addEventListener('click', () => toggleTemplatePanel());
    dom.templateTabs.addEventListener('click', e => {
      const tab = e.target.closest('.tmpl-tab');
      if (!tab) return;
      state.currentTemplateCat = tab.dataset.cat;
      dom.templateTabs.querySelectorAll('.tmpl-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderTemplateList(state.currentTemplateCat);
    });

    // Diff actions (accept-all / reject-all) via event delegation
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const field = btn.dataset.field;
      const action = btn.dataset.action;
      if (!FIELDS.includes(field)) return;
      if (action === 'accept-all') acceptAllDiff(field);
      else if (action === 'reject-all') rejectAllDiff(field);
    });
  }

  // ─── Start ─────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
