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
- AI 接口默认关闭。可通过 `DISPUTE_EXPERT_AI_ENDPOINT` 环境变量标记为已配置，但首版不会自动向外发送资料。

## 测试

```powershell
python -m unittest discover -s tests -v
node --check static\app.js
```
