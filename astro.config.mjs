import { defineConfig } from "astro/config";
import node from "@astrojs/node";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "middleware" }),
  trailingSlash: "never",
  i18n: {
    locales: ["fi", "en"],
    defaultLocale: "fi",
    routing: { prefixDefaultLocale: false },
  },
});
