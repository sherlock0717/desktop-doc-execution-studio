"""LLM providers: default Ollama (local), optional OpenAI-compatible HTTP API."""

from __future__ import annotations

import json
import os
import re
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

import requests

DEFAULT_OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
DEFAULT_OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
DEFAULT_OPENAI_BASE = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")


def check_ollama_available(base_url: str = DEFAULT_OLLAMA_URL, timeout: float = 3.0) -> bool:
    """Return True if Ollama responds on /api/tags (same host as chat)."""
    try:
        r = requests.get(f"{base_url}/api/tags", timeout=timeout)
        return r.status_code == 200
    except requests.RequestException:
        return False


def extract_json_object(text: str) -> Dict[str, Any]:
    """
    Parse JSON from model output. Handles optional ```json fences and extra prose.
    """
    raw = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if fence:
        raw = fence.group(1).strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            pass

    raise ValueError("模型返回内容不是合法 JSON")


class LLMProvider(ABC):
    """Extension point for OpenAI-compatible servers."""

    @abstractmethod
    def complete(self, messages: List[Dict[str, str]], *, json_mode: bool = True) -> str:
        """Return assistant text (JSON string when json_mode=True)."""


class OllamaProvider(LLMProvider):
    def __init__(self, base_url: str = DEFAULT_OLLAMA_URL, model: str = DEFAULT_OLLAMA_MODEL):
        self.base_url = base_url.rstrip("/")
        self.model = model

    def complete(self, messages: List[Dict[str, str]], *, json_mode: bool = True) -> str:
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
        }
        if json_mode:
            payload["format"] = "json"

        r = requests.post(
            f"{self.base_url}/api/chat",
            json=payload,
            timeout=600,
        )
        r.raise_for_status()
        data = r.json()
        content = (data.get("message") or {}).get("content")
        if not isinstance(content, str):
            raise RuntimeError("Ollama 响应缺少 message.content")
        return content


class OpenAICompatibleProvider(LLMProvider):
    """
    OpenAI-compatible Chat Completions (Anthropic proxy, vLLM, etc.).
    Set OPENAI_API_KEY; optional OPENAI_BASE_URL for Azure / local gateways.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = DEFAULT_OPENAI_BASE,
        model: Optional[str] = None,
    ):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY", "")
        self.base_url = base_url.rstrip("/")
        self.model = model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        if not self.api_key:
            raise ValueError("使用 OpenAI 兼容接口需要设置 OPENAI_API_KEY")

    def complete(self, messages: List[Dict[str, str]], *, json_mode: bool = True) -> str:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        body: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}

        r = requests.post(
            f"{self.base_url}/chat/completions",
            headers=headers,
            json=body,
            timeout=600,
        )
        r.raise_for_status()
        data = r.json()
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError("OpenAI 兼容接口未返回 choices")
        msg = choices[0].get("message") or {}
        content = msg.get("content")
        if not isinstance(content, str):
            raise RuntimeError("OpenAI 兼容接口缺少 message.content")
        return content


def get_provider() -> LLMProvider:
    """LLM_BACKEND=ollama (default) | openai_compatible"""
    backend = os.getenv("LLM_BACKEND", "ollama").lower().strip()
    if backend in ("openai", "openai_compatible", "openai-compat"):
        return OpenAICompatibleProvider()
    return OllamaProvider(
        base_url=os.getenv("OLLAMA_BASE_URL", DEFAULT_OLLAMA_URL),
        model=os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL),
    )


def get_active_model_label() -> str:
    """Label stored in generation metadata."""
    backend = os.getenv("LLM_BACKEND", "ollama").lower().strip()
    if backend in ("openai", "openai_compatible", "openai-compat"):
        return os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    return os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL)
