import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // polish-c (council convergence 3, projects M3): tighten jsx-a11y beyond the
  // aria-* rules core-web-vitals already ships. These are all provided by the
  // eslint-plugin-jsx-a11y bundled with eslint-config-next (NO new dependency) —
  // the plugin is already registered by nextVitals above. Kept at "warn" so they
  // surface icon-only-button / label gaps without turning the CI `next build` red
  // (which fails only on error-level lint). Catches the F3 class (aria-label on
  // icon-only controls) pre-merge instead of via post-hoc audit.
  {
    rules: {
      "jsx-a11y/control-has-associated-label": "warn",
      "jsx-a11y/aria-role": "warn",
      "jsx-a11y/no-redundant-roles": "warn",
      "jsx-a11y/label-has-associated-control": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
