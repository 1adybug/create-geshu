#!/usr/bin/env node

import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import { isBuiltin } from "node:module"
import path from "node:path"
import process from "node:process"

import { input, select } from "@inquirer/prompts"

type Framework = "nextjs" | "hono" | "rsbuild" | "electron"

type UiLibrary = "antd" | "shadcn"

type TailwindVersion = "3" | "4"

type ProjectType =

        | "nextjs"
        | "nextjs-shadcn"
        | "nextjs-shadcn-t3"
        | "hono-shadcn"
        | "hono-shadcn-t3"
        | "rsbuild"
        | "rsbuild-shadcn"
        | "rsbuild-shadcn-t3"
        | "electron"
        | "electron-shadcn"

interface CliOptions {
    projectType?: ProjectType
    projectName?: string
    framework?: Framework
    uiLibrary?: UiLibrary
    tailwindVersion?: TailwindVersion
}

interface TemplateDefinition {
    type: ProjectType
    framework: Framework
    uiLibrary: UiLibrary
    tailwindVersion: TailwindVersion
    cloneUrl: string
    aliases: readonly string[]
}

interface PackageJsonContent {
    name?: string
    [key: string]: unknown
}

const TemplateDefinitions: readonly TemplateDefinition[] = [
    {
        type: "rsbuild",
        framework: "rsbuild",
        uiLibrary: "antd",
        tailwindVersion: "3",
        cloneUrl: "https://github.com/1adybug/geshu-rsbuild-template",
        aliases: ["rsbuild", "1"],
    },
    {
        type: "nextjs",
        framework: "nextjs",
        uiLibrary: "antd",
        tailwindVersion: "3",
        cloneUrl: "https://github.com/1adybug/geshu-next-template",
        aliases: ["nextjs", "next.js", "next", "2"],
    },
    {
        type: "electron",
        framework: "electron",
        uiLibrary: "antd",
        tailwindVersion: "3",
        cloneUrl: "https://github.com/1adybug/geshu-electron-template",
        aliases: ["electron", "3"],
    },
    {
        type: "rsbuild-shadcn",
        framework: "rsbuild",
        uiLibrary: "shadcn",
        tailwindVersion: "4",
        cloneUrl: "https://github.com/1adybug/geshu-rsbuild-shadcn-template",
        aliases: ["rsbuild-shadcn", "shadcn-rsbuild", "4"],
    },
    {
        type: "nextjs-shadcn",
        framework: "nextjs",
        uiLibrary: "shadcn",
        tailwindVersion: "4",
        cloneUrl: "https://github.com/1adybug/geshu-next-shadcn-template.git",
        aliases: ["next-shadcn", "nextjs-shadcn", "shadcn-next", "5"],
    },
    {
        type: "nextjs-shadcn-t3",
        framework: "nextjs",
        uiLibrary: "shadcn",
        tailwindVersion: "3",
        cloneUrl: "https://github.com/1adybug/geshu-next-shadcn-t3-template.git",
        aliases: ["next-shadcn-t3", "nextjs-shadcn-t3", "shadcn-next-t3", "6"],
    },
    {
        type: "rsbuild-shadcn-t3",
        framework: "rsbuild",
        uiLibrary: "shadcn",
        tailwindVersion: "3",
        cloneUrl: "https://github.com/1adybug/geshu-rsbuild-shadcn-t3-template.git",
        aliases: ["rsbuild-shadcn-t3", "shadcn-rsbuild-t3", "7"],
    },
    {
        type: "hono-shadcn",
        framework: "hono",
        uiLibrary: "shadcn",
        tailwindVersion: "4",
        cloneUrl: "https://github.com/1adybug/geshu-hono-shadcn-template.git",
        aliases: ["hono-shadcn", "shadcn-hono", "8"],
    },
    {
        type: "hono-shadcn-t3",
        framework: "hono",
        uiLibrary: "shadcn",
        tailwindVersion: "3",
        cloneUrl: "https://github.com/1adybug/geshu-hono-shadcn-t3-template.git",
        aliases: ["hono-shadcn-t3", "shadcn-hono-t3", "9"],
    },
    {
        type: "electron-shadcn",
        framework: "electron",
        uiLibrary: "shadcn",
        tailwindVersion: "4",
        cloneUrl: "https://github.com/1adybug/geshu-electron-shadcn-template.git",
        aliases: ["electron-shadcn", "shadcn-electron", "10"],
    },
]

