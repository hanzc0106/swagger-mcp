# Swagger MCP

一个独立的 stdio MCP 服务，用于在任意业务项目中维护多后端服务的 Swagger/OpenAPI 本地缓存，并提供离线接口检索能力。

后端 Swagger JSON 地址通常固定，但开发时不应每次查询接口都访问远程服务。Swagger MCP 用服务名定位文档，默认只查询本地缓存；只有明确执行刷新工具时，才会重新请求远程 Swagger JSON。

## 核心行为

- MCP 工具本体可被多个项目复用。
- 每个业务项目拥有自己的 .swagger-mcp 配置和缓存。
- 查询类工具只读本地缓存，不会自动联网更新。
- refresh_service 和 refresh_all_services 是仅有的远程 Swagger 拉取入口。
- 服务以稳定名称调用，例如 datapool、timeline，不需要重复提供 URL。
- 成功刷新后，服务配置中的 updatedAt 会记录缓存更新时间。

## 架构

~~~text
<installation-dir>/                       # MCP 工具本体
  bin\
  src\

<workspace>/                              # 被接入的业务项目
  .swagger-mcp\
    config.json                           # 服务名称、URL 与更新时间
    cache\
      datapool.openapi.json               # 本地 Swagger/OpenAPI 缓存
      timeline.openapi.json
~~~

swagger-mcp 不属于业务项目源码。.swagger-mcp 则是该业务项目独有的运行时状态，不同项目可以有不同的服务清单、环境地址和缓存版本。

## Requirements

- Node.js 18 或更高版本
- 支持 stdio MCP 的客户端，例如 Codex

当前实现仅依赖 Node.js 内置模块，无需安装第三方依赖。

## 快速开始

### 1. 获取并验证工具

~~~powershell
git clone https://github.com/hanzc0106/swagger-mcp.git <your-path>/swagger-mcp
cd <your-path>/swagger-mcp
npm test
~~~

### 2. 注册到 Codex

以下命令会注册一个名为 swagger-local 的全局 stdio MCP。注册只声明工具本体，不绑定任何业务项目：

~~~powershell
codex mcp add swagger-local -- node <installation-dir>/bin/swagger-mcp.js
~~~

验证注册结果：

~~~powershell
codex mcp get swagger-local
codex mcp list
~~~

注册后请重启 Codex 或新建任务，使客户端重新启动 MCP 并发现 tools。

等价的 Codex TOML 配置如下：

~~~toml
[mcp_servers.swagger-local]
type = "stdio"
command = "node"
args = [
  "<installation-dir>/bin/swagger-mcp.js"
]
~~~

业务项目是工具调用时的运行时上下文，而不是 Codex 全局 MCP 配置的一部分。一个已注册的 Swagger MCP 应可服务多个项目，各项目分别维护自己的 .swagger-mcp 目录。

### 3. 初始化业务项目

在 Agent 中调用 init_project。它将创建：

~~~text
<workspace>/.swagger-mcp/
  config.json
  cache/
~~~

注意：如果项目根目录中已经存在名为 .swagger-mcp 的文件，它会与需要创建的同名目录冲突。请先迁移或重命名旧文件，工具不会覆盖它。

### 4. 添加并刷新服务

先添加固定的 Swagger JSON 地址：

~~~text
add_service(
  service = "datapool",
  url = "http://example.com/datapool/swagger/v1/swagger.json"
)
~~~

再明确刷新缓存：

~~~text
refresh_service(service = "datapool")
~~~

刷新成功后即可离线搜索：

~~~text
search_operations(service = "datapool", keyword = "well")
~~~

## 项目配置

<workspace>/.swagger-mcp/config.json 示例：

~~~json
{
  "services": {
    "datapool": {
      "url": "http://example.com/datapool/swagger/v1/swagger.json",
      "updatedAt": "2026-08-14T08:30:00.000Z"
    },
    "timeline": {
      "url": "http://example.com/timeline/swagger/v1/swagger.json",
      "updatedAt": null
    }
  }
}
~~~

| 字段 | 含义 |
| --- | --- |
| services | 以服务名为键的 Swagger 服务集合。服务名只能包含字母、数字、下划线和连字符。 |
| url | 固定 Swagger/OpenAPI JSON 地址。支持 http、https 和本地 file URL。 |
| updatedAt | 最近一次成功写入本地缓存的 ISO 8601 时间。null 表示尚未成功刷新。 |

缓存文件位于：

~~~text
<workspace>/.swagger-mcp/cache/<service>.openapi.json
~~~

## MCP Tools

### 项目与服务管理

| Tool | 联网 | 说明 |
| --- | --- | --- |
| init_project | 否 | 初始化当前工作区的 .swagger-mcp。 |
| list_services | 否 | 列出配置服务及缓存状态、缓存大小、文档信息和 updatedAt。 |
| add_service | 否 | 添加服务名与 Swagger JSON URL，不会自动拉取文档。 |
| update_service | 否 | 修改已有服务 URL，不会自动刷新。 |
| remove_service | 否 | 删除服务配置；已有缓存文件会保留，避免无意丢失本地快照。 |

