# Action Protocol

The orchestrator exchanges a strict JSON envelope with the reasoning layer.

## Action

```json
{
  "type": "action",
  "request_id": "uuid",
  "tool": "read_file",
  "arguments": {
    "path": "src/main/java/example/Foo.java"
  }
}
```

## Result

```json
{
  "type": "result",
  "request_id": "uuid",
  "ok": true,
  "result": {
    "content": "..."
  }
}
```

Errors use the same envelope with `ok: false` and an `error` object.

## Completion

```json
{
  "type": "done",
  "summary": "Implemented the fix and tests pass."
}
```

## Safety

The orchestrator must reject:

- unknown tool names;
- malformed JSON;
- absolute paths when a relative project path is expected;
- paths escaping the configured project root;
- shell commands outside the configured allowlist;
- write operations when write approval is disabled.

The protocol deliberately avoids free-form execution requests. A natural-language response must not be treated as a command.