const FrameworkLabels: Record<Framework, string> = {
    nextjs: "Next.js",
    hono: "Hono",
    rsbuild: "Rsbuild",
    electron: "Electron",
}

const UiLibraryLabels: Record<UiLibrary, string> = {
    antd: "Ant Design",
    shadcn: "Shadcn",
}

const TailwindVersionLabels: Record<TailwindVersion, string> = {
    "3": "TailwindCSS 3",
    "4": "TailwindCSS 4",
}

const FrameworkOrder: readonly Framework[] = ["nextjs", "hono", "rsbuild", "electron"]

const UiLibraryOrder: readonly UiLibrary[] = ["antd", "shadcn"]

const TailwindVersionOrder: readonly TailwindVersion[] = ["3", "4"]

const SupportedProjectTypes = TemplateDefinitions.map(template => template.type).join(" / ")

const TemplatePushBlockedUrl = "no_push://template"

const WindowsReservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

const NextJsGitignoreEntriesToRemove = ["prisma/migrations"]

const NextJsPrismaMigrationDirectory = "prisma/migrations"

const ShadcnMigrationDocument = "SHADCN_TAILWIND_V4_MIGRATION.md"

async function main() {
    try {
        const options = parseCliOptions(process.argv.slice(2))
        const template = options.projectType ? getTemplateDefinition(options.projectType) : await selectTemplate(options)
        const projectName = options.projectName ?? (await promptProjectName())
        const nameErrors = validateProjectName(projectName)

        if (nameErrors.length > 0) throw new Error(`项目名称不合法:\n${nameErrors.map(item => `- ${item}`).join("\n")}`)

        const targetDir = path.resolve(process.cwd(), projectName)

        await assertTargetDirectoryAvailable(targetDir, projectName)

        console.log(`\n开始创建项目: ${projectName} (${getTemplateDisplayName(template)})`)
        await runCommand("git", ["clone", template.cloneUrl, projectName], process.cwd())
        await runCommand("git", ["remote", "rename", "origin", "template"], targetDir)
        await runCommand("git", ["remote", "set-url", "--push", "template", TemplatePushBlockedUrl], targetDir)
        await updatePackageName(targetDir, projectName)

        const initCommitFiles = ["package.json"]

        if (template.uiLibrary === "shadcn") {
            const didRemoveMigrationDocument = await removeProjectFile(targetDir, ShadcnMigrationDocument)
            if (didRemoveMigrationDocument) initCommitFiles.push(ShadcnMigrationDocument)
        }

        if (template.framework === "nextjs") {
            const didUpdateGitignore = await removeGitignoreEntries(targetDir, NextJsGitignoreEntriesToRemove)
            if (didUpdateGitignore) initCommitFiles.push(".gitignore")

            const didCreateMigrationDirectory = await initializeNextJsPrismaMigration(targetDir)
            if (didCreateMigrationDirectory) initCommitFiles.push(NextJsPrismaMigrationDirectory)
        }

        await runCommand("git", ["add", ...initCommitFiles], targetDir)
        await runCommand("git", ["commit", "--no-verify", "-m", "feat: init"], targetDir)

        console.log(`\n创建完成: ${projectName}`)
    } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误，请重试。"
        console.error(`\n创建失败: ${message}`)
        process.exitCode = 1
    }
}

