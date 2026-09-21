# 工程纠纷处理专家 · 本地可视化界面

本项目将 `construction-dispute-expert.zip` 中的 185 篇案例、23 份公司制度和纠纷处理模板组织为本机知识检索与案件分析系统。

## 启动

在 PowerShell 中运行：

```powershell
.\run.ps1
```

浏览器打开 `http://127.0.0.1:8765`。

## 数据与安全

- 服务只监听 `127.0.0.1`。
- 案件草稿保存在 `data/dispute_expert.db`。
- 原始专家包解压副本保存在 `source/extracted/`，原 ZIP 不会被修改。
- 制度文本均无法证明已正式发布；引用时必须带编号和版本状态。
- 行业案例属于经验素材，不是法规或裁判文书。
- AI 接口默认关闭。配置 `DISPUTE_EXPERT_AI_API_KEY` 后，后端通过 Responses API 代理调用模型；API Key 不会由后端返回给浏览器或保存到 SQLite。
- 默认模型为 `gpt-6-astra`，可通过 `DISPUTE_EXPERT_AI_MODEL` 修改；还可配置 `DISPUTE_EXPERT_AI_BASE_URL`、`DISPUTE_EXPERT_AI_REASONING_EFFORT`、`DISPUTE_EXPERT_AI_TIMEOUT` 和 `DISPUTE_EXPERT_AI_MAX_OUTPUT_TOKENS`。
- AI 只在纠纷分析页或报告页明确点击按钮后调用。默认发送案件摘要、当前分析内容和已加入案件的依据；公司处理意见、内部动作、API Key 和本地路径不会发送。
- 未配置 API Key 时，`/api/ai/status` 返回未启用，案例库、制度库、案件工作台和报告导出仍可离线使用。
- 模型结果仅作为 AI 草稿，不自动覆盖案件字段；法律和制度结论仍需人工或律师核验。
- 左侧“API 配置”可添加当前服务会话使用的 OpenAI Key。Key 仅保存在后端进程内存中，不写入浏览器存储、SQLite 或日志，服务重启后自动清除。
- 保存配置后使用“测试连接”验证 Key、模型和 Responses API；只有测试通过后，纠纷分析页才启用 AI 分析按钮。测试请求不发送案件资料。

## 测试

```powershell
python -m unittest discover -s tests -v
node --check static\app.js
```

## 启用 AI（可选）

在 PowerShell 中为当前终端配置：

```powershell
$env:DISPUTE_EXPERT_AI_API_KEY = "你的 API Key"
$env:DISPUTE_EXPERT_AI_MODEL = "gpt-6-astra"
.\run.ps1
```

不要把 API Key 写入前端文件、Git 仓库、SQLite 数据库或截图。未配置时无需额外操作，系统继续使用本地知识库。
