"""
Works out how much context the active model really has, per provider:

- LM Studio: asks its REST API which model is loaded and with what context
  length (GET /api/v0/models -> loaded_context_length). If the model is not
  loaded yet, LM Studio will load it with its own default when the first
  request arrives (often 4096), so we assume that, not something optimistic.
- Ollama: the OpenAI-compatible endpoint cannot set context size and Ollama's
  default window is small, so the app talks to Ollama's native /api/chat and
  sends num_ctx itself (the provider's context_tokens, default 8192, capped at
  the model's maximum when Ollama reports it).
- Anything else (OpenCode/DeepSeek etc.): use the provider's context_tokens
  or the config default.

Every lookup is best-effort and cached briefly; any failure falls back to a
safe number and the UI says where the number came from.
"""
import time

import httpx

from config import settings

_cache: dict[tuple, tuple[float, dict]] = {}
TTL = 20.0
LMSTUDIO_UNLOADED_DEFAULT = 4096


def kind_of(p: dict) -> str:
    name, url = p.get("name", "").lower(), p.get("base_url", "").lower()
    if "ollama" in name or ":11434" in url:
        return "ollama"
    if "lmstudio" in name.replace(" ", "").replace("-", "").replace("_", "") or ":1234" in url:
        return "lmstudio"
    return "other"


def root_of(p: dict) -> str:
    base = p.get("base_url", "").rstrip("/")
    return base[:-3] if base.endswith("/v1") else base


async def resolve(p: dict) -> dict:
    """-> {tokens, kind, source, note}"""
    key = (p.get("name"), p.get("base_url"), p.get("model"), p.get("context_tokens"))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]

    kind = kind_of(p)
    configured = int(p.get("context_tokens") or settings.llm_context_tokens)
    info = {"tokens": configured, "kind": kind, "source": "configured", "note": ""}

    try:
        async with httpx.AsyncClient(timeout=4) as c:
            if kind == "lmstudio":
                r = await c.get(f"{root_of(p)}/api/v0/models")
                r.raise_for_status()
                models = r.json().get("data", [])
                mine = next((m for m in models if m.get("id") == p.get("model")), None)
                if mine and mine.get("state") == "loaded" and mine.get("loaded_context_length"):
                    info.update(tokens=int(mine["loaded_context_length"]), source="LM Studio (loaded)")
                elif mine:
                    info.update(
                        tokens=min(configured, LMSTUDIO_UNLOADED_DEFAULT),
                        source="LM Studio (not loaded yet)",
                        note="Model isn't loaded; LM Studio will load it with its default context. "
                        "Load it yourself with a bigger Context Length for more room.",
                    )
            elif kind == "ollama":
                info.update(source="Ollama (num_ctx set by app)")
                try:
                    r = await c.post(f"{root_of(p)}/api/show", json={"model": p.get("model")})
                    r.raise_for_status()
                    for k, v in (r.json().get("model_info") or {}).items():
                        if k.endswith(".context_length") and isinstance(v, int):
                            if v < configured:
                                info.update(tokens=v, note=f"Capped at the model's maximum ({v}).")
                            break
                except Exception:
                    pass
    except Exception as e:
        info["note"] = f"Couldn't read the context size from {kind} ({type(e).__name__}); using {configured}."

    _cache[key] = (time.time(), info)
    return info
