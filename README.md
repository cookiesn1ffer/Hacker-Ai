# Hacker-AI

Self-hosted pentest / CTF workbench with a web UI. Windows-friendly, no build step.

## Run (Windows)
1. Install Python 3.11+.
2. Double-click `run.bat` (first run creates a venv and installs deps). Opens http://127.0.0.1:8000.

## LLM providers (free options)
Switch in the sidebar, no restart needed.
- **Ollama**: `ollama serve`, `ollama pull <model>`. Base URL `http://localhost:11434/v1`.
- **LM Studio**: load a model, start the Local Server. Base URL `http://localhost:1234/v1`.
- **OpenCode Zen (DeepSeek v4.1 flash)**: base URL `https://opencode.ai/zen/v1`, model `deepseek-v4.1-flash`. Sign in at opencode.ai/zen, copy your API key, paste it in the panel. Free tier is limited-time and may rate limit (429).

Use "List models" to see exact model ids on Ollama/LM Studio.

## Features
Engagements (pentest/ctf/lab), targets, whitelisted tool runner (edit `allowed_tools` in `backend/config.py`), findings, scope notes, chat with engagement context, report export (.md; .pdf needs `pip install weasyprint` plus GTK libs).

Only test systems you're authorized to test.