function parseCliOptions(args: string[]): CliOptions {
    const options: CliOptions = {}

    for (let index = 0; index < args.length; index += 1) {
        const current = args[index]

        if (current === "--type" || current === "-t") {
            const value = args[index + 1]
            if (!value) throw new Error(`参数 --type 缺少值，支持 ${SupportedProjectTypes}。`)

            const parsed = normalizeProjectType(value)

            if (!parsed) throw new Error(`参数 --type 无效: ${value}。支持 ${SupportedProjectTypes}。`)

            options.projectType = parsed
            index += 1
            continue
        }

        if (current === "--framework" || current === "-f") {
            const value = args[index + 1]
            if (!value) throw new Error("参数 --framework 缺少值，支持 nextjs / hono / rsbuild / electron。")

            const parsed = normalizeFramework(value)

            if (!parsed) throw new Error(`参数 --framework 无效: ${value}。支持 nextjs / hono / rsbuild / electron。`)

            options.framework = parsed
            index += 1
            continue
        }

        if (current === "--ui" || current === "-u") {
            const value = args[index + 1]
            if (!value) throw new Error("参数 --ui 缺少值，支持 antd / shadcn。")

            const parsed = normalizeUiLibrary(value)

            if (!parsed) throw new Error(`参数 --ui 无效: ${value}。支持 antd / shadcn。`)

            options.uiLibrary = parsed
            index += 1
            continue
        }

        if (current === "--tailwind" || current === "--tw") {
            const value = args[index + 1]
            if (!value) throw new Error("参数 --tailwind 缺少值，支持 3 / 4。")

            const parsed = normalizeTailwindVersion(value)

            if (!parsed) throw new Error(`参数 --tailwind 无效: ${value}。支持 3 / 4。`)

            options.tailwindVersion = parsed
            index += 1
            continue
        }

        if (current === "--name" || current === "-n") {
            const value = args[index + 1]
            if (!value) throw new Error("参数 --name 缺少值。")

            options.projectName = value.trim()
            index += 1
            continue
        }
    }

    if (options.projectType && (options.framework || options.uiLibrary || options.tailwindVersion))
        throw new Error("参数 --type 不能与 --framework、--ui 或 --tailwind 同时使用。")

    return options
}

function normalizeProjectType(input: string): ProjectType | null {
    const value = input.trim().toLowerCase()
    const template = TemplateDefinitions.find(
        item => item.type === value || getTemplateDisplayName(item).toLowerCase() === value || item.aliases.some(alias => alias === value),
    )

    return template?.type ?? null
}

function normalizeFramework(input: string): Framework | null {
    const value = input.trim().toLowerCase()

    if (value === "nextjs" || value === "next.js" || value === "next") return "nextjs"
    if (value === "hono") return "hono"
    if (value === "rsbuild") return "rsbuild"
    if (value === "electron") return "electron"

    return null
}

function normalizeUiLibrary(input: string): UiLibrary | null {
    const value = input.trim().toLowerCase()

    if (value === "antd" || value === "ant-design" || value === "ant design") return "antd"
    if (value === "shadcn" || value === "shadcn/ui") return "shadcn"

    return null
}

function normalizeTailwindVersion(input: string): TailwindVersion | null {
    const value = input.trim().toLowerCase().replaceAll(" ", "")

    if (value === "3" || value === "v3" || value === "tailwind3" || value === "tailwindcss3") return "3"
    if (value === "4" || value === "v4" || value === "tailwind4" || value === "tailwindcss4") return "4"

    return null
}

function getTemplateDefinition(projectType: ProjectType): TemplateDefinition {
    const template = TemplateDefinitions.find(item => item.type === projectType)
    if (!template) throw new Error(`未知项目类型: ${projectType}`)

    return template
}

function getTemplateDisplayName(template: TemplateDefinition): string {
    return `${FrameworkLabels[template.framework]} + ${UiLibraryLabels[template.uiLibrary]} + ${TailwindVersionLabels[template.tailwindVersion]}`
}

async function selectTemplate(options: CliOptions): Promise<TemplateDefinition> {
    const framework = options.framework ?? (await promptFramework())
    const uiLibrary = options.uiLibrary ?? (await promptUiLibrary(framework))

    assertUiLibraryAvailable(framework, uiLibrary)

    if (framework === "electron") {
        if (options.tailwindVersion) throw new Error("Electron 项目不支持选择 TailwindCSS 版本，请移除 --tailwind 参数。")

        return getTemplateBySelection(framework, uiLibrary)
    }

    const tailwindVersion = options.tailwindVersion ?? (await promptTailwindVersion(framework, uiLibrary))
    assertTailwindVersionAvailable(framework, uiLibrary, tailwindVersion)

    return getTemplateBySelection(framework, uiLibrary, tailwindVersion)
}

