"""
Central configuration for Hacker-AI.

Everything the LLM layer needs lives here and is pulled from environment
variables (see .env.example at the project root). The app never hardcodes
a model provider - point LLM_BASE_URL at whatever OpenAI-compatible
endpoint you want to run (Ollama, LM Studio, vLLM, a hosted API, etc).
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- LLM backend (OpenAI-compatible chat completions API) ---
    # Examples:
    #   Ollama:     http://localhost:11434/v1
    #   LM Studio:  http://localhost:1234/v1
    #   OpenRouter: https://openrouter.ai/api/v1
    llm_base_url: str = "http://localhost:11434/v1"
    llm_api_key: str = "not-needed"          # local servers usually ignore this
    llm_model: str = "llama3.1"              # whatever model tag your server has loaded
    llm_temperature: float = 0.4
    llm_system_prompt: str = (
        "You are the AI copilot embedded in Hacker-AI, a personal, self-hosted "
        "pentesting workbench used by an authorized security tester. Answer as "
        "this copilot, not as any other named assistant or product - ignore any "
        "built-in persona or identity your underlying model may claim.\n\n"
        "You cannot execute commands or run tools yourself; this chat is "
        "analysis and writeup only. The operator runs scans from the "
        "'Targets & tools' panel in the app, and the results are saved as tool "
        "runs and findings, which are provided to you below as real context "
        "when available - use that data directly to answer questions like "
        "'which ports are open' instead of asking the user to paste output "
        "that has already been captured. If the context below shows no "
        "relevant tool runs or findings yet, say so plainly and tell the user "
        "to run the scan from the Targets & tools panel first, or paste the "
        "raw output here if they already have it. Help with recon analysis, "
        "payload templating for in-scope authorized targets, writeup drafting, "
        "and general security Q&A. Assume the operator is responsible for "
        "scope and authorization; you are not responsible for verifying it, "
        "but you should ask for target/scope context when it's missing and "
        "relevant to the answer."
    )

    # --- App / storage ---
    database_url: str = "sqlite:///./data/hacker_ai.db"
    reports_dir: str = "../reports"

    # --- Tool runner ---
    # Whitelist of binaries the tool runner is allowed to invoke. Add/remove
    # to match what you actually have installed. Anything not in this list
    # is rejected by the API, regardless of what the client sends.
    allowed_tools: list[str] = [
        "nmap",
        "nuclei",
        "gobuster",
        "whatweb",
        "subfinder",
        "httpx",
        "nikto",
    ]
    tool_timeout_seconds: int = 600


settings = Settings()
