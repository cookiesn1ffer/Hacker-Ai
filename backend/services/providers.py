"""
LLM provider registry, persisted to data/providers.json so you can add /
edit / switch backends from the UI without touching code or restarting.

Every provider is just {name, base_url, api_key, model}. All of them are
expected to speak the OpenAI-compatible /chat/completions API.
"""
import json
import os
import threading

from config import settings

PATH = os.path.join("data", "providers.json")
_lock = threading.Lock()

DEFAULTS = {
    "active": "ollama",
    "providers": {
        "ollama": {
            "base_url": "http://localhost:11434/v1",
            "api_key": "ollama",
            "model": settings.llm_model,
        },
        "lmstudio": {
            "base_url": "http://localhost:1234/v1",
            "api_key": "lm-studio",
            "model": "local-model",
        },
        # OpenCode Zen free tier. Paste your Zen API key in the Providers panel.
        "opencode-deepseek": {
            "base_url": "https://opencode.ai/zen/v1",
            "api_key": "",
            "model": "deepseek-v4.1-flash",
        },
    },
}


def _load() -> dict:
    if not os.path.exists(PATH):
        _save(DEFAULTS)
        return json.loads(json.dumps(DEFAULTS))
    with open(PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _save(data: dict) -> None:
    os.makedirs("data", exist_ok=True)
    with open(PATH, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)


def get_all(mask_keys: bool = True) -> dict:
    with _lock:
        data = _load()
    if mask_keys:
        for p in data["providers"].values():
            p["api_key"] = "***" if p.get("api_key") else ""
    return data


def get_active() -> dict:
    with _lock:
        data = _load()
    return {"name": data["active"], **data["providers"][data["active"]]}


def upsert(name: str, base_url: str, model: str, api_key: str | None) -> None:
    with _lock:
        data = _load()
        existing = data["providers"].get(name, {})
        data["providers"][name] = {
            "base_url": base_url.rstrip("/"),
            "model": model,
            # None / "***" means "keep the stored key"
            "api_key": existing.get("api_key", "") if api_key in (None, "***") else api_key,
        }
        _save(data)


def set_active(name: str) -> None:
    with _lock:
        data = _load()
        if name not in data["providers"]:
            raise KeyError(name)
        data["active"] = name
        _save(data)


def delete(name: str) -> None:
    with _lock:
        data = _load()
        data["providers"].pop(name, None)
        if data["active"] == name:
            data["active"] = next(iter(data["providers"]), "")
        _save(data)
