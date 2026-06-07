import { type Plugin, type Hooks } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const PLUGIN_NAME = "funnel-architect-plugin-opencode"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = join(__dirname, "..", "scripts")

function mobileCheck(filePath: string): string | null {
  if (!filePath.endsWith(".html") && !filePath.endsWith(".htm")) return null
  if (!existsSync(filePath)) return null

  const content = readFileSync(filePath, "utf8")
  const issues: string[] = []

  // Check for viewport meta tag
  if (!/<meta[^>]*name=["']viewport["'][^>]*>/i.test(content)) {
    issues.push('Missing viewport meta tag: add <meta name="viewport" content="width=device-width, initial-scale=1.0">')
  }

  // Check for fixed widths over 999px
  if (/width:\s*\d{4,}px/i.test(content)) {
    issues.push("Found fixed widths over 999px — these will break on mobile. Use max-width, %, or vw units instead")
  }

  // Check for small font sizes on touch targets
  const buttonMatches = content.match(/<(button|a)\s[^>]*>/gi)
  if (buttonMatches) {
    const hasSmallFont = buttonMatches.some((m) => /font-size:\s*1[01]px/i.test(m))
    if (hasSmallFont) {
      issues.push("Small font sizes on buttons/links — ensure touch targets are at least 44x44px for mobile accessibility")
    }
  }

  // Check for non-responsive images
  if (/<img[^>]*>/i.test(content) && !/max-width:\s*100%/i.test(content) && !/width:\s*100%/i.test(content) && !/srcset/i.test(content)) {
    issues.push("Images may not be responsive — consider adding max-width: 100% or srcset")
  }

  if (issues.length === 0) return null

  const fileName = filePath.split("\\").pop()?.split("/").pop() ?? filePath
  return `⚠️ Mobile issues in ${fileName}:\n${issues.map((i) => `• ${i}`).join("\n")}`
}

function runLighthouseAudit(filePath: string): string | null {
  const scriptPath = join(SCRIPTS_DIR, "lighthouse-audit.js")
  if (!existsSync(scriptPath)) return null

  try {
    return execSync(`node "${scriptPath}"`, {
      input: JSON.stringify({ tool_input: { file_path: filePath } }),
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    }).trim()
  } catch {
    return null
  }
}

const funnelStatusTool = tool({
  description: "Check if the Funnel Architect plugin is loaded and active, and list available skills",
  args: {} as const,
  execute: async () => {
    return {
      title: "Funnel Architect Status",
      output: [
        "🪄 Funnel Architect plugin is alive and building!",
        "",
        "Tools ready: `funnel-status`",
        "Skills ready: 29 skills for building high-converting sales funnels",
        "",
        "Supported funnel types: Opt-In, Webinar, SaaS, VSL, Product Launch, Tripwire, Challenge, Application, Evergreen Webinar, High-Ticket, Membership, E-Commerce, Group",
        "",
        "Deploy targets: Netlify, Vercel, Cloudflare Pages",
        "",
        "Ready to build. Tell me what you're selling and who you're selling to.",
      ].join("\n"),
    }
  },
})

const plugin: Plugin = async (_input, _options) => {
  const hooks: Hooks = {
    tool: {
      "funnel-status": funnelStatusTool,
    },

    "tool.execute.after": async (input, output) => {
      if (input.tool !== "write" && input.tool !== "edit") return
      const filePath: string | undefined = input.args?.filePath
      if (!filePath) return

      // Mobile responsiveness check (inline Node.js)
      const mobileMsg = mobileCheck(filePath)
      if (mobileMsg) {
        output.metadata = { ...output.metadata, mobile_check: mobileMsg }
      }

      // Lighthouse audit (async via existing script)
      const lighthouseMsg = runLighthouseAudit(filePath)
      if (lighthouseMsg) {
        const parsed = tryParseJSON(lighthouseMsg)
        if (parsed?.systemMessage) {
          output.metadata = { ...output.metadata, lighthouse: parsed.systemMessage }
        }
      }
    },

    dispose: async () => {
      const cwd = process.cwd()
      const scriptPath = join(SCRIPTS_DIR, "validate-funnel-structure.js")
      if (!existsSync(scriptPath)) return

      try {
        execSync(`node "${scriptPath}" "${cwd}"`, {
          encoding: "utf8",
          timeout: 30_000,
          windowsHide: true,
        })
      } catch {
        // Funnel validation failures are expected (template cross-refs)
      }
    },
  }

  return hooks
}

function tryParseJSON(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

export default plugin
