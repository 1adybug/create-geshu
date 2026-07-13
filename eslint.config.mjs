import { defineConfig } from "@1adybug/eslint"

export default defineConfig({
    rules: {
        "n/hashbang": ["error", { additionalExecutables: ["index.ts"] }],
    },
})
