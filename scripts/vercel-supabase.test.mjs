import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { runCommand } from "../commands.ts"
import { main, parseCliOptions } from "../index.ts"

const cloneUrl = "https://github.com/1adybug/geshu-vercel-supabase-template.git"

const preservedFiles = {
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\nimporters:\n  .: {}\n",
    "supabase/config.toml": 'project_id = "geshu-vercel-supabase-template"\r\n',
    "supabase/migrations/20260929000000_initial.sql": "-- initial schema\nCREATE TABLE public.example (id uuid PRIMARY KEY);\n",
    "supabase/migrations/20260929000001_rls.sql": "ALTER TABLE public.example ENABLE ROW LEVEL SECURITY;\n",
    ".gitignore": "node_modules\n.env.local\nsupabase/.temp\n",
}

async function workspace(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "create-geshu-supabase "))

    t.after(async () => {
        assert.equal(path.dirname(directory), await fs.realpath(os.tmpdir()))
        assert(path.basename(directory).startsWith("create-geshu-supabase "))
        await fs.rm(directory, { recursive: true, force: true })
    })

    return directory
}

async function createTemplate(directory) {
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "template", private: true, packageManager: "pnpm@10.17.1" }))

    for (const [name, content] of Object.entries(preservedFiles)) {
        await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true })
        await fs.writeFile(path.join(directory, name), content)
    }
}

async function runMain(t, directory, args, run) {
    const previousCwd = process.cwd()
    const previousExitCode = process.exitCode

    const messages = []

    t.mock.method(console, "log", (...values) => messages.push(values.join(" ")))
    t.mock.method(console, "error", (...values) => messages.push(values.join(" ")))
    process.chdir(directory)
    process.exitCode = undefined

    try {
        await main(args, run)
        return { exitCode: process.exitCode, messages }
    } finally {
        process.chdir(previousCwd)
        process.exitCode = previousExitCode
    }
}

test("cloud template aliases and deployment arguments are explicit and mutually exclusive", () => {
    for (const alias of ["vercel-supabase", "nextjs-vercel-supabase", "next-vercel-supabase", "supabase", "12"])
        assert.equal(parseCliOptions(["--type", alias]).projectType, "vercel-supabase")
    assert.equal(parseCliOptions(["--type", "5"]).projectType, "nextjs-shadcn")
    assert.equal(parseCliOptions(["--type", "11"]).projectType, "wdp")
    assert.equal(parseCliOptions(["--deployment", "vercel-supabase"]).deployment, "vercel-supabase")
    assert.equal(parseCliOptions(["--deployment", "default"]).deployment, "default")
    assert.throws(() => parseCliOptions(["--deployment"]), /缺少值/)
    assert.throws(() => parseCliOptions(["--deployment", "other"]), /无效/)
    assert.throws(() => parseCliOptions(["--type", "supabase", "--deployment", "vercel-supabase"]), /不能.*同时使用/)
})

for (const args of [
    ["--type", "vercel-supabase"],
    ["--type", "supabase", "--no-local-license"],
    ["--framework", "nextjs", "--ui", "shadcn", "--tailwind", "4", "--deployment", "vercel-supabase"],
]) {
    test(`cloud scaffold preserves migration history and lockfile: ${args.join(" ")}`, async t => {
        const directory = await workspace(t)
        const projectName = "~cloud-example"
        const project = path.join(directory, projectName)

        const calls = []

        const result = await runMain(t, directory, [...args, "--name", projectName], async (command, commandArgs) => {
            calls.push({ command, args: commandArgs })
            assert.equal(command, "git", "cloud scaffolding must not install packages or invoke database/license tools")

            if (commandArgs[0] === "clone") {
                assert.equal(commandArgs[1], cloneUrl)
                await createTemplate(project)
            }
        })
        assert.equal(result.exitCode, undefined, result.messages.join("\n"))
        for (const [name, content] of Object.entries(preservedFiles)) assert.deepEqual(await fs.readFile(path.join(project, name)), Buffer.from(content))
        assert.equal(JSON.parse(await fs.readFile(path.join(project, "package.json"), "utf8")).name, projectName)
        assert.deepEqual(calls.find(call => call.args[0] === "add").args, ["add", "-A", "--", "package.json"])
        assert(calls.some(call => call.args[0] === "commit"))
        for (const name of ["prisma", "license", "node_modules", "data", "package-lock.json", "yarn.lock", "bun.lock"])
            assert.equal(await fs.stat(path.join(project, name)).catch(() => null), null)
        assert(result.messages.some(message => message.includes("Supabase 配置、SQL 迁移和 pnpm 锁文件已保留")))
        assert(!result.messages.some(message => message.includes("db:dev") || message.includes("本地授权:")))
    })
}

