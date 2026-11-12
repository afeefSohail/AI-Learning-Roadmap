# Day 12: output of `probe.mjs`, in readable form

Responses are sorted by request id. They actually arrived in this order: id 1, id 2, id 5, id 3, id 4 (the validation error, id 5, came back before ids 3 and 4, because the SDK rejected it before running my handler).

## Server log (stderr, separate from the protocol)

```
exchange-rate MCP server running on stdio
unsupported currency requested: INR
```

## id 1: server/discover

Ask the server which protocol versions and capabilities it supports.

```json
{
  "result": {
    "supportedVersions": [
      "2026-07-28"
    ],
    "capabilities": {
      "tools": {
        "listChanged": true
      }
    },
    "resultType": "complete",
    "ttlMs": 0,
    "cacheScope": "private",
    "_meta": {
      "io.modelcontextprotocol/serverInfo": {
        "name": "exchange-rate",
        "version": "1.0.0"
      }
    }
  },
  "jsonrpc": "2.0",
  "id": 1
}
```

## id 2: tools/list

List the tools the server offers.

```json
{
  "result": {
    "tools": [
      {
        "name": "get_exchange_rate",
        "title": "Exchange rate",
        "description": "Returns the exchange rate for converting one unit of one currency into another, e.g. from USD to PKR. Supported currency codes: USD, PKR, EUR, GBP, JPY. Use this for any currency conversion; you cannot know the current rate otherwise.",
        "inputSchema": {
          "type": "object",
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "properties": {
            "from": {
              "type": "string",
              "description": "3-letter currency code to convert from, e.g. USD"
            },
            "to": {
              "type": "string",
              "description": "3-letter currency code to convert to, e.g. PKR"
            }
          },
          "required": [
            "from",
            "to"
          ]
        }
      }
    ],
    "resultType": "complete",
    "ttlMs": 0,
    "cacheScope": "private",
    "_meta": {
      "io.modelcontextprotocol/serverInfo": {
        "name": "exchange-rate",
        "version": "1.0.0"
      }
    }
  },
  "jsonrpc": "2.0",
  "id": 2
}
```

## id 3: tools/call: USD to PKR

A normal call. Succeeds.

```json
{
  "result": {
    "content": [
      {
        "type": "text",
        "text": "277.35"
      }
    ],
    "resultType": "complete",
    "_meta": {
      "io.modelcontextprotocol/serverInfo": {
        "name": "exchange-rate",
        "version": "1.0.0"
      }
    }
  },
  "jsonrpc": "2.0",
  "id": 3
}
```

## id 4: tools/call: USD to INR

Valid input, but my handler rejects the currency.

```json
{
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Unknown currency: INR. Supported currencies: USD, PKR, EUR, GBP, JPY"
      }
    ],
    "isError": true,
    "resultType": "complete",
    "_meta": {
      "io.modelcontextprotocol/serverInfo": {
        "name": "exchange-rate",
        "version": "1.0.0"
      }
    }
  },
  "jsonrpc": "2.0",
  "id": 4
}
```

## id 5: tools/call: USD, no `to`

Missing argument. The SDK rejects it before my handler runs.

```json
{
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Input validation error: Invalid arguments for tool get_exchange_rate: to: Invalid input: expected string, received undefined"
      }
    ],
    "isError": true,
    "resultType": "complete",
    "_meta": {
      "io.modelcontextprotocol/serverInfo": {
        "name": "exchange-rate",
        "version": "1.0.0"
      }
    }
  },
  "jsonrpc": "2.0",
  "id": 5
}
```

## What to notice

| id | Outcome | Kind of response |
|---|---|---|
| 1 | Version `2026-07-28`, capability `tools` | normal result |
| 2 | One tool with a JSON Schema (`from` and `to`, both required) | normal result |
| 3 | `277.35` | normal result |
| 4 | `Unknown currency: INR. Supported currencies: ...` | tool result with `isError: true` |
| 5 | `Input validation error: ... to: Invalid input: expected string, received undefined` | tool result with `isError: true` |

- Every response carries `"jsonrpc": "2.0"` and the `id` of its request.
- `ttlMs: 0` and `cacheScope: "private"` on the list responses say the result must not be reused or shared.
- Every response has `resultType: "complete"` and the server's name and version in `_meta`.
