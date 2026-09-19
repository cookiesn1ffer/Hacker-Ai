"""
OpenAI-compatible chat client. Reads the *active* provider from
services.providers on every call, so switching in the UI takes effect
immediately (Ollama, LM Studio, OpenCode/DeepSeek, anything compatible).
"""
import httpx

from config import settings
from services import providers


class LLMClient:
    async def chat(self, messages: list[dict]) -> str:
        p = providers.get_active()
        if not p.get("base_url"):
            raise RuntimeError(
                f"Provider '{p['name']}' has no base URL yet. Set it in the Providers panel."
            )

        url = f"{p['base_url'].rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {p.get('api_key', '')}", "Content-Type": "application/json"}
        payload = {"model": p["model"], "messages": messages, "temperature": settings.llm_temperature}

        async with httpx.AsyncClient(timeout=180) as client:
            try:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
            except httpx.ConnectError as e:
                raise RuntimeError(
                    f"Could not reach '{p['name']}' at {p['base_url']}. "
                    f"Is the server running (Ollama / LM Studio local server)? ({e})"
                )
            except httpx.HTTPStatusError as e:
                raise RuntimeError(f"'{p['name']}' returned {e.response.status_code}: {e.response.text[:500]}")

        return resp.json()["choices"][0]["message"]["content"]


llm_client = LLMClient()
