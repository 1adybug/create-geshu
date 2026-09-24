import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

import type { DetectResult } from "package-manager-detector"
import { minVersion, validRange } from "semver"

import { type CommandRunner, runCommand } from "./commands.ts"
import { getPrismaCommand } from "./package-manager.ts"

export const NextJsPrismaMigrationDirectory = "prisma/migrations"

interface PrismaPackageJson {
    devDependencies?: Record<string, unknown>
    dependencies?: Record<string, unknown>
}

export function getPrismaVersion(packageJson: PrismaPackageJson): string {
    const version = packageJson.devDependencies?.prisma ?? packageJson.dependencies?.prisma
    if (typeof version !== "string" || !validRange(version) || !minVersion(version)?.major)
        throw new Error("模板必须在 package.json 中声明明确的 Prisma 版本范围，不能使用 latest 或通配版本。")
    return version.trim()
}

export async function initializeNextJsPrismaMigration(projectDir: string, packageManager: DetectResult, run: CommandRunner = runCommand) {
    const packageJson = JSON.parse(await fs.readFile(path.join(projectDir, "package.json"), "utf8"))
    const version = getPrismaVersion(packageJson)
    const schema = await fs.readFile(path.join(projectDir, "prisma/schema.prisma"), "utf8")
    if (!/datasource\s+\w+\s*\{[^}]*\bprovider\s*=\s*"sqlite"/s.test(schema))
        throw new Error("当前 Next 模板初始化要求 SQLite schema，请检查模板的数据库配置。")
    await fs.access(path.join(projectDir, "prisma.config.ts"))

    const migrationDirectory = path.join(projectDir, NextJsPrismaMigrationDirectory)
    if (await pathExists(migrationDirectory)) throw new Error("模板已包含迁移目录，无法覆盖并生成当前项目的初始迁移。")
    await fs.mkdir(path.join(migrationDirectory, "0_init"), { recursive: true })
    const sqlPath = path.join(migrationDirectory, "0_init/migration.sql")

    try {
        if (packageManager.agent === "yarn") console.log("Yarn 1 不提供 dlx；按照 package-manager-detector 的兼容方式，使用 npx 临时执行 Prisma。")
        const { command, args } = getPrismaCommand(packageManager, version, [
            "migrate",
            "diff",
            "--config",
            "prisma.config.ts",
            "--from-empty",
            "--to-schema",
            "prisma/schema.prisma",
            "--script",
            "--output",
            sqlPath,
        ])
        await run(command, args, projectDir, {
            env: {
                NODE_ENV: "development",
                // Prisma 在 Windows 上不能可靠地从 Yarn PnP 压缩包加载；只调整 dlx 临时环境。
                ...(packageManager.agent === "yarn@berry" ? { YARN_NODE_LINKER: "node-modules" } : {}),
            },
            progress: `正在通过 ${command} 准备 Prisma ${version} 并生成初始迁移；首次运行需要下载 Prisma 及引擎`,
        })
        const sql = await fs.readFile(sqlPath, "utf8").catch(error => {
            if (error.code === "ENOENT") throw new Error("Prisma 未生成初始迁移 SQL。")
            throw error
        })

        if (
            !sql
                .replace(/\/\*[\s\S]*?\*\//g, "")
                .replace(/--[^\r\n]*/g, "")
                .trim()
        )
            throw new Error("Prisma 生成的初始迁移 SQL 为空。")

        await fs.writeFile(path.join(migrationDirectory, "migration_lock.toml"), 'provider = "sqlite"\n', "utf8")
    } catch (error) {
        // 只清理由本次调用创建的迁移，避免失败文件被后续手工提交。
        await removeProjectDirectory(projectDir, NextJsPrismaMigrationDirectory)
        throw error
    }
}

export async function configureNextJsLicense(projectDir: string, enabled: boolean, run: CommandRunner = runCommand): Promise<boolean> {
    const licenseDirectory = path.join(projectDir, "license")
    const exists = await pathExists(licenseDirectory)

    if (!enabled) {
        if (exists) await removeProjectDirectory(projectDir, "license")
        return exists
    }

    await fs.access(path.join(projectDir, "scripts/packageDeployment.mjs"))
    await fs.access(path.join(licenseDirectory, "agent/manifest.json"))
    await assertProjectDirectory(projectDir, "license")

    for (const entry of await fs.readdir(licenseDirectory, { withFileTypes: true })) {
        if (entry.name !== "agent") await removeProjectDirectory(projectDir, path.join("license", entry.name))
    }

    console.log("\n初始化当前项目的本地离线授权，请在模板向导中生成或导入产品策略。")
    await run(process.execPath, [path.join(projectDir, "scripts/packageDeployment.mjs"), "license"], projectDir)
    await validateNextJsLicense(projectDir)
    return true
}

export async function validateNextJsLicense(projectDir: string) {
    const packageJson = JSON.parse(await fs.readFile(path.join(projectDir, "package.json"), "utf8"))
    // 这些模块属于运行时刚克隆的模板，不能让打包器静态解析或内联。
    const { getProductIdentity } = await import(/* webpackIgnore: true */ pathToFileURL(path.join(projectDir, "scripts/productIdentity.mjs")).href)
    const { readLicenseMaterials } = await import(/* webpackIgnore: true */ pathToFileURL(path.join(projectDir, "scripts/deploymentMaterials.mjs")).href)
    const { readAgentArtifact } = await import(/* webpackIgnore: true */ pathToFileURL(path.join(projectDir, "scripts/licenseAgentArtifact.mjs")).href)
    const identity = getProductIdentity(packageJson)
    const materials = await readLicenseMaterials({ projectRoot: projectDir, ...identity })
    const agent = await readAgentArtifact(path.join(projectDir, "license/agent"), materials.trustPublicKey)
    const manifest = JSON.parse(await fs.readFile(path.join(projectDir, "license/manifest.json"), "utf8"))
    if (
        manifest.formatVersion !== 2 ||
        manifest.kind !== "license" ||
        manifest.productId !== identity.productId ||
        manifest.productMajorVersion !== identity.productMajorVersion ||
        manifest.licenseMode !== "offline-required" ||
        manifest.includesAgent !== true ||
        manifest.target !== agent.target ||
        ["version", "target", "protocolVersion", "trustPublicKeySha256"].some(key => manifest.agent?.[key] !== agent[key])
    )
        throw new Error("授权部署清单与当前项目或 Agent 不匹配，授权初始化未完成。")

    const licenseDirectory = await fs.realpath(path.join(projectDir, "license"))
    const checksums = await fs.readFile(path.join(licenseDirectory, "SHA256SUMS"), "utf8")
    const verified = new Set<string>()

    for (const line of checksums.trim().split(/\r?\n/)) {
        const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line)
        if (!match) throw new Error("授权文件校验清单格式无效。")
        const [, expected, name] = match
        const filePath = await fs.realpath(path.resolve(licenseDirectory, name))
        assertChildPath(licenseDirectory, filePath)

        const actual = createHash("sha256")
            .update(await fs.readFile(filePath))
            .digest("hex")

        if (actual !== expected) throw new Error(`授权文件校验失败: ${name}`)
        verified.add(name)
    }

    for (const name of ["policy.jws", "trust.pub", "manifest.json", "install.sh", "uninstall.sh", "agent/manifest.json"]) {
        if (!verified.has(name)) throw new Error(`授权文件校验清单缺少 ${name}，授权初始化未完成。`)
    }
}

function assertChildPath(parent: string, child: string) {
    const relative = path.relative(parent, child)
    if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`))
        throw new Error(`拒绝访问项目目录之外的路径: ${child}`)
}

async function assertProjectDirectory(projectDir: string, relativePath: string) {
    const root = await fs.realpath(projectDir)
    const target = path.resolve(root, relativePath)
    assertChildPath(root, target)
    const parent = await fs.realpath(path.dirname(target))
    if (parent !== root) assertChildPath(root, parent)
    const entry = await fs.lstat(target)
    if (entry.isSymbolicLink()) throw new Error(`模板路径不能是符号链接: ${relativePath}`)
    return target
}

async function removeProjectDirectory(projectDir: string, relativePath: string) {
    const target = await assertProjectDirectory(projectDir, relativePath)
    await fs.rm(target, { recursive: true, force: true })
}

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.lstat(targetPath)
        return true
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
        throw error
    }
}
