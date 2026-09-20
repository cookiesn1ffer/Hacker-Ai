"""
Chat client. Reads the *active* provider from services.providers on every
call, so switching in the UI takes effect immediately.

LM Studio / OpenCode / anything OpenAI-compatible -> /v1/chat/completions.
Ollama -> its native /api/chat, because the OpenAI-compatible endpoint has no
way to set the context size (num_ctx) and Ollama's default window is small.
"""
import httpx

from config import settings
from services import context_window, providers

CUT_NOTE = (
    "\n\n> **Reply cut off:** the model hit its context/token limit. Raise Context "
    "Length when loading the model (8192+), or turn off its thinking mode."
)


def _ctx_error(name: str, body: str) -> RuntimeError:
    return RuntimeError(
        f"The model's context window is full ({body[:200]}). Raise Context Length "
        f"when loading the model in LM Studio, or set a bigger context on the '{name}' "
        f"provider, or start a new chat."
    )


class LLMClient:
    async def chat(self, messages: list[dict], provider: dict | None = None, num_ctx: int | None = None) -> str:
        p = provider or providers.get_active()
        if not p.get("base_url"):
            raise RuntimeError(
                f"Provider '{p['name']}' has no base URL yet. Set it in the Providers panel."
            )
        headers = {"Authorization": f"Bearer {p.get('api_key', '')}", "Content-Type": "application/json"}
        kind = context_window.kind_of(p)

        if kind == "ollama":
            url = f"{context_window.root_of(p)}/api/chat"
            payload = {
                "model": p["model"],
                "messages": messages,
                "stream": False,
                "options": {"temperature": settings.llm_temperature, **({"num_ctx": num_ctx} if num_ctx else {})},
            }
        else:
            url = f"{p['base_url'].rstrip('/')}/chat/completions"
            payload = {"model": p["model"], "messages": messages, "temperature": settings.llm_temperature}

        async with httpx.AsyncClient(timeout=300) as client:
            try:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
            except httpx.ConnectError as e:
                raise RuntimeError(
                    f"Could not reach '{p['name']}' at {p['base_url']}. "
                    f"Is the server running (Ollama / LM Studio local server)? ({e})"
                )
            except httpx.ReadTimeout:
                raise RuntimeError(
                    f"'{p['name']}' took too long to answer. The model may be loading or too slow "
                    f"for this much context; try again or lower the context size."
                )
            except httpx.HTTPStatusError as e:
                body = e.response.text[:500]
                if any(w in body.lower() for w in ("context", "n_ctx", "too long", "exceed", "tokens")):
                    raise _ctx_error(p["name"], body)
                raise RuntimeError(f"'{p['name']}' returned {e.response.status_code}: {body}")

        data = resp.json()
        if kind == "ollama":
            text = (data.get("message") or {}).get("content", "") or ""
            cut = data.get("done_reason") == "length"
        else:
            choice = data["choices"][0]
            text = choice["message"].get("content") or ""
            cut = choice.get("finish_reason") == "length"
        return text + (CUT_NOTE if cut else "")


llm_client = LLMClient()
