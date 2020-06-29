module.exports = {
    root: true,
    parser: "@typescript-eslint/parser",
    plugins: [
        "@typescript-eslint",
    ],
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:@typescript-eslint/recommended",
    ],
    rules: {
        // Using `object` has caused us any confusion so far.
        "@typescript-eslint/ban-types": "off",

        "@typescript-eslint/explicit-module-boundary-types": ["error", {
            allowArgumentsExplicitlyTypedAsAny: true
        }],

        "@typescript-eslint/explicit-function-return-type": ["error", {
            allowExpressions: true,
            allowTypedFunctionExpressions: true
        }],

        "@typescript-eslint/member-delimiter-style": ["error", {
            multiline: {
                delimiter: "semi",
                requireLast: true
            },
            singleline: {
                delimiter: "comma",
                requireLast: false
            }
        }],

        // That's just stupid.
        "@typescript-eslint/no-empty-function": "off",

        "@typescript-eslint/no-explicit-any": "off",

        "@typescript-eslint/no-inferrable-types": ["error", {
            ignoreParameters: true
        }],

        // Namespaces that overlap interfaces are useful.
        "@typescript-eslint/no-namespace": "off",

        "@typescript-eslint/no-use-before-define": ["error", {
            functions: false
        }],

        // It's occasionally useful to inline a require; especially json.
        "@typescript-eslint/no-var-requires": "off",

        "@typescript-eslint/no-unused-vars": ["error", {
            // Often useful to document functions.
            args: "none"
        }],

        // Needed to allow functions exported from namespaces.
        "no-inner-declarations": "off",

        "no-constant-condition": ["error", {
            checkLoops: false
        }],

        // Not everybody understands the regex spec in that level of detail to recognize
        // unnecessary escapes.  Sometimes the extra escape adds clarity.
        "no-useless-escape": "off"
    }
};
