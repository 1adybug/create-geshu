#!/usr/bin/env node

import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import { isBuiltin } from "node:module"
import path from "node:path"
import process from "node:process"

import { input, select } from "@inquirer/prompts"

type ProjectType = "Rsbuild" | "Next.js"

interface CliOptions {
    projectType?: ProjectType
    projectName?: string
}

interface PackageJsonContent {
    name?: string
    [key: string]: unknown
}

const TemplateMap: Record<ProjectType, string> = {
    Rsbuild: "https://github.com/1adybug/geshu-rsbuild-template",
    "Next.js": "https://github.com/1adybug/geshu-next-template",
}

const ProjectTypeChoices: readonly ProjectType[] = ["Rsbuild", "Next.js"]

const TemplatePushBlockedUrl = "no_push://template"

const WindowsReservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

async function main() {
    try {
        const options = parseCliOptions(process.argv.slice(2))
        const projectType = options.projectType ?? (await promptProjectType())
        const projectName = options.projectName ?? (await promptProjectName())
        const nameErrors = validateProjectName(projectName)

        if (nameErrors.length > 0) throw new Error(`项目名称不合法:\n${nameErrors.map(item => `- ${item}`).join("\n")}`)

        const targetDir = path.resolve(process.cwd(), projectName)

        await assertTargetDirectoryAvailable(targetDir, projectName)

        const templateCloneUrl = TemplateMap[projectType]

        console.log(`\n开始创建项目: ${projectName} (${projectType})`)
        await runCommand("git", ["clone", templateCloneUrl, projectName], process.cwd())
        await runCommand("git", ["remote", "rename", "origin", "template"], targetDir)
        await runCommand("git", ["remote", "set-url", "--push", "template", TemplatePushBlockedUrl], targetDir)
        await updatePackageName(targetDir, projectName)
        await runCommand("git", ["add", "package.json"], targetDir)
        await runCommand("git", ["commit", "-m", "✨feature: init"], targetDir)

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
            if (!value) throw new Error("参数 --type 缺少值，支持 Rsbuild / Next.js。")

            const parsed = normalizeProjectType(value)

            if (!parsed) throw new Error(`参数 --type 无效: ${value}。支持 Rsbuild / Next.js。`)

            options.projectType = parsed
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

    return options
}

function normalizeProjectType(input: string): ProjectType | null {
    const value = input.trim().toLowerCase()

    if (value === "rsbuild" || value === "1") return "Rsbuild"

    if (value === "nextjs" || value === "next.js" || value === "next" || value === "2") return "Next.js"

    return null
}

async function promptProjectType(): Promise<ProjectType> {
    return select<ProjectType>({
        message: "请选择项目类型:",
        choices: ProjectTypeChoices,
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
    await fs.writeFile(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
}

async function runCommand(command: string, args: string[], cwd: string) {
    const display = `${command} ${args.join(" ")}`
    console.log(`\n> ${display}`)

    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
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
