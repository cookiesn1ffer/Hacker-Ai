"""
Lets the chat panel actually run the whitelisted recon tools when the operator
asks for it ("scan 192.168.1.4", "run it using nmap"), instead of the model
only talking about it.

This is deliberately plain regex intent detection, not LLM function-calling:
small local models are unreliable at tool-call formats, and this way a scan
request always does what it says regardless of which model is loaded. The
existing allowed_tools whitelist in config.py is still the only gate; the
runner itself is unchanged.
"""
import re
from dataclasses import dataclass

IPV4 = r"\b\d{1,3}(?:\.\d{1,3}){3}(?:/\d{1,2})?\b"
HOST = r"\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b"
URL = r"https?://[^\s/]+[^\s]*"

# Imperative verbs only - "check the findings" must NOT trigger a scan.
ACTION_VERBS = r"\b(scan|rescan|run|launch|start|execute|enumerate|probe|fingerprint|fuzz|brute)\b"

# Sensible defaults per tool (nmap = service/version on the default top ports).
DEFAULT_ARGS = {
    "nmap": "-sV -T4",
    "nuclei": "-u",
    "gobuster": "",
    "whatweb": "",
    "subfinder": "-d",
    "httpx": "",
    "nikto": "-h",
}


@dataclass
class ChatAction:
    tool: str
    target: str
    args: str


def _find_target(text: str) -> str | None:
    for pattern in (URL, IPV4, HOST):
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            value = m.group(0).rstrip(".,;)")
            # Skip things like "e.g." / file names that look like hosts.
            if pattern == HOST and value.split(".")[-1].lower() in {"txt", "md", "py", "json", "exe", "bat", "log"}:
                continue
            return value
    return None


def detect_action(
    message: str,
    allowed_tools: list[str],
    recent_user_messages: list[str],
    engagement_targets: list[str],
) -> ChatAction | None:
    text = message.lower()

    if not re.search(ACTION_VERBS, text):
        return None
    # Explanations / how-to questions are not requests to run anything.
    if re.match(r"\s*(how|what|why|when|explain|which|does|is|are)\b", text):
        return None

    named_tool = next(
        (t for t in allowed_tools if re.search(rf"\b{re.escape(t)}\b", text)), None
    )
    wants_scan = bool(re.search(r"\b(scan|rescan|port scan|enumerate|probe)\b", text))
    if not named_tool and not wants_scan:
        return None

    tool = named_tool or "nmap"
    if tool not in allowed_tools:
        return None

    target = _find_target(message)
    if not target:
        # "run it using nmap" -> reuse the most recent target mentioned in chat,
        # else the newest target added to the engagement.
        for prev in reversed(recent_user_messages):
            target = _find_target(prev)
            if target:
                break
        if not target and engagement_targets:
            target = engagement_targets[-1]
    if not target:
        return None

    args = DEFAULT_ARGS.get(tool, "")
    # Flags that take the target as their value (e.g. nuclei -u <target>) are
    # handled by tool_runner appending the target last.
    return ChatAction(tool=tool, target=target, args=args)
