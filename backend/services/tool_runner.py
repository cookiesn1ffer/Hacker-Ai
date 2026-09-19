"""
Whitelisted recon tool runner.

This module only ever shells out to binaries present in settings.allowed_tools,
and only to run them - it does not construct exploit payloads or attack
logic. It's a thin, auditable wrapper: you already have these tools
installed and already have authorization to point them at a target; this
just captures their output into the app so you can tag it into a finding
or feed it to the chat panel for summarization.
"""
import asyncio
import shlex

from config import settings


class ToolNotAllowed(Exception):
    pass


async def run_tool(tool: str, target_value: str, extra_args: str = "") -> tuple[str, int]:
    if tool not in settings.allowed_tools:
        raise ToolNotAllowed(
            f"'{tool}' is not in the allowed_tools whitelist (config.py). "
            f"Allowed: {', '.join(settings.allowed_tools)}"
        )

    # Build argv safely - no shell=True, no string concatenation into a shell.
    argv = [tool]
    if extra_args:
        argv.extend(shlex.split(extra_args))
    argv.append(target_value)

    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        try:
            stdout, _ = await asyncio.wait_for(
                proc.communicate(), timeout=settings.tool_timeout_seconds
            )
        except asyncio.TimeoutError:
            proc.kill()
            return f"[timed out after {settings.tool_timeout_seconds}s]", -1

        return stdout.decode(errors="replace"), proc.returncode
    except FileNotFoundError:
        return (
            f"'{tool}' is not installed or not on PATH. Install it and make "
            f"sure it's reachable from this app's environment.",
            -1,
        )