function getTemplateBySelection(framework: Framework, uiLibrary: UiLibrary, tailwindVersion?: TailwindVersion): TemplateDefinition {
    const templates = TemplateDefinitions.filter(
        template =>
            template.framework === framework && template.uiLibrary === uiLibrary && (framework === "electron" || template.tailwindVersion === tailwindVersion),
    )

    if (templates.length !== 1) {
        const selection = [FrameworkLabels[framework], UiLibraryLabels[uiLibrary], tailwindVersion && TailwindVersionLabels[tailwindVersion]]
            .filter(Boolean)
            .join(" + ")

        throw new Error(`没有唯一匹配的项目模板: ${selection}。`)
    }

    return templates[0]
}

function assertUiLibraryAvailable(framework: Framework, uiLibrary: UiLibrary) {
    if (isUiLibraryAvailable(framework, uiLibrary)) return

    const supported = getAvailableUiLibraries(framework)
        .map(item => UiLibraryLabels[item])
        .join(" / ")

    throw new Error(`${FrameworkLabels[framework]} 不支持 ${UiLibraryLabels[uiLibrary]}，可选 ${supported}。`)
}

function isUiLibraryAvailable(framework: Framework, uiLibrary: UiLibrary): boolean {
    return TemplateDefinitions.some(template => template.framework === framework && template.uiLibrary === uiLibrary)
}

function getAvailableUiLibraries(framework: Framework): UiLibrary[] {
    return UiLibraryOrder.filter(uiLibrary => isUiLibraryAvailable(framework, uiLibrary))
}

function isTailwindVersionAvailable(framework: Framework, uiLibrary: UiLibrary, tailwindVersion: TailwindVersion): boolean {
    return TemplateDefinitions.some(
        template => template.framework === framework && template.uiLibrary === uiLibrary && template.tailwindVersion === tailwindVersion,
    )
}

function getAvailableTailwindVersions(framework: Framework, uiLibrary: UiLibrary): TailwindVersion[] {
    return TailwindVersionOrder.filter(tailwindVersion => isTailwindVersionAvailable(framework, uiLibrary, tailwindVersion))
}

function assertTailwindVersionAvailable(framework: Framework, uiLibrary: UiLibrary, tailwindVersion: TailwindVersion) {
    if (isTailwindVersionAvailable(framework, uiLibrary, tailwindVersion)) return

    const supported = getAvailableTailwindVersions(framework, uiLibrary)
        .map(item => TailwindVersionLabels[item])
        .join(" / ")

    throw new Error(`${FrameworkLabels[framework]} + ${UiLibraryLabels[uiLibrary]} 不支持 ${TailwindVersionLabels[tailwindVersion]}，可选 ${supported}。`)
}

async function promptFramework(): Promise<Framework> {
    return select<Framework>({
        message: "请选择项目框架:",
        choices: FrameworkOrder.map(framework => ({
            name: FrameworkLabels[framework],
            value: framework,
        })),
    })
}

async function promptUiLibrary(framework: Framework): Promise<UiLibrary> {
    return select<UiLibrary>({
        message: "请选择 UI 组件库:",
        choices: UiLibraryOrder.map(uiLibrary => ({
            name: UiLibraryLabels[uiLibrary],
            value: uiLibrary,
            disabled: isUiLibraryAvailable(framework, uiLibrary) ? false : "暂无可用模板",
        })),
    })
}

async function promptTailwindVersion(framework: Framework, uiLibrary: UiLibrary): Promise<TailwindVersion> {
    return select<TailwindVersion>({
        message: "请选择 TailwindCSS 版本:",
        choices: TailwindVersionOrder.map(tailwindVersion => ({
            name: TailwindVersionLabels[tailwindVersion],
            value: tailwindVersion,
            disabled: isTailwindVersionAvailable(framework, uiLibrary, tailwindVersion) ? false : "暂无可用模板",
        })),
    })
}

async function promptProjectName(): Promise<string> {
    const answer = await input({
        message: "请输入项目名称:",
        validate: value => {
            const name = value.trim()
            if (!name) return "项目名称不能为空。"

            const errors = validateProjectName(name)
            if (errors.length === 0) return true

            return `项目名称不合法: ${errors.join("；")}`
        },
    })

    return answer.trim()
}

function validateProjectName(name: string): string[] {
    const errors: string[] = []

    const directoryError = validateDirectoryName(name)
    if (directoryError) errors.push(directoryError)

    const packageErrors = validatePackageJsonName(name)
    errors.push(...packageErrors)

    return errors
}

