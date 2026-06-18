import { Router } from "express";
import { exec } from "child_process";

const router = Router();

// 工具定义
const TOOLS = [
  {
    type: "function",
    function: {
      name: "run_command",
      description: "在用户的终端中执行 shell 命令并返回输出。用于查看系统信息、检查配置、运行诊断命令等。",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "要执行的 shell 命令",
          },
        },
        required: ["command"],
      },
    },
  },
];

// 清理 tool 相关消息，只保留 system/user/assistant 标准角色
function cleanToolMessages(messages) {
  const VALID_ROLES = new Set(["system", "user", "assistant"]);
  const result = [];
  for (const m of messages) {
    // 只保留标准角色
    if (!VALID_ROLES.has(m.role)) continue;

    if (m.role === "assistant" && m.tool_calls) {
      // assistant 的 tool_calls → 转为纯文本
      const callDesc = m.tool_calls
        .map((tc) => {
          try {
            const args = typeof tc.function.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;
            return `[执行命令] ${args.command || tc.function.arguments}`;
          } catch {
            return `[调用工具] ${tc.function.name}`;
          }
        })
        .join("\n");
      result.push({
        role: "assistant",
        content: (m.content || "") + "\n" + callDesc,
      });
    } else {
      // 只保留 role 和 content，移除 tool_calls 等额外字段
      result.push({ role: m.role, content: m.content || "" });
    }
  }
  return result;
}

// System prompt
const SYSTEM_PROMPT = {
  role: "system",
  content:
    "你是一个终端助手，可以帮助用户执行 shell 命令并分析输出。" +
    "当用户需要查看系统信息、检查配置、运行诊断命令时，使用 run_command 工具执行命令。" +
    "执行命令后请分析输出并用中文给出清晰的总结。" +
    "可以组合多个命令一次性执行以提高效率。",
};

// POST /api/ai/chat — 代理 AI API 请求
router.post("/chat", async (req, res) => {
  const { endpoint, apiKey, model, messages } = req.body;

  if (!endpoint || !apiKey || !model || !messages) {
    return res.status(400).json({ error: "缺少必要参数: endpoint, apiKey, model, messages" });
  }

  try {
    // 规范化 endpoint
    let url = endpoint.replace(/\/+$/, "");
    if (!url.endsWith("/chat/completions")) {
      url += "/chat/completions";
    }

    // 注入 system prompt 和 tools
    const fullMessages = [SYSTEM_PROMPT, ...messages];

    // 第一次尝试：带 tools
    let apiRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: fullMessages,
        tools: TOOLS,
        stream: false,
      }),
    });

    // 如果 API 不支持 tool 角色，清理后重试
    if (!apiRes.ok) {
      const errText = await apiRes.text();
      const isToolError = errText.includes("role") || errText.includes("tool") || errText.includes("Tool") || apiRes.status === 400;

      if (isToolError) {
        // 清理消息：移除 tool 角色，转换 assistant 的 tool_calls
        const cleanMessages = cleanToolMessages(fullMessages);

        apiRes = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: cleanMessages,
            stream: false,
          }),
        });

        if (!apiRes.ok) {
          const err2 = await apiRes.text();
          return res.status(apiRes.status).json({ error: `API 错误 (${apiRes.status}): ${err2}` });
        }

        const data = await apiRes.json();
        // 标记不支持 tools，客户端不再发起 tool call
        data._noTools = true;
        return res.json(data);
      }

      return res.status(apiRes.status).json({ error: `API 错误 (${apiRes.status}): ${errText}` });
    }

    const data = await apiRes.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai/exec — 执行 shell 命令
router.post("/exec", (req, res) => {
  const { command, cwd } = req.body;

  if (!command) {
    return res.status(400).json({ error: "缺少 command 参数" });
  }

  const timeout = 30000; // 30 秒超时
  const options = {
    timeout,
    maxBuffer: 1024 * 1024 * 5, // 5MB
    cwd: cwd || process.env.HOME,
    shell: true,
  };

  exec(command, options, (error, stdout, stderr) => {
    res.json({
      stdout: stdout || "",
      stderr: stderr || "",
      exitCode: error ? error.code || 1 : 0,
      killed: error?.killed || false,
    });
  });
});

export default router;
