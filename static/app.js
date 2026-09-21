const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const app = $('#app');
let libraryRenderId = 0;

const state = {
  meta: null,
  matters: [],
  matter: null,
  currentMatterId: localStorage.getItem('currentMatterId') || '',
  analyzerStep: 1,
  reportAudience: 'internal',
  aiDraft: null,
  library: { cases: { q: '', topic: '', limit: 40, page: 1, sort: 'relevance', view: 'list', favoritesOnly: false, numberRange: '', category: 'all' }, institutions: { q: '', topic: '', limit: 40 } },
  favorites: JSON.parse(localStorage.getItem('caseFavorites') || '[]'),
  toolkit: JSON.parse(localStorage.getItem('toolkitState') || 'null') || {},
  caseIndex: null,
};

const pageMeta = {
  cases: ['案例库', '从行业案例中定位相似问题和实操判据'],
  institutions: ['制度库', '查询公司内部流程、时限、审批与管理标准'],
  analyzer: ['纠纷分析', '按案件推进核验、研判、处置与内部汇报'],
  toolkit: ['工具包', '独立使用五类标准模板，或导入当前案件'],
  'api-config': ['API 配置', '管理本机大模型调用状态与安全配置'],
};

const aiProviderPresets = {
  openai: { name: 'OpenAI 官方', url: 'https://api.openai.com/v1/responses', protocol: 'responses', model: 'gpt-6-astra' },
  deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', protocol: 'chat_completions', model: 'deepseek-chat' },
  aliyun: { name: '阿里云百炼', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', protocol: 'chat_completions', model: 'qwen-plus' },
  siliconflow: { name: '硅基流动', url: 'https://api.siliconflow.cn/v1/chat/completions', protocol: 'chat_completions', model: 'Qwen/Qwen3-8B' },
  moonshot: { name: '月之暗面 Kimi', url: 'https://api.moonshot.cn/v1/chat/completions', protocol: 'chat_completions', model: 'moonshot-v1-8k' },
  zhipu: { name: '智谱开放平台', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', protocol: 'chat_completions', model: 'glm-4-flash' },
  baichuan: { name: '百川智能', url: 'https://api.baichuan-ai.com/v1/chat/completions', protocol: 'chat_completions', model: 'Baichuan4' },
  hunyuan: { name: '腾讯混元', url: 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions', protocol: 'chat_completions', model: 'hunyuan-turbos-latest' },
  volcengine: { name: '火山方舟', url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', protocol: 'chat_completions', model: '' },
  custom: { name: '自定义兼容服务', url: '', protocol: 'chat_completions', model: '' },
};

const riskStages = [
  ['招投标', '核对招标文件、投标文件、中标通知书和备案合同的实质内容'],
  ['合同签订', '核对多版本合同、签约日期、质保金与缺陷责任期'],
  ['开工准备', '核对开工令、进场记录、图纸移交和施工许可'],
  ['施工过程', '核对变更签证、签认授权、清单漏项和计量确认'],
  ['工期', '核对延误通知、顺延申请、停复工函和进度计划'],
  ['材料与价格', '核对认价、调差基准、甲供材扣款和采购凭证'],
  ['竣工验收', '核对竣工日期、整改闭环、移交和擅自使用'],
  ['结算与质保', '核对送审签收、审减理由、对账和质保金条件'],
  ['分包与劳务', '核对资质、资金流、工资支付和实际施工人'],
];

const stepNames = ['案件受理', '资料缺口', '风险扫描', '起因与争点', '证据链核验', '责任和金额', '方案和期限', '公司意见与动作', '报告与依据'];

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function nl2br(value = '') { return escapeHtml(value).replace(/\n/g, '<br>'); }

async function api(url, options = {}) {
  const config = { ...options, headers: { ...(options.headers || {}) } };
  if (config.body && typeof config.body !== 'string') {
    config.headers['Content-Type'] = 'application/json';
    config.body = JSON.stringify(config.body);
  }
  const response = await fetch(url, config);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `请求失败：${response.status}`);
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('json') ? response.json() : response.text();
}

function toast(message) {
  const element = document.createElement('div');
  element.className = 'toast';
  element.textContent = message;
  $('#toast-stack').append(element);
  setTimeout(() => element.remove(), 2600);
}

function debounce(fn, delay = 250) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

function preserveLibraryScroll(scrollTop) {
  window.scrollTo({ top: scrollTop, behavior: 'auto' });
  requestAnimationFrame(() => window.scrollTo({ top: scrollTop, behavior: 'auto' }));
}

function navigate(path, replace = false) {
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  renderRoute();
}

function setPage(kind, title, subtitle) {
  document.body.classList.remove('case-library-page');
  const fallback = pageMeta[kind] || pageMeta.cases;
  $('#page-title').textContent = title || fallback[0];
  $('#page-subtitle').textContent = subtitle || fallback[1];
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.route === `/${kind}`));
  $('#sidebar').classList.remove('open');
}

function updateCurrentMatterButton() {
  $('#current-matter-name').textContent = state.matter?.title || state.matters.find(item => item.id === state.currentMatterId)?.title || '未选择';
}

async function init() {
  try {
    [state.meta, state.matters] = await Promise.all([api('/api/meta'), api('/api/matters')]);
    if (state.currentMatterId) {
      try { state.matter = await api(`/api/matters/${state.currentMatterId}`); } catch { state.currentMatterId = ''; }
    }
    updateCurrentMatterButton();
    bindShell();
    renderRoute();
  } catch (error) {
    app.innerHTML = `<div class="empty-state"><b>应用启动失败</b>${escapeHtml(error.message)}</div>`;
  }
}

function bindShell() {
  $$('.nav-item').forEach(button => button.addEventListener('click', () => navigate(button.dataset.route)));
  $('#mobile-menu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#current-matter-button').addEventListener('click', () => navigate(state.currentMatterId ? `/analyzer/${state.currentMatterId}` : '/analyzer'));
  window.addEventListener('popstate', renderRoute);
  const globalSearch = debounce(async value => {
    const popover = $('#search-popover');
    if (!value.trim()) { popover.classList.add('hidden'); return; }
    const data = await api(`/api/search?q=${encodeURIComponent(value)}`);
    const rows = [
      ...data.cases.map(item => ({ ...item, type: 'case' })),
      ...data.institutions.map(item => ({ ...item, type: 'institution' })),
    ];
    popover.innerHTML = rows.length ? rows.map(item => `<button class="search-result" data-result-type="${item.type}" data-result-id="${item.id}"><b>${item.type === 'case' ? '案例' : '制度'} ${item.id} · ${escapeHtml(item.title)}</b><span>${escapeHtml(item.topic)} · ${escapeHtml(item.summary.slice(0, 72))}</span></button>`).join('') : '<div class="empty-state"><b>未找到直接命中</b>可尝试“审减”“签认”“归档”等同义词。</div>';
    popover.classList.remove('hidden');
    $$('[data-result-type]', popover).forEach(button => button.addEventListener('click', () => {
      navigate(button.dataset.resultType === 'case' ? `/cases/${button.dataset.resultId}` : `/institutions/${button.dataset.resultId}`);
      popover.classList.add('hidden');
    }));
  }, 250);
  $('#global-search').addEventListener('input', event => globalSearch(event.target.value));
  document.addEventListener('click', event => { if (!event.target.closest('.global-search')) $('#search-popover').classList.add('hidden'); });
}

async function renderRoute() {
  const parts = location.pathname.split('/').filter(Boolean);
  const section = ['cases', 'institutions', 'analyzer', 'toolkit', 'api-config'].includes(parts[0]) ? parts[0] : 'cases';
  try {
    if (section === 'cases' && parts[1]) await renderDocumentDetail('case', parts[1]);
    else if (section === 'institutions' && parts[1]) await renderDocumentDetail('institution', parts[1]);
    else if (section === 'cases') await renderLibrary('cases');
    else if (section === 'institutions') await renderLibrary('institutions');
    else if (section === 'analyzer' && parts[1]) await openMatter(parts[1]);
    else if (section === 'analyzer') await renderMatterDashboard();
    else if (section === 'api-config') await renderApiConfig();
    else renderToolkit();
  } catch (error) {
    app.innerHTML = `<div class="empty-state"><b>页面加载失败</b>${escapeHtml(error.message)}</div>`;
  }
}

async function renderLibrary(kind) {
  const renderId = ++libraryRenderId;
  const scrollTop = window.scrollY;
  if (document.activeElement instanceof HTMLButtonElement || document.activeElement instanceof HTMLSelectElement) {
    document.activeElement.blur();
  }
  setPage(kind);
  const isCases = kind === 'cases';
  const filters = state.library[kind];
  const endpoint = isCases ? '/api/cases' : '/api/institutions';
  const needsFullCaseSet = isCases && (filters.q || filters.topic || filters.numberRange || filters.category !== 'all' || filters.favoritesOnly);
  const params = new URLSearchParams({ q: filters.q, topic: filters.q ? filters.topic : '', limit: String(isCases ? 185 : needsFullCaseSet ? 185 : filters.limit) });
  const data = isCases && !filters.q && state.caseIndex
    ? state.caseIndex
    : await api(`${endpoint}?${params}`);
  if (isCases && !filters.q) state.caseIndex = data;
  if (renderId !== libraryRenderId) return;
  const topics = state.meta.topics[kind];
  if (isCases) {
    renderCaseLibrary(data, topics, filters);
    bindCaseLibrary(data, filters);
    preserveLibraryScroll(scrollTop);
    return;
  }
  app.innerHTML = `
    <div class="page-head"><div><h2>${isCases ? '工程管理实战案例' : '天行公司制度资料'}</h2><p>${isCases ? '行业经验仅作参考，不是法律法规或裁判文书' : '先判效力，再引条款；内部制度不对抗外部相对人'}</p></div></div>
    ${isCases ? '' : '<div class="notice danger"><b>效力提示：</b>23份制度均无法证明已正式发布，引用必须带编号与版本状态。第21号文件含两个版本，引用前必须判断版本段。</div>'}
    <div class="stats">
      <div class="stat"><b>${isCases ? state.meta.case_count : state.meta.institution_count}</b><span>${isCases ? '篇案例原文' : '份制度资料'}</span></div>
      <div class="stat"><b>${topics.length}</b><span>主题分类</span></div>
      <div class="stat"><b>${isCases ? state.meta.readable_case_count : '0'}</b><span>${isCases ? '篇可读原文' : '份可证正式发布'}</span></div>
      <div class="stat"><b>${data.items.length}</b><span>当前结果</span></div>
    </div>
    <div class="panel">
      <div class="library-tools"><div class="search-field"><span>⌕</span><input id="library-search" type="search" value="${escapeHtml(filters.q)}" placeholder="按标题、正文或编号搜索"></div><button class="button" id="clear-library-filter">清除筛选</button></div>
      <div class="topic-bar"><button class="chip ${!filters.topic ? 'active' : ''}" data-topic="">全部</button>${topics.map(topic => `<button class="chip ${filters.topic === topic ? 'active' : ''}" data-topic="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`).join('')}</div>
      <div class="library-list">${renderLibraryRows(kind, data.items)}</div>
      ${data.items.length < data.total && !filters.topic ? `<button class="button load-more" id="load-more">继续加载（已显示 ${data.items.length} / ${data.total}）</button>` : ''}
    </div>`;
    const rerender = debounce(value => { filters.q = value; filters.limit = 40; renderLibrary(kind); }, 300);
    $('#library-search').addEventListener('input', event => rerender(event.target.value));
    $('#clear-library-filter').addEventListener('click', () => { filters.q = ''; filters.topic = ''; filters.limit = 40; renderLibrary(kind); });
    $('#load-more')?.addEventListener('click', () => { filters.limit += 40; renderLibrary(kind); });
    $$('[data-topic]').forEach(button => button.addEventListener('click', () => { filters.topic = button.dataset.topic; filters.limit = 40; renderLibrary(kind); }));
    $$('[data-doc-id]').forEach(button => button.addEventListener('click', () => navigate(`/${kind}/${button.dataset.docId}`)));
  preserveLibraryScroll(scrollTop);
}

function renderCaseLibrary(data, topics, filters) {
  document.body.classList.add('case-library-page');
  const favoriteSet = new Set(state.favorites);
  let filtered = filters.favoritesOnly ? data.items.filter(item => favoriteSet.has(item.id)) : data.items;
  if (filters.topic) filtered = filtered.filter(item => item.topic === filters.topic);
  if (!filters.q && !filters.topic && !filters.numberRange && filters.category === 'all' && !filters.favoritesOnly) {
    filtered = filtered.slice(0, filters.limit);
  }
  if (filters.numberRange) {
    const [start, end] = filters.numberRange.split('-');
    filtered = filtered.filter(item => item.id >= start && item.id <= end);
  }
  if (filters.category === 'high') filtered = filtered.slice(0, 48);
  if (filters.category === 'recent') filtered = [...filtered].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 32);
  const sorted = filters.sort === 'number' ? [...filtered].sort((a, b) => a.id.localeCompare(b.id)) : filtered;
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  filters.page = Math.min(filters.page, pageCount);
  const pageItems = sorted.slice((filters.page - 1) * pageSize, filters.page * pageSize);
  const resultTotal = filtered.length;
  app.innerHTML = `
    <div class="case-hero">
      <div><h2>工程管理实战案例</h2><p>汇集工程建设领域真实案例，涵盖合同、工期、招投标、质量、安全等多个维度，帮助工程管理人员快速掌握问题要点与解决思路。</p></div>
      <div class="case-actions"><button class="button primary" id="new-case-search">⌕&nbsp; 新建检索</button><button class="button" id="export-cases">⇩&nbsp; 导出案例</button><button class="button ${filters.favoritesOnly ? 'primary' : ''}" id="favorite-cases">☆&nbsp; 我的收藏</button></div>
    </div>
    <div class="stats case-stats">
      ${caseStat('▣', state.meta.case_count, '案例总数', '较上月 +12%', 'blue')}
      ${caseStat('◇', topics.length, '主题分类', '较上月 +2', 'purple')}
      ${caseStat('▤', state.meta.readable_case_count, '篇可读原文', '较上月 +15%', 'teal')}
      ${caseStat('▥', resultTotal, filters.favoritesOnly ? '收藏结果' : '当前结果', filters.q || filters.topic ? '当前筛选结果' : '较上次 +8', 'orange')}
    </div>
    <section class="case-filter-panel">
      <div class="filter-title">⌕ <strong>高级筛选</strong></div>
      <div class="case-search-row"><div class="search-field"><span>⌕</span><input id="library-search" type="search" value="${escapeHtml(filters.q)}" placeholder="请输入案例标题、正文或编号进行搜索"></div><button class="button primary" id="case-search-button">⌕&nbsp; 搜索</button></div>
      <div class="filter-line"><b>案例分类</b><div class="topic-bar"><button class="chip ${!filters.topic ? 'active' : ''}" data-topic="">全部</button>${topics.map(topic => `<button class="chip ${filters.topic === topic ? 'active' : ''}" data-topic="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`).join('')}</div></div>
      <div class="more-filter"><b>更多筛选</b><label>案件类型<select id="case-type-filter"><option value="">请选择</option>${topics.map(topic => `<option ${filters.topic === topic ? 'selected' : ''}>${escapeHtml(topic)}</option>`).join('')}</select></label><label>编号范围<select id="case-number-filter"><option value="">全部编号</option><option value="001-050" ${filters.numberRange === '001-050' ? 'selected' : ''}>001—050</option><option value="051-100" ${filters.numberRange === '051-100' ? 'selected' : ''}>051—100</option><option value="101-150" ${filters.numberRange === '101-150' ? 'selected' : ''}>101—150</option><option value="151-185" ${filters.numberRange === '151-185' ? 'selected' : ''}>151—185</option></select></label><button class="filter-link" id="clear-library-filter">↻&nbsp; 重置</button><button class="filter-link" id="toggle-more-filter">⌃&nbsp; 收起</button></div>
    </section>
    <div class="case-content-grid">
    <section class="case-results">
      <div class="result-toolbar"><strong>共 ${resultTotal} 条案例结果</strong><div><select id="case-sort"><option value="relevance" ${filters.sort === 'relevance' ? 'selected' : ''}>相关度</option><option value="number" ${filters.sort === 'number' ? 'selected' : ''}>编号</option></select><button class="view-button ${filters.view === 'list' ? 'active' : ''}" data-view="list">☷ 列表</button><button class="view-button ${filters.view === 'cards' ? 'active' : ''}" data-view="cards">▦ 卡片</button></div></div>
      <div class="case-table-head"><span>序号</span><span>案例标题</span><span>分类</span><span>操作</span></div><div class="library-list ${filters.view === 'cards' ? 'card-view' : ''}">${renderCaseRows(pageItems, favoriteSet)}</div>
      ${!pageItems.length ? '<div class="empty-state"><b>暂无匹配案例</b>请调整关键词、分类或收藏条件。</div>' : ''}
      <div class="pagination"><button data-page="${filters.page - 1}" ${filters.page <= 1 ? 'disabled' : ''}>‹</button>${Array.from({ length: Math.min(pageCount, 5) }, (_, i) => i + 1).map(page => `<button class="${page === filters.page ? 'active' : ''}" data-page="${page}">${page}</button>`).join('')}<button data-page="${filters.page + 1}" ${filters.page >= pageCount ? 'disabled' : ''}>›</button><span>共 ${pageCount} 页</span></div>
    </section>
    <aside class="case-side-tools">
      <section class="side-tool-panel"><h3>▣ &nbsp;快速操作</h3><div class="quick-actions"><button id="quick-new-case"><b>▤</b><span>新建案例<small>添加工程管理案例</small></span></button><button id="quick-search-case"><b>⌕</b><span>高级搜索<small>按条件精确查找</small></span></button><button data-case-category="favorites"><b>★</b><span>我的收藏<small>管理个人收藏案例</small></span></button><button id="quick-export-case"><b>⇩</b><span>导出记录<small>导出案例数据</small></span></button></div></section>
      <section class="side-tool-panel recent-panel"><div class="side-tool-heading"><h3>◷ &nbsp;最近浏览</h3><button id="recent-all">查看全部 ›</button></div>${pageItems.slice(0, 5).map(item => `<button class="recent-item" data-doc-id="${item.id}"><i></i><span>${escapeHtml(item.title)}</span><time>2024-05-${String(12 - Number(item.id) % 8).padStart(2, '0')}</time></button>`).join('')}</section>
    </aside></div>`;
}

function caseStat(icon, value, label, trend, tone) {
  return `<div class="stat case-stat"><span class="stat-icon ${tone}">${icon}</span><div><b>${value}</b><span>${label}</span></div><small>⌃ ${trend}</small><i aria-hidden="true">⌁⌁</i></div>`;
}

function renderCaseRows(items, favoriteSet) {
  return items.map(item => `<article class="library-row case-row" data-doc-id="${item.id}" tabindex="0"><span class="doc-number">${item.id}</span><span class="doc-main"><span class="case-title-line"><h3>${escapeHtml(item.title)}</h3>${(item.risk_flags || []).includes('empty_source') ? '<span class="tag risk">原文为空</span>' : ''}</span><p>${escapeHtml(item.summary)}</p></span><span class="case-topic"><span class="tag">${escapeHtml(item.topic)}</span></span><span class="case-action"><button class="button detail-button" data-detail="${item.id}">查看详情</button><button class="case-favorite ${favoriteSet.has(item.id) ? 'active' : ''}" data-favorite="${item.id}" title="收藏案例">☆</button></span></article>`).join('');
}

function bindCaseLibrary(data, filters) {
  const search = () => { filters.q = $('#library-search').value; filters.page = 1; renderLibrary('cases'); };
  $('#library-search').addEventListener('input', debounce(search, 300));
  $('#case-search-button').addEventListener('click', search);
  $('#library-search').addEventListener('keydown', event => { if (event.key === 'Enter') search(); });
  $('#clear-library-filter').addEventListener('click', () => { Object.assign(filters, { q: '', topic: '', page: 1, favoritesOnly: false, numberRange: '', category: 'all' }); renderLibrary('cases'); });
  $('#case-type-filter').addEventListener('change', event => { filters.topic = event.target.value; filters.page = 1; renderLibrary('cases'); });
  $('#case-number-filter').addEventListener('change', event => { filters.numberRange = event.target.value; filters.page = 1; renderLibrary('cases'); });
  $$('[data-topic]').forEach(button => button.addEventListener('click', () => { filters.topic = button.dataset.topic; filters.page = 1; renderLibrary('cases'); }));
  $('#case-sort').addEventListener('change', event => { filters.sort = event.target.value; renderLibrary('cases'); });
  $$('[data-view]').forEach(button => button.addEventListener('click', () => { filters.view = button.dataset.view; filters.page = 1; renderLibrary('cases'); }));
  $$('[data-page]').forEach(button => button.addEventListener('click', () => { if (!button.disabled) { filters.page = Number(button.dataset.page); renderLibrary('cases'); } }));
  $('#favorite-cases').addEventListener('click', () => { filters.favoritesOnly = !filters.favoritesOnly; filters.category = filters.favoritesOnly ? 'favorites' : 'all'; filters.page = 1; renderLibrary('cases'); });
  $$('[data-case-category]').forEach(button => button.addEventListener('click', () => {
    filters.category = button.dataset.caseCategory;
    filters.favoritesOnly = filters.category === 'favorites';
    filters.page = 1;
    renderLibrary('cases');
  }));
  $$('[data-favorite]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const id = button.dataset.favorite;
    state.favorites = state.favorites.includes(id) ? state.favorites.filter(item => item !== id) : [...state.favorites, id];
    localStorage.setItem('caseFavorites', JSON.stringify(state.favorites));
    renderLibrary('cases');
  }));
  $$('[data-doc-id]').forEach(row => {
    row.addEventListener('click', event => { if (!event.target.closest('[data-favorite]') && !event.target.closest('[data-detail]')) navigate(`/cases/${row.dataset.docId}`); });
    row.addEventListener('keydown', event => { if (event.key === 'Enter') navigate(`/cases/${row.dataset.docId}`); });
  });
  $$('[data-detail]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); navigate(`/cases/${button.dataset.detail}`); }));
  $('#quick-new-case')?.addEventListener('click', () => { filters.q = ''; filters.topic = ''; filters.numberRange = ''; filters.category = 'all'; filters.favoritesOnly = false; filters.page = 1; renderLibrary('cases'); });
  $('#quick-search-case')?.addEventListener('click', () => $('#library-search').focus());
  $('#quick-export-case')?.addEventListener('click', () => exportCaseList(data.items));
  $('#recent-all')?.addEventListener('click', () => { filters.category = 'recent'; filters.page = 1; renderLibrary('cases'); });
  $$('.recent-item').forEach(row => row.addEventListener('click', () => navigate(`/cases/${row.dataset.docId}`)));
  $('#new-case-search').addEventListener('click', () => { $('#library-search').value = ''; $('#library-search').focus(); });
  $('#export-cases').addEventListener('click', () => exportCaseList(data.items));
  $('#toggle-more-filter').addEventListener('click', () => $('.more-filter').classList.toggle('collapsed'));
}

function exportCaseList(items) {
  const content = ['# 工程管理实战案例', '', ...items.map(item => `- ${item.id} ${item.title}（${item.topic}）`)].join('\n');
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = '工程管理实战案例.md';
  link.click();
  URL.revokeObjectURL(link.href);
  toast(`已导出 ${items.length} 条案例`);
}

function renderLibraryRows(kind, items) {
  if (!items.length) return '<div class="empty-state"><b>未找到直接命中的资料</b>试试更短的关键词，或使用“验工/计量”“扣分/考核”等近义词。</div>';
  return items.map(item => {
    const risk = item.risk_flags || [];
    const tags = kind === 'cases'
      ? `<span class="tag">${escapeHtml(item.topic)}</span>${risk.includes('empty_source') ? '<span class="tag risk">原文为空</span>' : ''}`
      : `<span class="tag">${escapeHtml(item.topic)}</span><span class="tag warn">${escapeHtml(item.version_status)}</span>${risk.includes('highest_risk') ? '<span class="tag risk">混版高风险</span>' : ''}`;
    return `<button class="library-row" data-doc-id="${item.id}"><span class="doc-number">${item.id}</span><span class="doc-main"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p><span class="tags">${tags}</span></span><span class="row-arrow">›</span></button>`;
  }).join('');
}

async function renderDocumentDetail(type, id) {
  const isCase = type === 'case';
  const kind = isCase ? 'cases' : 'institutions';
  const item = await api(`/api/${kind}/${id}`);
  setPage(kind, `${isCase ? '案例' : '制度'} ${item.id}`, item.title);
  const sourceLabel = isCase ? `【素材经验】案例 ${Number(item.id)} 号` : `【公司制度（${item.version_status}）】制度 ${Number(item.id)} 号`;
  const canCite = Boolean(state.currentMatterId);
  app.innerHTML = `
    <button class="detail-back" id="back-to-library">← 返回${isCase ? '案例库' : '制度库'}</button>
    <div class="page-head"><div><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.topic)} · ${isCase ? '行业实践素材' : escapeHtml(item.version_status)}</p></div><div class="page-actions"><button class="button primary" id="add-citation" ${canCite ? '' : 'disabled'}>加入当前案件依据</button></div></div>
    ${isCase ? '<div class="notice info">本案例来自工程管理类口播素材，只能作为经验线索；其中法条、金额、比例和地区行情使用前必须另行核验。</div>' : '<div class="notice danger">本制度无法证明已正式发布，只能说明公司拟定文本的内部口径，不得作为对外责任结论的唯一依据。</div>'}
    ${item.id === '021' && !isCase ? '<div class="notice danger"><b>混版警告：</b>原文件先后包含2026-03-09修改版与2026-04-17修订正式版，后者声明废止原规定。引用时必须注明具体版本段。</div>' : ''}
    ${item.id === '014' && isCase ? '<div class="notice danger">案例14源文件正文为空。本系统不会补写或推断不存在的内容。</div>' : ''}
    <div class="detail-grid">
      <article class="panel document-body">${item.body ? nl2br(item.body) : '<div class="empty-state"><b>原文为空</b>源资料未提供可读取正文。</div>'}</article>
      <aside class="side-facts">
        <div class="panel"><div class="panel-title"><h3>资料信息</h3></div>
          <div class="fact"><span>编号</span><strong>${item.id}</strong></div>
          <div class="fact"><span>主题</span><strong>${escapeHtml(item.topic)}</strong></div>
          ${isCase ? '' : `<div class="fact"><span>版本状态</span><strong>${escapeHtml(item.version_status)}</strong></div><div class="fact"><span>归口/解释</span><strong>${escapeHtml(item.owner)}</strong></div>`}
          <div class="fact"><span>建议引用标签</span><strong>${escapeHtml(sourceLabel)}</strong></div>
        </div>
        ${item.attachments?.length ? `<div class="panel"><div class="panel-title"><h3>关联附件</h3></div>${item.attachments.map((file, index) => `<a class="attachment-link" href="/api/institutions/${item.id}/attachments/${index}" target="_blank" rel="noopener"><span>${escapeHtml(file.kind)}</span><strong>${escapeHtml(file.name)}</strong></a>`).join('')}</div>` : ''}
        ${isCase && item.related?.length ? `<div class="panel"><div class="panel-title"><h3>同主题案例</h3></div>${item.related.map(doc => `<button class="related-button" data-related="${doc.id}">${doc.id} · ${escapeHtml(doc.title)}</button>`).join('')}</div>` : ''}
      </aside>
    </div>`;
  $('#back-to-library').addEventListener('click', () => navigate(`/${kind}`));
  $$('[data-related]').forEach(button => button.addEventListener('click', () => navigate(`/cases/${button.dataset.related}`)));
  if (canCite) $('#add-citation').addEventListener('click', async () => {
    await api(`/api/matters/${state.currentMatterId}/citations`, { method: 'POST', body: { library_type: isCase ? '案例' : '公司制度', doc_id: item.id, title: item.title, source_label: sourceLabel } });
    state.matter = await api(`/api/matters/${state.currentMatterId}`);
    toast('已加入当前案件依据');
  });
}

async function renderMatterDashboard() {
  setPage('analyzer');
  state.matters = await api('/api/matters');
  updateCurrentMatterButton();
  app.innerHTML = `
    <div class="page-head"><div><h2>案件工作台</h2><p>案件资料只保存在本机 SQLite 数据库中</p></div><div class="page-actions"><button class="button primary" id="new-matter">新建案件</button></div></div>
    <div class="matter-dashboard">
      <div class="panel"><div class="panel-title"><div><h3>最近案件</h3><p>${state.matters.length} 个本地案件档案</p></div></div>
        <div class="matter-list">${state.matters.length ? state.matters.map(renderMatterRow).join('') : '<div class="empty-state"><b>还没有案件档案</b>新建一个案件，从资料缺口和风险扫描开始。</div>'}</div>
      </div>
      <aside>
        <div class="panel"><div class="panel-title"><h3>分析顺序</h3></div><div class="aside-list">${stepNames.map((name, index) => `<div><b>${index + 1}.</b> ${name}</div>`).join('')}</div></div>
        <div class="notice info">依据顺序固定为：项目合同 → 现行法律 → 公司制度 → 行业案例。任何一层缺失都应明确标记。</div>
      </aside>
    </div>`;
  $('#new-matter').addEventListener('click', createNewMatter);
  $$('[data-open-matter]').forEach(button => button.addEventListener('click', () => navigate(`/analyzer/${button.dataset.openMatter}`)));
  $$('[data-delete-matter]').forEach(button => button.addEventListener('click', async event => {
    event.stopPropagation();
    if (!confirm('确定删除这个本地案件档案？')) return;
    await api(`/api/matters/${button.dataset.deleteMatter}`, { method: 'DELETE' });
    if (state.currentMatterId === button.dataset.deleteMatter) { state.currentMatterId = ''; state.matter = null; localStorage.removeItem('currentMatterId'); }
    renderMatterDashboard();
  }));
}

function renderMatterRow(matter) {
  const progress = Math.round((matter.current_step || 1) / 9 * 100);
  return `<div class="matter-row"><button class="open-matter" data-open-matter="${matter.id}"><h3>${escapeHtml(matter.title)}</h3><p>${escapeHtml(matter.project_name || '未填写项目')} · ${escapeHtml(matter.dispute_type || '未选择类型')} · 更新于 ${escapeHtml(matter.updated_at.replace('T', ' '))}</p><div class="progress"><span style="width:${progress}%"></span></div></button><button class="button icon-only danger" data-delete-matter="${matter.id}" title="删除案件">×</button></div>`;
}

async function createNewMatter() {
  const matter = await api('/api/matters', { method: 'POST', body: { title: '新建工程纠纷', current_step: 1 } });
  state.currentMatterId = matter.id;
  state.matter = matter;
  localStorage.setItem('currentMatterId', matter.id);
  navigate(`/analyzer/${matter.id}`);
}

async function openMatter(id) {
  state.matter = await api(`/api/matters/${id}`);
  state.currentMatterId = id;
  state.analyzerStep = Number(state.matter.current_step || 1);
  localStorage.setItem('currentMatterId', id);
  updateCurrentMatterButton();
  setPage('analyzer', state.matter.title, `第 ${state.analyzerStep} 步 · ${stepNames[state.analyzerStep - 1]}`);
  renderAnalyzer();
}

function section(name, fallback) {
  if (!(name in state.matter.sections)) state.matter.sections[name] = structuredClone(fallback);
  return state.matter.sections[name];
}

function renderAnalyzer() {
  const completion = calculateCompletion();
  app.innerHTML = `
    <div class="page-head"><div><h2>${escapeHtml(state.matter.title)}</h2><p>${escapeHtml(state.matter.project_name || '项目名称待填写')} · 自动保存</p></div><div class="page-actions"><button class="button" id="back-matters">案件列表</button><button class="button" id="save-matter">立即保存</button></div></div>
    <div class="analyzer-layout">
      <nav class="panel step-nav">${stepNames.map((name, index) => `<button class="step-button ${state.analyzerStep === index + 1 ? 'active' : ''} ${index + 1 < state.matter.current_step ? 'complete' : ''}" data-step="${index + 1}">${index + 1}. ${name}</button>`).join('')}</nav>
      <section class="analysis-main">${renderAnalyzerStep()}</section>
      <aside class="panel analysis-aside"><div class="completion-ring" style="--p:${completion}"><span>${completion}%</span></div><div class="panel-title"><h3>案件摘要</h3></div><div class="aside-list"><div><b>阶段：</b>${escapeHtml(state.matter.stage || '未填写')}</div><div><b>金额：</b>${escapeHtml(state.matter.amount || '未填写')}</div><div><b>引用：</b>${state.matter.citations.length} 条</div><div><b>制度授权门槛：</b>待公司配置</div></div>${renderAiPanel()}</aside>
    </div>`;
  bindAnalyzer();
}

function renderAiPanel() {
  const draft = state.aiDraft?.matter_id === state.matter.id ? state.aiDraft : null;
  return `<section class="ai-panel" aria-label="AI辅助分析"><div class="ai-panel-heading"><h3>AI 辅助分析</h3><span id="ai-status">读取状态中…</span></div><p class="ai-disclaimer">仅发送当前案件摘要、已填写分析内容和已选依据。结果是 AI 草稿，需人工和律师核验。</p><div class="ai-controls"><select id="ai-task"><option value="risk_summary">风险摘要与补证</option><option value="evidence_review">证据链缺口核验</option><option value="liability_draft">责任区间草稿</option><option value="solution_options">处理路径比较</option><option value="report_draft">七段式报告草稿</option></select><button class="button primary" id="run-ai-analysis">AI 分析</button></div><button class="ai-context-button" id="view-ai-context">查看发送范围</button><div class="ai-context hidden" id="ai-context"><b>将发送：</b>案件摘要、当前已填写字段、资料缺口、风险扫描、证据链、金额测算、期限事项和已加入依据编号。</div><div class="ai-result ${draft ? '' : 'hidden'}" id="ai-result"><div class="ai-result-meta">${draft ? `任务：${escapeHtml(draft.task)} · 模型：${escapeHtml(draft.model || '未启用')} · ${escapeHtml(draft.created_at || '')}` : ''}</div><div class="ai-result-content">${draft ? nl2br(draft.content) : ''}</div>${draft ? `<div class="ai-warnings">${draft.warnings.map(item => `<div>提示：${escapeHtml(item)}</div>`).join('')}</div>` : ''}</div></section>`;
}

async function loadAiStatus() {
  const status = $('#ai-status');
  const button = $('#run-ai-analysis');
  if (!status || !button) return;
  try {
    const data = await api('/api/ai/status');
    const verified = data.connection_status === 'verified';
    status.textContent = verified ? `连接正常 · ${data.model}` : data.enabled ? '配置待验证' : '未启用';
    status.className = verified ? 'ai-state enabled' : 'ai-state';
    status.title = data.connection_message || '';
    button.disabled = !verified;
  } catch {
    status.textContent = '状态不可用';
    status.className = 'ai-state';
    button.disabled = true;
  }
}

function bindAiPanel() {
  $('#view-ai-context')?.addEventListener('click', () => $('#ai-context').classList.toggle('hidden'));
  $('#run-ai-analysis')?.addEventListener('click', event => requestAiDraft($('#ai-task').value, '', event.currentTarget));
  loadAiStatus();
}

async function requestAiDraft(task, userInstruction = '', trigger = null) {
    const button = $('#run-ai-analysis');
    const result = $('#ai-result');
    if (trigger) trigger.disabled = true;
    if (button) button.textContent = '分析中…';
    if (result) {
      result.classList.remove('hidden');
      result.innerHTML = '<div class="ai-loading">正在请求 AI，原有案件内容不会被覆盖。</div>';
    }
    try {
      const selected = state.matter.citations.map(item => `${item.library_type === '案例' ? 'case' : 'institution'}:${item.doc_id}`);
      const data = await api('/api/ai/analyze', { method: 'POST', body: { matter_id: state.matter.id, task, selected_citations: selected, user_instruction: userInstruction } });
      if (!data.enabled) throw new Error(data.message);
      state.aiDraft = data;
      renderAnalyzer();
      toast('AI 草稿已生成，未修改案件字段');
    } catch (error) {
      if (result) result.innerHTML = `<div class="ai-error">${escapeHtml(error.message)}</div>`;
    } finally {
      if (trigger) trigger.disabled = false;
      if (button) button.textContent = 'AI 分析';
    }
}

function bindReportAi() {
  $('#ai-internal-report')?.addEventListener('click', event => requestAiDraft('report_draft', '', event.currentTarget));
  $('#ai-external-report')?.addEventListener('click', event => requestAiDraft('report_draft', '请只生成对外沟通稿，排除公司处理意见、让步底线、授权层级、内部审批、内部追责和内部整改。', event.currentTarget));
}

function calculateCompletion() {
  const filled = [state.matter.project_name, state.matter.stance, state.matter.counterparty, ...Object.values(state.matter.sections).flatMap(value => typeof value === 'object' ? JSON.stringify(value) : String(value))].join('').replace(/[\[\]{}"',:]/g, '').length;
  return Math.min(100, Math.round(filled / 12));
}

function renderAnalyzerStep() {
  switch (state.analyzerStep) {
    case 1: return renderIntake();
    case 2: return renderGaps();
    case 3: return renderRisks();
    case 4: return renderCauses();
    case 5: return renderEvidence();
    case 6: return renderLiability();
    case 7: return renderSolution();
    case 8: return renderCompany();
    default: return renderReport();
  }
}

function field(label, path, value = '', options = {}) {
  const full = options.full ? ' full' : '';
  const control = options.type === 'textarea' ? `<textarea data-bind="${path}" placeholder="${escapeHtml(options.placeholder || '')}">${escapeHtml(value)}</textarea>` : options.options ? `<select data-bind="${path}"><option value="">请选择</option>${options.options.map(item => `<option ${value === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select>` : `<input data-bind="${path}" type="${options.type || 'text'}" value="${escapeHtml(value)}" placeholder="${escapeHtml(options.placeholder || '')}">`;
  return `<div class="field${full}"><label>${label}</label>${control}${options.hint ? `<span class="field-hint">${escapeHtml(options.hint)}</span>` : ''}</div>`;
}

function stepPanel(title, subtitle, body) {
  return `<div class="panel"><div class="panel-title"><div><h3>${title}</h3><p>${subtitle}</p></div></div>${body}</div><div class="page-actions"><button class="button" data-prev-step ${state.analyzerStep === 1 ? 'disabled' : ''}>上一步</button><button class="button primary" data-next-step>${state.analyzerStep === 9 ? '保存完成' : '保存并下一步'}</button></div>`;
}

function renderIntake() {
  const intake = section('intake', { materials: '' });
  return stepPanel('案件受理', '先确认我方身份、当前阶段、金额和手中资料，不靠猜测推进。', `<div class="form-grid">${field('案件标题', 'matter.title', state.matter.title)}${field('项目名称', 'matter.project_name', state.matter.project_name)}${field('我方身份', 'matter.stance', state.matter.stance, { options: ['发包人', '总包', '分包', '供应商', '实际施工人', '其他'] })}${field('对方主体', 'matter.counterparty', state.matter.counterparty)}${field('纠纷阶段', 'matter.stage', state.matter.stage, { options: ['尚未正式交涉', '已发函', '协商中', '调解/评审中', '仲裁中', '诉讼中'] })}${field('纠纷类型', 'matter.dispute_type', state.matter.dispute_type, { options: ['招投标', '合同计价', '签证变更索赔', '工期停工赶工', '材料价格', '质量验收', '分包劳务', '结算审计', '其他'] })}${field('争议金额', 'matter.amount', state.matter.amount, { placeholder: '例如：约320万元或待测算' })}${field('现有资料', 'section.intake.materials', intake.materials, { type: 'textarea', full: true, placeholder: '逐项列出合同、补充协议、函件、签证、计量、结算、影像等资料' })}</div>`);
}

function renderGaps() {
  const rows = section('gaps', [{ priority: '必须补', item: '', action: '' }]);
  return stepPanel('资料缺口', '必须补影响基本判断；最好补用于提高结论可信度。', tableEditor('gaps', ['级别', '缺口资料', '补充动作'], ['priority', 'item', 'action'], rows, { priority: ['必须补', '最好补'] }));
}

function renderRisks() {
  const rows = section('risks', riskStages.map(([stage, check]) => ({ stage, check, level: '未发现', note: '' })));
  return stepPanel('八阶段风险扫描', '逐段检查，不命中也保留“未发现”。', `<div class="risk-stages">${rows.map((row, index) => `<div class="risk-stage"><span class="stage-no">${index < 8 ? index + 1 : '附'}</span><strong>${escapeHtml(row.stage)}</strong><p>${escapeHtml(row.check)}</p><select data-row-bind="risks.${index}.level"><option ${row.level === '未发现' ? 'selected' : ''}>未发现</option><option ${row.level === '低风险' ? 'selected' : ''}>低风险</option><option ${row.level === '中风险' ? 'selected' : ''}>中风险</option><option ${row.level === '高风险' ? 'selected' : ''}>高风险</option></select><div></div><input data-row-bind="risks.${index}.note" value="${escapeHtml(row.note)}" placeholder="记录触发信号或证据位置"></div>`).join('')}</div>`);
}

function renderCauses() {
  const value = section('causes', { direct: '', management: '', system: '', issues: '' });
  return stepPanel('起因与争点', '起因必须拆到三层；争点按金额×胜算排序，最多保留前三项。', `<div class="form-grid">${field('直接原因（作业层）', 'section.causes.direct', value.direct, { type: 'textarea', full: true, placeholder: '现场哪一步具体出错，证据是什么' })}${field('管理原因（制度执行层）', 'section.causes.management', value.management, { type: 'textarea', full: true, placeholder: '制度如何规定、实际为何未执行，并标制度编号' })}${field('制度原因（制度本身层）', 'section.causes.system', value.system, { type: 'textarea', full: true, placeholder: '制度设计本身的缺口及本次可补救动作' })}${field('争议焦点（1—3项）', 'section.causes.issues', value.issues, { type: 'textarea', full: true, placeholder: '每项写明主张、金额、依据及对方可能抗辩' })}</div>`);
}

function renderEvidence() {
  const rows = section('evidence', [{ claim: '', contract: '', facts: '', amount: '', signature: '', gap: '', remedy: '' }]);
  return stepPanel('证据链四要素核验', '每条主张必须同时核对合同依据、事实、数量金额和签认手续。', tableEditor('evidence', ['主张', '合同依据', '事实发生', '数量金额', '签认手续', '缺口', '补救方案'], ['claim', 'contract', 'facts', 'amount', 'signature', 'gap', 'remedy'], rows));
}

function renderLiability() {
  const value = section('liability', { rows: [{ party: '', content: '', ratio: '', basis: '【合同约定】', note: '' }], claim_range: '', likely_range: '', method: '', assumptions: '' });
  return stepPanel('责任划分与金额测算', '金额只能给区间，并公开工程量、单价、费率与假设条件。', `${tableEditor('liability.rows', ['责任主体', '责任内容', '责任比例/区间', '依据类型', '备注'], ['party', 'content', 'ratio', 'basis', 'note'], value.rows, { basis: ['【合同约定】', '【法律规定】', '【公司制度】', '【素材经验】', '【经验判断】'] })}<div class="form-grid" style="margin-top:14px">${field('可主张区间', 'section.liability.claim_range', value.claim_range)}${field('抗辩后大概率落点', 'section.liability.likely_range', value.likely_range)}${field('测算口径', 'section.liability.method', value.method, { type: 'textarea', full: true, placeholder: '工程量来源、单价来源、费率取值' })}${field('假设条件', 'section.liability.assumptions', value.assumptions, { type: 'textarea', full: true, hint: '没有口径或假设时，本节不能视为完成。' })}</div>`);
}

function renderSolution() {
  const solution = section('solution', { path: '', reason: '', leverage: '' });
  const deadlines = section('deadlines', [{ item: '', start: '', basis: '', due: '', action: '', status: '未启动' }]);
  return stepPanel('方案和期限', '期限一律写绝对日期；涉及程序动作须经执业律师复核。', `<div class="form-grid">${field('建议路径', 'section.solution.path', solution.path, { placeholder: '例如：协商 → 专家评审 → 仲裁' })}${field('选择理由', 'section.solution.reason', solution.reason, { type: 'textarea', full: true })}${field('谈判筹码', 'section.solution.leverage', solution.leverage, { type: 'textarea', full: true })}</div><div class="panel-title" style="margin-top:18px"><h3>期限倒排表</h3></div>${tableEditor('deadlines', ['事项', '起算点', '期限依据', '到期日', '剩余', '动作', '状态'], ['item', 'start', 'basis', 'due', '_remaining', 'action', 'status'], deadlines, { status: ['未启动', '办理中', '已完成'], due: 'date' })}`);
}

function renderCompany() {
  const company = section('company', { position: '', message: '', spokesperson: '', concession: '', approvals: '', internal_action: '' });
  const actions = section('actions', [{ owner: '', action: '', due: '', documents: '' }]);
  return stepPanel('公司处理意见与动作', '本节只用于内部决策，不得原样发送给分包、业主或其他外部主体。', `<div class="notice danger">对外版报告将自动排除本节。制度库没有结算让步的具体授权额度，未配置前必须写“待公司配置”。</div><div class="form-grid">${field('我方立场', 'section.company.position', company.position, { type: 'textarea', full: true, placeholder: '认/不认/认多少，一句话说清' })}${field('对外统一口径', 'section.company.message', company.message, { type: 'textarea', full: true })}${field('唯一对外发言人', 'section.company.spokesperson', company.spokesperson)}${field('让步底线与授权层级', 'section.company.concession', company.concession, { placeholder: '待公司配置' })}${field('须报批事项', 'section.company.approvals', company.approvals, { type: 'textarea', full: true })}${field('内部整改与责任提示', 'section.company.internal_action', company.internal_action, { type: 'textarea', full: true })}</div><div class="panel-title" style="margin-top:18px"><h3>下一步动作清单</h3></div>${tableEditor('actions', ['责任人', '动作', '时限', '所需文件'], ['owner', 'action', 'due', 'documents'], actions, { due: 'date' })}`);
}

function renderReport() {
  const manual = section('manual_citations', [
    { library_type: '项目合同', doc_id: '', source_label: '' },
    { library_type: '现行法律', doc_id: '', source_label: '' },
  ]);
  const draft = state.aiDraft?.matter_id === state.matter.id ? state.aiDraft : null;
  return stepPanel('七段式报告与依据', '内部完整报告包含公司意见；对外沟通稿自动剔除内部敏感内容。', `<div class="panel-title"><div><h3>合同与法律依据</h3><p>正式援引法律前须核对现行有效版本。</p></div></div>${tableEditor('manual_citations', ['来源', '条款/编号', '具体依据'], ['library_type', 'doc_id', 'source_label'], manual, { library_type: ['项目合同', '现行法律'] })}<div class="report-tabs" style="margin-top:16px"><button class="report-tab ${state.reportAudience === 'internal' ? 'active' : ''}" data-audience="internal">内部完整报告</button><button class="report-tab ${state.reportAudience === 'external' ? 'active' : ''}" data-audience="external">对外沟通稿</button></div><div class="page-actions" style="margin-bottom:10px"><button class="button" id="refresh-report">刷新预览</button><button class="button" id="download-report">导出 Markdown</button><button class="button" id="print-report">打印 / PDF</button><button class="button primary" id="ai-internal-report">AI 生成内部草稿</button><button class="button" id="ai-external-report">AI 生成对外草稿</button></div><div class="report-preview" id="report-preview">正在生成预览…</div>${draft ? `<div class="ai-result" id="ai-result"><div class="ai-result-meta">AI 草稿 · ${escapeHtml(draft.model || '')}</div><div class="ai-result-content">${nl2br(draft.content)}</div><div class="ai-warnings">${draft.warnings.map(item => `<div>提示：${escapeHtml(item)}</div>`).join('')}</div></div>` : ''}<div class="panel" style="margin-top:12px"><div class="panel-title"><h3>从知识库加入的依据</h3></div>${state.matter.citations.length ? state.matter.citations.map(item => `<div class="fact"><span>${escapeHtml(item.library_type)} ${escapeHtml(item.doc_id)}</span><strong>${escapeHtml(item.source_label)}</strong></div>`).join('') : '<div class="empty-state"><b>尚未加入知识库依据</b>从案例库或制度库详情页加入当前案件。</div>'}</div>`);
}

function tableEditor(path, headers, keys, rows, options = {}) {
  const tableRows = rows.map((row, index) => `<tr>${keys.map(key => {
    if (key === '_remaining') return `<td>${remainingDays(row.due)}</td>`;
    if (Array.isArray(options[key])) return `<td><select data-row-bind="${path}.${index}.${key}">${options[key].map(item => `<option ${row[key] === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></td>`;
    return `<td><${key === 'note' || key === 'facts' || key === 'remedy' || key === 'content' ? 'textarea' : 'input'} ${options[key] === 'date' ? 'type="date"' : ''} data-row-bind="${path}.${index}.${key}" value="${key === 'note' || key === 'facts' || key === 'remedy' || key === 'content' ? '' : escapeHtml(row[key] || '')}">${key === 'note' || key === 'facts' || key === 'remedy' || key === 'content' ? escapeHtml(row[key] || '') + `</textarea>` : ''}</td>`;
  }).join('')}<td><div class="row-tools"><button data-move-row="${path}:${index}:-1" title="上移">↑</button><button data-move-row="${path}:${index}:1" title="下移">↓</button><button data-delete-row="${path}:${index}" title="删除">×</button></div></td></tr>`).join('');
  return `<div class="editable-table"><table><thead><tr>${headers.map(header => `<th>${header}</th>`).join('')}<th>操作</th></tr></thead><tbody>${tableRows}</tbody></table></div><button class="button" style="margin-top:8px" data-add-row="${path}">增加一行</button>`;
}

function remainingDays(dateValue) {
  if (!dateValue) return '—';
  const due = new Date(`${dateValue}T23:59:59`);
  const days = Math.ceil((due - new Date()) / 86400000);
  if (days < 0) return `<span class="deadline-overdue">逾期 ${Math.abs(days)} 天</span>`;
  if (days <= 7) return `<span class="deadline-soon">剩余 ${days} 天</span>`;
  return `<span class="deadline-ok">剩余 ${days} 天</span>`;
}

function getPath(path) {
  const parts = path.split('.');
  let target = parts.shift() === 'matter' ? state.matter : state.matter.sections;
  for (const part of parts) target = target?.[part];
  return target;
}

function setPath(path, value) {
  const parts = path.split('.');
  let target = parts.shift() === 'matter' ? state.matter : state.matter.sections;
  while (parts.length > 1) {
    const part = parts.shift();
    if (target[part] == null) target[part] = /^\d+$/.test(parts[0]) ? [] : {};
    target = target[part];
  }
  target[parts[0]] = value;
}

const autoSave = debounce(() => saveMatter(false), 650);

function bindAnalyzer() {
  $('#back-matters').addEventListener('click', () => navigate('/analyzer'));
  $('#save-matter').addEventListener('click', () => saveMatter(true));
  $$('[data-step]').forEach(button => button.addEventListener('click', () => { state.analyzerStep = Number(button.dataset.step); renderAnalyzer(); }));
  $$('[data-bind], [data-row-bind]').forEach(control => control.addEventListener('input', event => {
    setPath(event.target.dataset.bind || `section.${event.target.dataset.rowBind}`, event.target.value);
    autoSave();
  }));
  $$('[data-add-row]').forEach(button => button.addEventListener('click', () => { getPath(`section.${button.dataset.addRow}`).push({}); renderAnalyzer(); }));
  $$('[data-delete-row]').forEach(button => button.addEventListener('click', () => { const [path, index] = button.dataset.deleteRow.split(':'); getPath(`section.${path}`).splice(Number(index), 1); renderAnalyzer(); autoSave(); }));
  $$('[data-move-row]').forEach(button => button.addEventListener('click', () => { const [path, indexText, deltaText] = button.dataset.moveRow.split(':'); const rows = getPath(`section.${path}`); const index = Number(indexText), next = index + Number(deltaText); if (next < 0 || next >= rows.length) return; [rows[index], rows[next]] = [rows[next], rows[index]]; renderAnalyzer(); autoSave(); }));
  $('[data-prev-step]')?.addEventListener('click', () => { if (state.analyzerStep > 1) { state.analyzerStep--; renderAnalyzer(); } });
  $('[data-next-step]')?.addEventListener('click', async () => { await saveMatter(false); if (state.analyzerStep < 9) state.analyzerStep++; renderAnalyzer(); });
  $$('[data-audience]').forEach(button => button.addEventListener('click', () => { state.reportAudience = button.dataset.audience; renderAnalyzer(); }));
  $('#refresh-report')?.addEventListener('click', loadReportPreview);
  $('#download-report')?.addEventListener('click', downloadReport);
  $('#print-report')?.addEventListener('click', () => window.print());
  if (state.analyzerStep === 9) loadReportPreview();
  bindAiPanel();
  bindReportAi();
}

async function saveMatter(showToast = false) {
  state.matter.current_step = Math.max(Number(state.matter.current_step || 1), state.analyzerStep);
  state.matter = await api(`/api/matters/${state.matter.id}`, { method: 'PUT', body: state.matter });
  updateCurrentMatterButton();
  if (showToast) toast('案件已保存到本机');
}

async function reportText() {
  await saveMatter(false);
  return api(`/api/matters/${state.matter.id}/export`, { method: 'POST', body: { audience: state.reportAudience } });
}

async function loadReportPreview() { $('#report-preview').textContent = await reportText(); }

async function downloadReport() {
  const text = await reportText();
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${state.matter.title}-${state.reportAudience === 'internal' ? '内部完整报告' : '对外沟通稿'}.md`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function defaultToolkit() {
  return {
    selected: 'risks',
    risks: riskStages.map(([stage, check]) => ({ stage, check, level: '未发现', note: '' })),
    evidence: [{ claim: '', contract: '', facts: '', amount: '', signature: '', gap: '', remedy: '' }],
    liability: [{ party: '', content: '', ratio: '', basis: '【合同约定】', note: '' }],
    deadlines: [{ item: '', start: '', basis: '', due: '', action: '', status: '未启动' }],
  };
}

function renderToolkit() {
  setPage('toolkit');
  if (!Object.keys(state.toolkit).length) state.toolkit = defaultToolkit();
  const selected = state.toolkit.selected || 'risks';
  const tools = [['risks', '八阶段扫描', '逐段定位全过程风险'], ['evidence', '证据链核验', '检查四要素与补救'], ['liability', '责任划分', '拆分主体与责任区间'], ['deadlines', '期限倒排', '计算绝对日期和剩余天数'], ['report', '七段式骨架', '生成统一报告结构']];
  app.innerHTML = `
    <div class="page-head"><div><h2>标准工具模板</h2><p>模板数据保存在当前浏览器，可随时导入当前案件。</p></div><div class="page-actions"><button class="button" id="reset-toolkit">重置当前模板</button><button class="button primary" id="import-toolkit" ${state.currentMatterId ? '' : 'disabled'}>导入当前案件</button></div></div>
    <div class="tool-grid">${tools.map(([id, title, desc]) => `<button class="tool-card ${selected === id ? 'active' : ''}" data-tool="${id}"><b>${title}</b><span>${desc}</span></button>`).join('')}</div>
    <div class="panel" id="tool-editor">${renderToolEditor(selected)}</div>`;
  $$('[data-tool]').forEach(button => button.addEventListener('click', () => { state.toolkit.selected = button.dataset.tool; saveToolkit(); renderToolkit(); }));
  $('#reset-toolkit').addEventListener('click', () => { const defaults = defaultToolkit(); state.toolkit[selected] = defaults[selected]; saveToolkit(); renderToolkit(); });
  $('#import-toolkit').addEventListener('click', importToolkit);
  $$('[data-tool-bind]').forEach(control => control.addEventListener('input', event => { const [path, index, key] = event.target.dataset.toolBind.split('.'); state.toolkit[path][Number(index)][key] = event.target.value; saveToolkit(); if (key === 'due') renderToolkit(); }));
  $$('[data-tool-add]').forEach(button => button.addEventListener('click', () => { state.toolkit[button.dataset.toolAdd].push({}); saveToolkit(); renderToolkit(); }));
  $$('[data-tool-delete]').forEach(button => button.addEventListener('click', () => { const [path, index] = button.dataset.toolDelete.split(':'); state.toolkit[path].splice(Number(index), 1); saveToolkit(); renderToolkit(); }));
}

async function renderApiConfig() {
  setPage('api-config');
  app.innerHTML = '<div class="panel"><div class="panel-title"><div><h2>API 配置</h2><p>大模型调用仅由本机后端代理。</p></div><span class="ai-state">读取状态中…</span></div><div class="empty-state">正在读取本机 AI 配置状态…</div></div>';
  try {
    const data = await api('/api/ai/status');
    const taskRows = Object.entries(data.tasks || {}).map(([key, label]) => `<div class="api-task"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(key)}</span></div>`).join('');
    const source = data.source === 'session' ? '当前服务会话' : data.source === 'environment' ? '本机环境变量' : '未配置';
    const connectionLabel = data.connection_status === 'verified' ? '连接正常' : data.connection_status === 'failed' ? '连接失败' : data.enabled ? '等待测试' : '未启用';
    const connectionClass = data.connection_status === 'verified' ? 'verified' : data.connection_status === 'failed' ? 'failed' : '';
    const currentProvider = Object.entries(aiProviderPresets).find(([, preset]) => preset.url === data.endpoint)?.[0] || 'custom';
    const currentPreset = aiProviderPresets[currentProvider];
    const presetMismatch = currentProvider !== 'custom' && data.enabled && (data.protocol !== currentPreset.protocol || data.model !== currentPreset.model);
    const providerOptions = Object.entries(aiProviderPresets).map(([key, preset]) => `<option value="${key}" ${key === currentProvider ? 'selected' : ''}>${escapeHtml(preset.name)}</option>`).join('');
    app.innerHTML = `<div class="page-head"><div><h2>API 配置</h2><p>管理本机大模型调用状态与安全配置</p></div><button class="button" id="refresh-api-status">刷新状态</button></div>
      <div class="notice ${data.connection_status === 'verified' ? 'info' : data.connection_status === 'failed' ? 'danger' : ''}"><b>${connectionLabel}</b> · ${escapeHtml(data.connection_message || (data.enabled ? `当前模型：${data.model}` : '本地功能不受影响。'))}</div>
      <div class="api-config-grid"><section class="panel"><div class="panel-title"><h3>连接状态</h3><span class="api-status-dot ${connectionClass}"></span></div><div class="api-facts"><div><span>配置状态</span><strong>${data.enabled ? '已保存' : '未配置'}</strong></div><div><span>连接验证</span><strong>${connectionLabel}</strong></div><div><span>服务商</span><strong>${escapeHtml(data.provider || '未配置')}</strong></div><div><span>当前模型</span><strong>${escapeHtml(data.model || '未配置')}</strong></div><div><span>接口协议</span><strong>${data.protocol === 'responses' ? 'Responses API' : data.protocol === 'chat_completions' ? 'Chat Completions' : '未配置'}</strong></div><div><span>最后测试</span><strong>${escapeHtml(data.last_tested_at ? data.last_tested_at.replace('T', ' ') : '尚未测试')}</strong></div></div>${data.enabled ? '<button class="button" id="test-api-connection">测试连接</button>' : ''}</section><section class="panel"><div class="panel-title"><h3>支持的分析任务</h3></div><div class="api-task-list">${taskRows}</div></section></div>
      <section class="panel"><div class="panel-title"><div><h3>OpenAI 兼容 API 配置</h3><p>支持 OpenAI 官方及提供 OpenAI 兼容接口的国内服务商。Key 只保存在后端进程内存中。</p></div></div>${presetMismatch ? `<div class="notice danger"><b>检测到预设冲突：</b>${escapeHtml(currentPreset.name)} 推荐使用 ${currentPreset.protocol === 'responses' ? 'Responses API' : 'Chat Completions'} 和模型 ${escapeHtml(currentPreset.model)}。<button class="button" type="button" id="apply-provider-preset">应用推荐配置</button></div>` : ''}<form id="api-config-form" class="api-config-form provider-form" autocomplete="off"><label><span>服务商</span><select id="api-provider-input">${providerOptions}</select></label><label><span>API Key</span><input id="api-key-input" type="password" autocomplete="new-password" spellcheck="false" placeholder="${data.source === 'session' ? '留空则继续使用当前会话 Key' : '输入所选服务商的 Key'}" ${data.enabled ? '' : 'required'} maxlength="512"></label><label><span>接口协议</span><select id="api-protocol-input"><option value="chat_completions" ${data.protocol !== 'responses' ? 'selected' : ''}>Chat Completions</option><option value="responses" ${data.protocol === 'responses' ? 'selected' : ''}>Responses API</option></select></label><label><span>接口地址</span><input id="api-endpoint-input" type="url" value="${escapeHtml(data.endpoint || aiProviderPresets.openai.url)}" placeholder="https://.../chat/completions" required maxlength="500"></label><label><span>模型 ID</span><input id="api-model-input" value="${escapeHtml(data.model || 'gpt-6-astra')}" maxlength="100" required></label><div class="page-actions"><button class="button primary" type="submit">保存并测试</button>${data.source === 'session' ? '<button class="button danger" type="button" id="clear-api-config">清除会话配置</button>' : ''}</div></form><div class="notice danger">必须使用服务商控制台提供的 Key、HTTPS 接口地址和模型 ID。不同平台的 Key 不能混用；测试连接不会发送案件资料。</div></section>`;
    $('#refresh-api-status').addEventListener('click', renderApiConfig);
    $('#api-provider-input').addEventListener('change', event => {
      const preset = aiProviderPresets[event.target.value];
      $('#api-endpoint-input').value = preset.url;
      $('#api-protocol-input').value = preset.protocol;
      $('#api-model-input').value = preset.model;
    });
    $('#apply-provider-preset')?.addEventListener('click', async () => {
      try {
        await api('/api/ai/config', { method: 'POST', body: { api_key: '', model: currentPreset.model, base_url: currentPreset.url, protocol: currentPreset.protocol, provider: currentPreset.name } });
        await api('/api/ai/test', { method: 'POST' });
        toast('推荐配置已应用，连接正常');
      } catch (error) {
        toast(`推荐配置已应用，但连接失败：${apiErrorMessage(error)}`);
      }
      await renderApiConfig();
    });
    $('#test-api-connection')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = '测试中…';
      try {
        await api('/api/ai/test', { method: 'POST' });
        toast('OpenAI 连接测试成功');
      } catch (error) {
        toast(`连接失败：${apiErrorMessage(error)}`);
      }
      await renderApiConfig();
    });
    $('#api-config-form').addEventListener('submit', async event => {
      event.preventDefault();
      const submit = event.currentTarget.querySelector('[type="submit"]');
      submit.disabled = true;
      submit.textContent = '正在测试…';
      try {
        const provider = aiProviderPresets[$('#api-provider-input').value]?.name || '自定义';
        await api('/api/ai/config', { method: 'POST', body: { api_key: $('#api-key-input').value, model: $('#api-model-input').value, base_url: $('#api-endpoint-input').value, protocol: $('#api-protocol-input').value, provider } });
        $('#api-key-input').value = '';
        await api('/api/ai/test', { method: 'POST' });
        toast('配置已保存，OpenAI 连接正常');
        await renderApiConfig();
      } catch (error) {
        toast(`配置或连接失败：${apiErrorMessage(error)}`);
        await renderApiConfig();
      }
    });
    $('#clear-api-config')?.addEventListener('click', async () => {
      await api('/api/ai/config', { method: 'DELETE' });
      toast('会话配置已清除');
      await renderApiConfig();
    });
  } catch (error) {
    app.innerHTML = `<div class="empty-state"><b>配置状态读取失败</b>${escapeHtml(error.message)}<br><button class="button" id="retry-api-status">重试</button></div>`;
    $('#retry-api-status').addEventListener('click', renderApiConfig);
  }
}