### 缓存刷新

| Tool | 联网 | 说明 |
| --- | --- | --- |
| refresh_service | 是 | 根据已保存的 URL 拉取一个服务的 Swagger JSON，校验后覆盖该服务缓存，并更新 updatedAt。 |
| refresh_all_services | 是 | 依次刷新全部已配置服务；单个服务失败不会阻止其他服务刷新。 |

刷新失败时，原有缓存会保留，updatedAt 不会更新。

### 缓存查询

| Tool | 联网 | 说明 |
| --- | --- | --- |
| search_operations | 否 | 通过关键词、HTTP 方法、Tag 搜索本地缓存中的接口。 |
| get_operation | 否 | 根据 operationId，或 method 加 path 读取完整接口定义。 |
| get_schema | 否 | 读取并展开一个 OpenAPI schema 或 Swagger 2 definitions schema。 |
| generate_request_example | 否 | 为指定接口生成 curl、axios 或 fetch 请求示例。 |

如果未找到本地缓存，查询工具会报错并提示先执行 refresh_service，但不会自行请求远程地址。

## 常见调用

### 查看当前缓存状态

~~~text
list_services()
~~~

结果会包含服务 URL、updatedAt、是否存在缓存、缓存文件位置、文档标题、OpenAPI 版本和接口数量。

### 搜索接口

~~~text
search_operations(
  service = "datapool",
  keyword = "well",
  method = "GET",
  tag = "Well",
  limit = 20
)
~~~

keyword 会匹配路径、HTTP 方法、operationId、摘要、描述和 Tag。

### 获取接口完整定义

~~~text
get_operation(
  service = "datapool",
  operationId = "listWells"
)
~~~

也可以使用：

~~~text
get_operation(
  service = "datapool",
  method = "GET",
  path = "/api/wells"
)
~~~

返回内容包括参数、请求体、响应、鉴权配置，并解析文档内的本地 $ref。

### 生成请求示例

~~~text
generate_request_example(
  service = "datapool",
  operationId = "updateWell",
  format = "axios",
  baseUrl = "https://api.example.com"
)
~~~

format 支持 curl、axios、fetch。若未提供 baseUrl，会使用 OpenAPI servers 第一个地址；若文档未配置服务地址，则使用 <baseUrl> 占位符。

## 安全与隐私

- Swagger URL 可能是内网地址，不应提交到公开仓库。
- OpenAPI 文档可能暴露内部接口、字段和鉴权描述，请按团队数据规则处理缓存文件。
- 本工具只下载 Swagger/OpenAPI 文档，不会调用业务 API。
- 不存在自动刷新或后台定时刷新，所有网络请求都由刷新工具显式触发。
- 不要将 Token、Cookie、认证 Header 写入可提交的 config.json。
- 建议将本地环境地址和缓存加入业务项目的 .gitignore，例如：

~~~gitignore
.swagger-mcp/cache/
~~~

是否提交 config.json 取决于服务 URL 是否敏感，以及团队是否需要共享服务清单。

## 开发与测试

~~~powershell
cd <installation-dir>
npm test
~~~

测试覆盖以下主流程：

~~~text
初始化工作区
  -> 添加 file URL 服务
  -> 显式刷新缓存
  -> 搜索接口
  -> 查询 schema
  -> 生成请求示例
~~~

可直接以 stdio 方式运行服务：

~~~powershell
node <installation-dir>/bin/swagger-mcp.js --workspace <workspace>
~~~

服务使用 JSON-RPC over stdio。初始化后通过 tools/list 声明能力，并通过 tools/call 执行具体工具。

## 代码结构

~~~text
bin/
  swagger-mcp.js       MCP 进程入口
src/
  server.js            JSON-RPC 协议、工具声明与分发
  workspace.js         工作区和 .swagger-mcp 路径解析
  config.js            config.json 初始化与服务配置读写
  cache.js             Swagger 缓存读写与显式刷新
  openapi.js           OpenAPI/Swagger 解析、$ref 展开与示例生成
tests/
  fixtures/            测试 OpenAPI 文档
  run-tests.js         端到端主流程测试
~~~

## 当前限制

- 支持 JSON 格式的 OpenAPI/Swagger 文档，不支持 YAML。
- 支持文档内部的本地 $ref，不支持跨文件或远程 $ref。
- 不管理 Token、Cookie、认证 Header。
- 不直接调用业务接口。
- 不提供自动刷新、定时刷新或远程缓存同步。

## Roadmap

- 支持 OpenAPI YAML
- 支持 ETag / Last-Modified 以优化显式刷新
- 支持两份 Swagger 文档的接口差异比较
- 支持本地私有认证配置
- 增加更多 MCP 客户端注册示例
- 发布为可安装的 npm 包
