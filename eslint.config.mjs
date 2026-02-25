// @ts-check

import js from "@eslint/js"
import { defineConfig, globalIgnores } from "eslint/config"
import globals from "globals"
import tseslint from "typescript-eslint"

export default defineConfig([
    globalIgnores(["node_modules", "dist", "build", "public"]),
    {
        files: ["**/*.{js,mjs,ts}"],
        extends: [js.configs.recommended, tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: "latest",
            globals: globals.browser,
        },
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-empty-object-type": "off",
            "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
            "no-empty": "off",
            "no-extra-boolean-cast": "off",
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    args: "none",
                    caughtErrors: "none",
                    ignoreRestSiblings: true,
                },
            ],
            "prefer-const": [
                "off",
                {
                    destructuring: "any",
                },
            ],
        },
    },
])
