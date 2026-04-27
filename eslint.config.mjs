import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
    {
        ignores: ['dist/**', 'dist-cjs/**', 'node_modules/**']
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        languageOptions: {
            globals: {
                ...globals.node
            }
        }
    },
    {
        files: ['test/**/*.ts'],
        languageOptions: {
            globals: {
                ...globals.mocha,
                ...globals.node
            }
        }
    },
    {
        files: ['**/*.{js,mjs,cjs,ts}'],
        rules: {
            quotes: ['error', 'single', { avoidEscape: true }]
        }
    }
];
