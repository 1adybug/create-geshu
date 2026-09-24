import process from "node:process"

import spawn from "cross-spawn"

export interface RunCommandOptions {
    env?: NodeJS.ProcessEnv
    progress?: string
}

export type CommandRunner = (command: string, args: string[], cwd: string, options?: RunCommandOptions) => Promise<void>

export const runCommand: CommandRunner = async (command, args, cwd, options = {}) => {
    const display = [command, ...args].map(value => (/\s/.test(value) ? JSON.stringify(value) : value)).join(" ")
    console.log(`\n> ${display}`)

    const startedAt = Date.now()
    const progress = options.progress
    if (progress) console.log(progress)
    const timer = progress
        ? setInterval(() => console.log(`${progress}（已等待 ${Math.floor((Date.now() - startedAt) / 1000)} 秒，可按 Ctrl+C 取消）`), 15_000)
        : undefined

    try {
        await new Promise<void>((resolve, reject) => {
            const child = spawn(command, args, {
                cwd,
                env: { ...process.env, ...options.env },
                stdio: "inherit",
                windowsHide: true,
            })

            let interrupted = false
            let stopping: Promise<void> | undefined

            const cancel = () => {
                interrupted = true

                if (process.platform === "win32" && child.pid) {
                    // npm/npx 在 Windows 上还有子进程，必须一起结束后再清理输出文件。
                    stopping = new Promise(done => {
                        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })

                        killer.once("error", () => {
                            child.kill("SIGINT")
                            done()
                        })

                        killer.once("close", () => done())
                    })
                } else child.kill("SIGINT")
            }

            const cleanup = () => {
                process.removeListener("SIGINT", cancel)
                process.removeListener("SIGTERM", cancel)
            }

            process.once("SIGINT", cancel)
            process.once("SIGTERM", cancel)

            child.once("error", error => {
                cleanup()
                reject(new Error(`无法执行命令: ${display}。${error.message}`, { cause: error }))
            })

            child.once("close", (code, signal) => {
                cleanup()

                if (interrupted || signal) void Promise.resolve(stopping).then(() => reject(new Error(`命令已取消: ${display}`)))
                else if (code === 0) resolve()
                else reject(new Error(`命令执行失败（退出码 ${code}）: ${display}`))
            })
        })
    } finally {
        if (timer) clearInterval(timer)
    }
}