function validateDirectoryName(name: string): string | null {
    if (name === "." || name === "..") return "目录名不能是 . 或 ..。"

    if (name !== path.basename(name)) return "目录名不能包含路径分隔符。"

    if (/[<>:"/\\|?*]/.test(name) || hasAsciiControlChars(name)) return "目录名包含非法字符。"

    if (/[. ]$/.test(name)) return "目录名不能以空格或点号结尾。"

    if (WindowsReservedNames.test(name)) return "目录名是 Windows 保留名称。"

    return null
}

function hasAsciiControlChars(input: string): boolean {
    for (const char of input) {
        const code = char.charCodeAt(0)
        if (code >= 0 && code <= 31) return true
    }

    return false
}

function validatePackageJsonName(name: string): string[] {
    const errors: string[] = []

    const packageNamePattern = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

    if (name.length > 214) errors.push("package.json 的 name 长度不能超过 214 个字符。")

    if (name.startsWith(".") || name.startsWith("_")) errors.push("package.json 的 name 不能以 . 或 _ 开头。")

    if (/[A-Z]/.test(name)) errors.push("package.json 的 name 不能包含大写字母。")

    if (isBuiltin(name)) errors.push("package.json 的 name 不能与 Node.js 内置模块冲突。")

    if (!packageNamePattern.test(name)) errors.push("package.json 的 name 必须是 URL 友好的 npm 包名。")

    return errors
}

async function assertTargetDirectoryAvailable(targetDir: string, projectName: string) {
    try {
        const stat = await fs.stat(targetDir)

        if (!stat.isDirectory()) throw new Error(`路径 ${projectName} 已存在且不是目录。`)

        const files = await fs.readdir(targetDir)

        if (files.length === 0) throw new Error(`已存在同名空目录 "${projectName}"，请删除后再执行命令。`)

        throw new Error(`已存在同名非空目录 "${projectName}"，无法继续创建。`)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return

        throw error
    }
}

async function updatePackageName(projectDir: string, name: string) {
    const packageJsonPath = path.join(projectDir, "package.json")
    const content = await fs.readFile(packageJsonPath, "utf8")

    let parsed: PackageJsonContent

    try {
        parsed = JSON.parse(content) as PackageJsonContent
    } catch {
        throw new Error("模板中的 package.json 不是有效 JSON。")
    }

    parsed.name = name
    await fs.writeFile(packageJsonPath, `${JSON.stringify(parsed, null, 4)}\n`, "utf8")
}

async function removeProjectFile(projectDir: string, relativePath: string): Promise<boolean> {
    try {
        await fs.unlink(path.join(projectDir, relativePath))
        return true
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false

        throw error
    }
}

async function removeGitignoreEntries(projectDir: string, entries: string[]): Promise<boolean> {
    const gitignorePath = path.join(projectDir, ".gitignore")
    let content: string

    try {
        content = await fs.readFile(gitignorePath, "utf8")
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false

        throw error
    }

    const entriesToRemove = new Set(entries)
    const lines = content.split(/\r?\n/)
    const filteredLines = lines.filter(line => !entriesToRemove.has(line.trim()))

    if (filteredLines.length === lines.length) return false

    const newline = content.includes("\r\n") ? "\r\n" : "\n"
    await fs.writeFile(gitignorePath, filteredLines.join(newline), "utf8")

    return true
}

async function initializeNextJsPrismaMigration(projectDir: string): Promise<boolean> {
    await runCommand("npx", ["--yes", "prisma", "migrate", "dev", "--name", "init", "--create-only"], projectDir, {
        env: { NODE_ENV: "development" },
    })

    return pathExists(path.join(projectDir, NextJsPrismaMigrationDirectory))
}

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath)
        return true
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false

        throw error
    }
}

interface RunCommandOptions {
    env?: NodeJS.ProcessEnv
}

async function runCommand(command: string, args: string[], cwd: string, options: RunCommandOptions = {}) {
    const display = `${command} ${args.join(" ")}`
    console.log(`\n> ${display}`)

    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env: options.env ? { ...process.env, ...options.env } : process.env,
            stdio: "inherit",
        })

        child.once("error", error => {
            reject(error)
        })

        child.once("close", code => {
            if (code === 0) {
                resolve()
                return
            }

            reject(new Error(`命令执行失败（退出码 ${code}）: ${display}`))
        })
    })
}

void main()