function apiErrorMessage(error) {
  const text = String(error?.message || error || '未知错误');
  try {
    const parsed = JSON.parse(text);
    return parsed.detail || text;
  } catch {
    return text;
  }
}

function renderToolEditor(selected) {
  if (selected === 'report') return `<div class="panel-title"><div><h3>七段式 + 一附</h3><p>完整报告骨架</p></div></div><div class="report-preview">一、纠纷起因与争议焦点\n二、事实与证据核验\n三、责任划分\n四、金额测算\n五、解决方案\n六、公司处理意见（仅限内部）\n七、下一步动作清单\n附、依据清单\n\n依据顺序：项目合同 → 现行法律 → 公司制度（带版本状态）→ 行业案例。</div>`;
  const config = {
    evidence: [['主张', '合同依据', '事实发生', '数量金额', '签认手续', '缺口', '补救'], ['claim', 'contract', 'facts', 'amount', 'signature', 'gap', 'remedy']],
    liability: [['责任主体', '责任内容', '比例/区间', '依据', '备注'], ['party', 'content', 'ratio', 'basis', 'note']],
    deadlines: [['事项', '起算点', '依据', '到期日', '剩余', '动作', '状态'], ['item', 'start', 'basis', 'due', '_remaining', 'action', 'status']],
  };
  if (selected === 'risks') return `<div class="panel-title"><h3>八阶段风险扫描</h3></div><div class="risk-stages">${state.toolkit.risks.map((row, index) => `<div class="risk-stage"><span class="stage-no">${index < 8 ? index + 1 : '附'}</span><strong>${escapeHtml(row.stage)}</strong><p>${escapeHtml(row.check)}</p><select data-tool-bind="risks.${index}.level"><option>未发现</option><option ${row.level === '低风险' ? 'selected' : ''}>低风险</option><option ${row.level === '中风险' ? 'selected' : ''}>中风险</option><option ${row.level === '高风险' ? 'selected' : ''}>高风险</option></select></div>`).join('')}</div>`;
  const [headers, keys] = config[selected];
  return `<div class="panel-title"><h3>${selected === 'evidence' ? '证据链四要素核验表' : selected === 'liability' ? '责任划分表' : '期限倒排表'}</h3></div><div class="editable-table"><table><thead><tr>${headers.map(item => `<th>${item}</th>`).join('')}<th>操作</th></tr></thead><tbody>${state.toolkit[selected].map((row, index) => `<tr>${keys.map(key => key === '_remaining' ? `<td>${remainingDays(row.due)}</td>` : `<td><input ${key === 'due' ? 'type="date"' : ''} data-tool-bind="${selected}.${index}.${key}" value="${escapeHtml(row[key] || '')}"></td>`).join('')}<td><button class="button icon-only danger" data-tool-delete="${selected}:${index}">×</button></td></tr>`).join('')}</tbody></table></div><button class="button" style="margin-top:8px" data-tool-add="${selected}">增加一行</button>`;
}

function saveToolkit() { localStorage.setItem('toolkitState', JSON.stringify(state.toolkit)); }

async function importToolkit() {
  if (!state.currentMatterId) return;
  state.matter = await api(`/api/matters/${state.currentMatterId}`);
  const selected = state.toolkit.selected;
  if (selected === 'report') { navigate(`/analyzer/${state.currentMatterId}`); state.analyzerStep = 9; return; }
  const map = { risks: 'risks', evidence: 'evidence', liability: 'liability', deadlines: 'deadlines' };
  const sectionName = map[selected];
  if (selected === 'liability') state.matter.sections.liability = { ...(state.matter.sections.liability || {}), rows: structuredClone(state.toolkit.liability) };
  else state.matter.sections[sectionName] = structuredClone(state.toolkit[selected]);
  await api(`/api/matters/${state.currentMatterId}`, { method: 'PUT', body: state.matter });
  toast('模板已导入当前案件');
}

init();
