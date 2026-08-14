# 发布指南

本文说明如何发布 @hanzc/swagger-mcp。

## 发布模型

当前项目是纯 Node.js ESM MCP 服务，没有 TypeScript 转译和第三方运行时依赖。因此发布前需要执行 npm 打包，而不需要额外引入 Webpack、esbuild 或 tsup 做 JavaScript bundle。

两者区别如下：

| 操作 | 是否需要 | 作用 |
| --- | --- | --- |
| npm pack | 是 | 根据 package.json 的 files 白名单生成可发布的 npm tarball。 |
| JavaScript bundle | 否 | 合并或压缩源文件；当前项目没有兼容性、依赖打入或源码保护需求。 |

发布包仅包含：

~~~text
bin/
src/
README.md
LICENSE
package.json
~~~

## 发布前准备

- 已登录拥有 hanzc npm scope 的 npm 账号或组织。
- 已按照团队策略配置 npm 双因素认证和自动化 Token。
- 工作区没有未确认的修改。
- 已更新版本号、README 和 CHANGELOG（如项目开始维护变更日志）。

## 发布前检查

先运行测试、语法检查和 npm 打包预览：

~~~powershell
npm test
node --check bin/swagger-mcp.js
node --check src/server.js
npm pack --dry-run
~~~

检查 npm pack --dry-run 输出，确认未包含：

~~~text
.git/
tests/
.swagger-mcp/
本地缓存
Token、.npmrc 或其他机密配置
~~~

然后生成本地 tarball：

~~~powershell
npm pack
~~~

应在干净目录中安装该 tarball，并验证 MCP 能完成 initialize 和 tools/list 握手。发布完成后不要提交生成的 tgz 文件。

## 版本管理

使用语义化版本：

| 变更类型 | 命令 | 适用场景 |
| --- | --- | --- |
| 修订版 | npm version patch | 修复缺陷，不改变工具契约。 |
| 次版本 | npm version minor | 新增兼容的 MCP tool 或参数。 |
| 主版本 | npm version major | 删除 tool、修改必填参数或破坏配置兼容性。 |

执行 npm version 会更新 package.json、创建 Git tag，并通常提交版本变更。执行前应确认 Git 工作区状态。

## 发布

~~~powershell
npm publish
git push --follow-tags
~~~

package.json 中的 prepublishOnly 会在发布前运行 npm test；测试失败时 npm 不会继续发布。

发布后可验证公开包信息：

~~~powershell
npm view @hanzc/swagger-mcp
~~~

## 用户安装与 Codex 集成

用户全局安装包：

~~~powershell
npm install -g @hanzc/swagger-mcp
~~~

然后向 Codex 注册一次全局 stdio MCP：

~~~powershell
codex mcp add swagger-local -- swagger-mcp
~~~

也可使用 npx 运行固定版本，无需全局安装：

~~~powershell
codex mcp add swagger-local -- npx -y @hanzc/swagger-mcp@0.1.0
~~~

不要在 Codex 注册阶段写入业务项目路径。每个项目相关 tool 调用都必须传入绝对路径 workspace，因此一个 MCP 注册可以服务多个业务项目。

## 发布验收

发布后至少验证：

~~~text
npm 安装成功
swagger-mcp 命令可启动
Codex 可发现 tools/list 中的工具
init_project 可在指定 workspace 创建 .swagger-mcp
refresh_service 只在显式调用时请求远程文档
search_operations 只读取本地缓存
~~~