for (const args of [
    ["--type", "supabase", "--local-license"],
    ["--framework", "nextjs", "--ui", "antd", "--tailwind", "3", "--deployment", "vercel-supabase"],
    ["--framework", "nextjs", "--ui", "shadcn", "--tailwind", "3", "--deployment", "vercel-supabase"],
    ["--framework", "electron", "--ui", "shadcn", "--deployment", "vercel-supabase"],
]) {
    test(`unsupported cloud capability fails before cloning: ${args.join(" ")}`, async t => {
        const directory = await workspace(t)
        const result = await runMain(t, directory, [...args, "--name", "example"], async () => assert.fail("must not clone"))
        assert.equal(result.exitCode, 1)
        assert(result.messages.some(message => message.includes("不支持 --local-license") || message.includes("没有唯一匹配")))
        assert.deepEqual(await fs.readdir(directory), [])
    })
}

test("existing noninteractive framework selection keeps the Prisma template", async t => {
    const directory = await workspace(t)
    const project = path.join(directory, "legacy-example")

    const calls = []

    const result = await runMain(t, directory, ["--framework", "nextjs", "--ui", "shadcn", "--tailwind", "4", "--name", "legacy-example"], async (
        command,
        args,
    ) => {
        calls.push({ command, args })

        if (args[0] === "clone") {
            assert.equal(args[1], "https://github.com/1adybug/geshu-next-shadcn-template.git")
            await fs.mkdir(path.join(project, "prisma"), { recursive: true })
            await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ name: "template", devDependencies: { prisma: "^7.10.0" } }))
            await fs.writeFile(path.join(project, "prisma/schema.prisma"), 'datasource db { provider = "sqlite" }')
            await fs.writeFile(path.join(project, "prisma.config.ts"), "export default {}")
        }

        if (args.includes("migrate")) await fs.writeFile(args[args.indexOf("--output") + 1], "CREATE TABLE example (id TEXT);")
    })
    assert.equal(result.exitCode, undefined, result.messages.join("\n"))
    assert(calls.some(call => call.args.includes("migrate")))
    assert(result.messages.some(message => message.includes("db:dev")))
})

test("cloud scaffolding commits a local Git fixture without touching preserved platform files", async t => {
    const directory = await workspace(t)
    const fixture = path.join(directory, "local-template")
    const project = path.join(directory, "cloud-app")

    const env = {
        GIT_AUTHOR_NAME: "create-geshu test",
        GIT_AUTHOR_EMAIL: "create-geshu@example.invalid",
        GIT_COMMITTER_NAME: "create-geshu test",
        GIT_COMMITTER_EMAIL: "create-geshu@example.invalid",
        HUSKY: "0",
    }

    await createTemplate(fixture)
    await runCommand("git", ["init", "-b", "main"], fixture, { env })
    await runCommand("git", ["-c", "core.autocrlf=false", "add", "."], fixture, { env })
    await runCommand("git", ["commit", "--no-verify", "-m", "test: fixture"], fixture, { env })
    const result = await runMain(t, directory, ["--type", "vercel-supabase", "--name", "cloud-app"], async (command, args, cwd) => {
        assert.equal(command, "git")

        if (args[0] === "clone") {
            await runCommand("git", ["-c", "core.autocrlf=false", "clone", fixture, args[2]], cwd, { env })
            await runCommand("git", ["remote", "set-url", "origin", args[1]], project, { env })
        } else await runCommand(command, args, cwd, { env })
    })
    assert.equal(result.exitCode, undefined, result.messages.join("\n"))
    for (const [name, content] of Object.entries(preservedFiles)) assert.deepEqual(await fs.readFile(path.join(project, name)), Buffer.from(content))
    await runCommand("git", ["diff", "--exit-code", "HEAD"], project, { env })
    await runCommand("git", ["diff", "--exit-code", "HEAD~1", "--", ...Object.keys(preservedFiles)], project, { env })
    const gitConfig = await fs.readFile(path.join(project, ".git/config"), "utf8")
    assert(gitConfig.includes('[remote "template"]'))
    assert(gitConfig.includes(cloneUrl))
    assert(gitConfig.includes("pushurl = no_push://template"))
    assert(!gitConfig.includes('[remote "origin"]'))
    const reflog = await fs.readFile(path.join(project, ".git/logs/HEAD"), "utf8")
    assert(reflog.includes("commit: feat: init"))
})

test("cloud initialization failure preserves the directory without an initialization commit", async t => {
    const directory = await workspace(t)
    const project = path.join(directory, "incomplete")

    const calls = []

    const result = await runMain(t, directory, ["--type", "supabase", "--name", "incomplete"], async (_command, args) => {
        calls.push(args)

        if (args[0] === "clone") {
            await createTemplate(project)
            await fs.writeFile(path.join(project, "package.json"), "invalid json")
        }
    })
    assert.equal(result.exitCode, 1)
    assert(!calls.some(args => args[0] === "add" || args[0] === "commit"))
    assert((await fs.stat(project)).isDirectory())
    for (const [name, content] of Object.entries(preservedFiles)) assert.deepEqual(await fs.readFile(path.join(project, name)), Buffer.from(content))
})
