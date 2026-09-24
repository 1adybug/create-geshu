# create-geshu

交互创建项目：

```sh
npx create-geshu@latest
```

也可以通过参数选择模板和项目名称，例如：

```sh
npx create-geshu@latest --type nextjs-shadcn --name my-app --no-local-license
npx create-geshu@latest --framework nextjs --ui shadcn --tailwind 4 --name my-app
```

## Next.js 初始化

三种 Next.js 模板均从自己的 `package.json` 读取 Prisma 版本范围，下载相应版本的 CLI，基于当前 schema 生成项目独立的初始迁移。首次下载需要网络，等待期间会显示阶段、版本范围和已用时间。

创建过程不会安装整个项目的依赖，也不会创建或修改业务数据库。初始 SQL 和 `migration_lock.toml` 会纳入项目的 `feat: init` 提交。

创建后进入项目，使用自己的包管理器安装依赖，再执行：

```sh
npm run db:dev
npm run dev
```

命令失败或取消时保留项目目录，并指出失败阶段。请检查保留的文件后手工完成初始化，或换一个不存在的项目目录重新创建；脚手架不会覆盖已有项目。

## 本地授权

Next.js 项目会询问“是否开启本地授权？”，默认关闭。这里指部署时的本地离线许可证，不是账号登录；本地开发仍沿用模板的 `mock` 模式。

- `--no-local-license`：跳过询问，移除新项目中的 `license/`，业务打包使用无授权模式。授权相关应用代码和维护脚本仍保留。
- `--local-license`：跳过开关询问，立即进入模板授权向导。需要交互终端，使用已有统一签发材料，或导入已签好的当前项目策略。
- 不传开关：交互终端默认选择关闭；非交互环境直接关闭。

开启时保留模板通用 Agent，重新生成与项目名称和主版本匹配的策略、安装脚本及清单。签名、Agent 和交付文件校验全部通过后才纳入初始化提交。取消向导或缺少材料会停止创建，不会沿用模板策略或自动切换为关闭。

脚手架不会生成签发私钥或签发客户许可证。签发私钥保存在项目外的现有签发目录，通过 `GESHU_LICENSE_ISSUER_DIR` 指定，或使用模板默认目录。

## 开发验证

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:templates
```

模板集成验证会在系统临时目录克隆三个当前 Next 模板，运行打包后的 CLI，并用内存 SQLite 验证迁移。授权场景只使用临时测试签发材料，不访问真实私钥，不生成镜像或发布。
