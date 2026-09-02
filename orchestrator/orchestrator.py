from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

DEFAULT_BRIDGE_URL = os.environ.get("CHATGPT_BRIDGE_URL", "http://127.0.0.1:8080")
DEFAULT_PROJECT_ROOT = os.environ.get("PROJECT_ROOT", os.getcwd())

SYSTEM_PROMPT = r"""
You are the reasoning brain for a local coding agent.

The local machine is the executor. You MUST communicate work as exactly ONE JSON object per response.
Do not use Markdown fences. Do not include commentary outside the JSON object.

Allowed response forms:
1) Action:
{"type":"action","request_id":"<uuid-or-any-unique-id>","tool":"<tool-name>","arguments":{...}}
2) Completion:
{"type":"done","summary":"<concise summary>"}

Available tools are supplied in the user prompt. Never invent a tool.
For any write operation, make the smallest safe change and prefer apply_patch over write_file when possible.
Never request absolute filesystem paths.
Do not execute destructive commands. Use project-relative paths.
After an action result, reason from that result and return the next single JSON action or done.
""".strip()


def call_chatgpt(message: str, bridge_url: str, token: str | None) -> str:
    body = json.dumps({"message": message}).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(
        f"{bridge_url.rstrip('/')}/chat",
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with urlopen(request, timeout=300) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise RuntimeError(f"ChatGPT bridge HTTP {exc.code}: {exc.read().decode('utf-8', errors='replace')}") from exc
    except URLError as exc:
        raise RuntimeError(f"Cannot reach ChatGPT bridge at {bridge_url}: {exc.reason}") from exc

    answer = payload.get("response")
    if not isinstance(answer, str):
        raise RuntimeError(f"Unexpected bridge response: {payload!r}")
    return answer.strip()


def extract_envelope(text: str) -> dict[str, Any]:
    """Accept only a complete JSON object, with a strict fallback for accidental fences."""
    candidate = text.strip()
    if candidate.startswith("```") and candidate.endswith("```"):
        candidate = candidate.split("\n", 1)[1].rsplit("\n", 1)[0].strip()
    try:
        value = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise ValueError(f"ChatGPT did not return valid JSON: {text!r}") from exc
    if not isinstance(value, dict) or value.get("type") not in {"action", "done"}:
        raise ValueError(f"Invalid action envelope: {value!r}")
    if value["type"] == "action":
        if not isinstance(value.get("tool"), str) or not isinstance(value.get("arguments", {}), dict):
            raise ValueError(f"Invalid action fields: {value!r}")
    return value


async def run(project_root: str, task: str, bridge_url: str, token: str | None, max_steps: int) -> None:
    server = StdioServerParameters(
        command=sys.executable,
        args=[os.path.join(os.path.dirname(__file__), "..", "mcp-server", "server.py")],
        env={**os.environ, "PROJECT_ROOT": os.path.abspath(project_root)},
    )

    async with stdio_client(server) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools_result = await session.list_tools()
            tool_summaries = []
            for tool in tools_result.tools:
                tool_summaries.append(
                    {
                        "name": tool.name,
                        "description": tool.description,
                        "input_schema": tool.inputSchema,
                    }
                )

            conversation = (
                SYSTEM_PROMPT
                + "\n\nPROJECT_ROOT is configured locally.\n"
                + "Available MCP tools:\n"
                + json.dumps(tool_summaries, indent=2)
                + "\n\nUser task:\n"
                + task
            )

            for step in range(1, max_steps + 1):
                print(f"[step {step}] asking ChatGPT", file=sys.stderr)
                response = call_chatgpt(conversation, bridge_url, token)
                print(response, file=sys.stderr)
                envelope = extract_envelope(response)

                if envelope["type"] == "done":
                    print(json.dumps(envelope, indent=2))
                    return

                tool_name = envelope["tool"]
                arguments = envelope.get("arguments", {})
                try:
                    result = await session.call_tool(tool_name, arguments=arguments)
                    content = []
                    for item in result.content:
                        text = getattr(item, "text", None)
                        if text is not None:
                            content.append(text)
                        else:
                            content.append(str(item))
                    tool_result: dict[str, Any] = {
                        "ok": not result.isError,
                        "result": "\n".join(content),
                    }
                except Exception as exc:
                    tool_result = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

                result_envelope = {
                    "type": "result",
                    "request_id": envelope.get("request_id"),
                    **tool_result,
                }
                conversation = (
                    SYSTEM_PROMPT
                    + "\n\nPROJECT_ROOT is configured locally.\n"
                    + "Available MCP tools:\n"
                    + json.dumps(tool_summaries, indent=2)
                    + "\n\nOriginal task:\n"
                    + task
                    + "\n\nPrevious action:\n"
                    + json.dumps(envelope)
                    + "\n\nTool result:\n"
                    + json.dumps(result_envelope)
                    + "\n\nReturn the next single JSON action or done."
                )

            raise RuntimeError(f"Reached max_steps={max_steps} without completion")


def main() -> None:
    parser = argparse.ArgumentParser(description="ChatGPT-to-local-MCP coding orchestrator")
    parser.add_argument("task", help="Natural-language coding task")
    parser.add_argument("--project-root", default=DEFAULT_PROJECT_ROOT)
    parser.add_argument("--bridge-url", default=DEFAULT_BRIDGE_URL)
    parser.add_argument("--token", default=os.environ.get("CHATGPT_BRIDGE_TOKEN"))
    parser.add_argument("--max-steps", type=int, default=20)
    args = parser.parse_args()

    import asyncio

    asyncio.run(
        run(
            project_root=args.project_root,
            task=args.task,
            bridge_url=args.bridge_url,
            token=args.token,
            max_steps=args.max_steps,
        )
    )


if __name__ == "__main__":
    main()
