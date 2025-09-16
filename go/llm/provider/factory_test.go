package provider

import (
	"strings"
	"testing"
)

func TestNewClientDefaultsToOllamaForUnknownModels(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "")

	if _, err := NewClient(Config{Model: "wizardlm-2"}); err != nil {
		t.Fatalf("expected fallback to Ollama for unknown model, got error: %v", err)
	}
}

func TestNewClientOpenAIModelRequiresAPIKey(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "")

	_, err := NewClient(Config{Model: "gpt-4.1"})
	if err == nil {
		t.Fatalf("expected error for missing OpenAI API key")
	}

	if !strings.Contains(err.Error(), "OpenAI API key required") {
		t.Fatalf("unexpected error: %v", err)
	}
}
