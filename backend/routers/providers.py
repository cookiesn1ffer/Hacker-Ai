from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import httpx

from services import providers

router = APIRouter(prefix="/api/providers", tags=["providers"])


class ProviderIn(BaseModel):
    name: str
    base_url: str
    model: str
    api_key: str | None = None
    context_tokens: int | None = None


@router.get("")
def list_providers():
    return providers.get_all(mask_keys=True)


@router.put("")
def save_provider(body: ProviderIn):
    providers.upsert(body.name, body.base_url, body.model, body.api_key, body.context_tokens)
    return {"ok": True}


@router.post("/{name}/activate")
def activate(name: str):
    try:
        providers.set_active(name)
    except KeyError:
        raise HTTPException(404, "Unknown provider")
    return {"ok": True}


@router.delete("/{name}")
def remove(name: str):
    providers.delete(name)
    return {"ok": True}


@router.get("/{name}/models")
async def list_models(name: str):
    """Ask the provider which models it has (works for Ollama/LM Studio)."""
    data = providers.get_all(mask_keys=False)
    p = data["providers"].get(name)
    if not p or not p["base_url"]:
        raise HTTPException(400, "Provider has no base URL")
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(
                f"{p['base_url'].rstrip('/')}/models",
                headers={"Authorization": f"Bearer {p['api_key']}"},
            )
            r.raise_for_status()
        return {"models": [m["id"] for m in r.json().get("data", [])]}
    except Exception as e:
        raise HTTPException(502, f"Could not list models: {e}")
