import process from "node:process"

import spawn from "cross-spawn"
import { type Agent, type Command, type DetectResult, detect, getUserAgent, resolveCommand } from "package-manager-detector"
import { coerce, gte } from "semver"

export async function detectPackageManager(cwd = process.cwd()): Promise<DetectResult> {
    const name = getUserAgent()
    let manager: DetectResult | null

    if (name) {
        const version = coerce(process.env.npm_config_user_agent?.split(" ")[0].slice(name.length + 1))
        // getUserAgent 返回名称；命令映射还需要区分 Yarn Classic/Berry 和旧版 pnpm。
        let agent: Agent = name
        if (name === "yarn" && version && version.major > 1) agent = "yarn@berry"
        if (name === "pnpm" && version && version.major < 7) agent = "pnpm@6"
        manager = { name, agent, version: version?.version }
    } else
        // 只检查启动目录，不读取刚克隆的模板，也不借用父目录项目的包管理器。
        manager = await detect({ cwd, stopDir: cwd, strategies: ["packageManager-field", "devEngines-field", "lockfile"] })

    manager ??= { name: "npm", agent: "npm" }
    if (!["npm", "pnpm", "yarn", "bun"].includes(manager.name)) throw new Error(`暂不支持 ${manager.name}，请使用 npm、pnpm、Yarn 或 Bun 启动脚手架。`)
    return manager
}

export function getPackageManagerCommand(manager: DetectResult, command: Command, args: string[] = []) {
    const result = resolveCommand(manager.agent, command, args)
    if (!result) throw new Error(`${manager.name} 不支持 ${command} 命令。`)
    return result
}

export function getPrismaCommand(manager: DetectResult, version: string, args: string[]) {
    const result = getPackageManagerCommand(manager, "execute", [`prisma@${version}`, ...args])

    // 嵌套 npx 会继承外层 npm_config_package；显式指定包和入口，避免执行外层包。
    if (result.command === "npx") result.args = ["--yes", "--package", `prisma@${version}`, "prisma", ...args]

    // pnpm 11 的 dlx 会询问依赖构建审批；只批准 Prisma 必需的引擎，不放开其他包。
    if (manager.agent === "pnpm" && gte(getPnpmVersion(manager), "10.2.0")) result.args.splice(1, 0, "--allow-build=@prisma/engines")

    return result
}

function getPnpmVersion(manager: DetectResult) {
    const version = coerce(manager.version)
    if (version) return version

    // 锁文件检测没有版本信息，查询启动环境中的可执行文件以兼容旧版 pnpm。
    const result = spawn.sync("pnpm", ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10_000 })

    const detected = coerce(result.stdout?.trim())
    if (result.error || result.status !== 0 || !detected)
        throw new Error("无法确认 pnpm 版本，不能生成 Prisma 执行命令；请检查 pnpm --version 是否正常。", { cause: result.error })
    return detected
}

export function getNextJsSetupCommands(manager: DetectResult): string {
    return [
        getPackageManagerCommand(manager, "install"),
        getPackageManagerCommand(manager, "run", ["db:dev"]),
        getPackageManagerCommand(manager, "run", ["dev"]),
    ]
        .map(({ command, args }) => [command, ...args].join(" "))
        .join("，")
}
