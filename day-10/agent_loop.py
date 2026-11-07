import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

import anthropic

MODEL = "claude-haiku-5-5";
PRICE_INPUT_TOKEN = 0.1 / 1_000_000;
PRICE_OUTPUT_TOKEN = 0.5 / 1_000_000;
MAX_STEPS = int(os.environ.get("MAX_STEPS", 8));

SYSTEM = """You are a helpful assistant with tools for arithmetic, the current time and exchange rates.
Use a tool for every calculation, time lookup and currency conversion.
If one tool call needs the result of another, wait for that result before making the call. Never guess a value that a tool call will provide."""

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"));  # reads ANTHROPIC_API_KEY from the environment

# ---------- tools ----------

def fmt(x: float) -> str:
    """Print 693375.0 as 693375, the way JavaScript's String() does."""
    return str(int(x)) if float(x).is_integer() else str(x)

def calculator (operation: str, a: float, b: float) -> str:
    """Perform a calculation and return the result as a string."""
    if operation == "divide" and b == 0:
        raise ValueError("Cannot divide by zero")

    operations = { "add" : a + b, "subtract" : a - b,  "multiply" : a * b}

    if operation == "divide":
        return fmt(a / b)

    if operation not in operations:
        raise ValueError(f"Unknown operation: {operation}")

    return fmt(operations.get(operation))

def get_current_time(timezone: str) -> str:
    """Return the current time in the given timezone."""
    try:
        time_zone_Info = ZoneInfo(timezone)  # raises if the time zone name is not valid
    except Exception as error:
        raise ValueError(f"Invalid timezone: {timezone}") from error

    now = datetime.now(time_zone_Info)
    return f"{now.strftime('%A, %d %B %Y at %H:%M:%S %Z')} ({timezone})"


# Made-up rates, so the model cannot know them from training. Not real market data.
RATES_PER_USD = {"USD": 1, "PKR": 277.35, "EUR": 0.9137, "GBP": 0.7712, "JPY": 151.42}

def get_exchange_rate(**kwargs: str) -> str:
    """Return the exchange rate from one currency to another."""
    source, target = kwargs.get("from").upper(), kwargs.get("to").upper()  # "from" is a Python keyword
    supported = ", ".join(RATES_PER_USD)

    if from_currency not in RATES_PER_USD:
        raise ValueError(f"Unknown currency: {from_currency}. Supported currencies: {supported}")

    if to_currency not in RATES_PER_USD:
        raise ValueError(f"Unknown currency: {to_currency}. Supported currencies: {supported}")

    return fmt(RATES_PER_USD[target] / RATES_PER_USD[source])



TOOLS = {
    "calculator": calculator,
    "get_current_time": get_current_time,
    "get_exchange_rate": get_exchange_rate,
}

TOOL_DEFINITIONS = [
    {
        "name": "calculator",
        "description": "Performs exact arithmetic on two numbers. Use this for any calculation instead of working it out yourself.",
        "input_schema": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["add", "subtract", "multiply", "divide"]},
                "a": {"type": "number", "description": "the first number"},
                "b": {"type": "number", "description": "the second number"},
            },
            "required": ["operation", "a", "b"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_current_time",
        "description": "Returns the current date and time in an IANA time zone such as Asia/Karachi or America/New_York. Use this whenever the user asks about the current time or date. You cannot know it otherwise.",
        "input_schema": {
            "type": "object",
            "properties": {"timezone": {"type": "string", "description": "IANA time zone name, e.g. Asia/Tokyo"}},
            "required": ["timezone"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_exchange_rate",
        "description": "Returns the exchange rate for converting one unit of one currency into another, e.g. from USD to PKR. Supported currency codes: USD, PKR, EUR, GBP, JPY. Use this for any currency conversion; you cannot know the current rate otherwise.",
        "input_schema": {
            "type": "object",
            "properties": {
                "from": {"type": "string", "description": "3-letter currency code to convert from, e.g. USD"},
                "to": {"type": "string", "description": "3-letter currency code to convert to, e.g. PKR"},
            },
            "required": ["from", "to"],
            "additionalProperties": False,
        },
    },
]

def execute_tool(name: str, tool_input: dict) -> tuple:
    """Returns (content, is_error). A failing tool becomes an error result, not a crash."""
    tool = TOOLS.get(name)
    if tool is None:
        return f"Unknown tool: {name}", True
    try:
        return tool(**tool_input), False
    except TypeError as error:  # missing or unexpected arguments
        return f"Invalid input: {error}", True
    except Exception as error:
        return str(error), True

# ---------- the agent loop ----------

@dataclass
class AgentResult:
    status: str  # "done" | "stopped" | "step_limit"
    answer: str
    steps: int
    tool_calls: int
    input_tokens: int
    output_tokens: int

def short(s: str, n: int = 120) -> str:
    return s if len(s) <= n else s[:n] + "..." # slice to avoid printing too much in the logs

def run_agent(question: str, max_steps: int = MAX_STEPS) -> AgentResult:
    messages = [{"role": "user", "content": question}]
    input_tokens = output_tokens = tool_calls = 0

    def finish(status: str, answer: str, steps: int) -> AgentResult:
        return AgentResult(status, answer, steps, tool_calls, input_tokens, output_tokens)
        
    for step in range(1, max_steps + 1):
        response = client.messages.create(
                model=MODEL,
                max_tokens=2000,
                system=SYSTEM,
                tools=TOOL_DEFINITIONS,
                messages=messages,
        )
        
        input_tokens += response.usage.input_tokens
        output_tokens += response.usage.output_tokens
        print(f"\nSTEP {step} | stop_reason: {response.stop_reason} | {response.usage.input_tokens} in / {response.usage.output_tokens} out")
        
        if response.stop_reason != "tool_use":
            text = "".join(block.text for block in response.content if block.type == "text")
            
            if response.stop_reason == "end_turn":
                return finish("done", text, step)
            
            return finish("stopped", f"Stopped early ({response.stop_reason}). {text}", step)

        tool_uses = [block for block in response.content if block.type == "tool_use"]
        
        if not tool_uses:
            return finish("stopped", "No tool_use block found in response.", step)
        
        if len(tool_uses) > 1:
            print(f"  ({len(tool_uses)} tool calls in this step)")

        # Keep the whole assistant content (thinking blocks included).
        messages.append({"role": "assistant", "content": response.content})
        
        results = []
        for block in tool_uses:
            content, is_error = execute_tool(block.name, block.input)
            
            tool_calls += 1
            
            print(f"  {block.name} {json.dumps(block.input, separators=(',', ':'))} -> {'ERROR: ' if is_error else ''}{short(content)}")
            
            result = {"type": "tool_result", "tool_use_id": block.id, "content": content}
            
            if is_error:
                result["is_error"] = True
                
            results.append(result)
                
        messages.append({"role": "user", "content": results})
        
    return finish("step_limit", f"I could not finish within {max_steps} steps.", max_steps)

if __name__ == "__main__":
    question = sys.argv[1] if len(sys.argv) > 1 else "Convert 2500 USD to PKR, then add 18% tax on that amount. What is the total?"
    print(f"QUESTION: {question} (max steps: {MAX_STEPS})")
    result = run_agent(question)
    cost = result.input_tokens * PRICE_INPUT_TOKEN + result.output_tokens * PRICE_OUTPUT_TOKEN
    print(f"\nANSWER ({result.status}): {result.answer}")
    print(f"\nSteps: {result.steps} | tool calls: {result.tool_calls} | {result.input_tokens} in / {result.output_tokens} out | ${cost:.6f}")





