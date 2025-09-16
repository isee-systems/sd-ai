package provider

import (
	"fmt"
	"os"
	"strings"

	"github.com/bpowers/go-agent/chat"
	"github.com/bpowers/go-agent/llm/claude"
	"github.com/bpowers/go-agent/llm/gemini"
	"github.com/bpowers/go-agent/llm/openai"
)

const (
	OpenAIAPIBase = "https://api.openai.com/v1"
	OllamaAPIBase = "http://localhost:11434/v1"
)

type Config struct {
	Model   string
	APIBase string
	APIKey  string
	Debug   bool
}

func NewClient(cfg Config) (chat.Client, error) {
	modelLower := strings.ToLower(cfg.Model)

	if isClaudeModel(modelLower) {
		apiKey := cfg.APIKey
		if apiKey == "" {
			apiKey = os.Getenv("ANTHROPIC_API_KEY")
		}
		if apiKey == "" {
			return nil, fmt.Errorf("Anthropic API key required for model %s", cfg.Model)
		}

		apiBase := cfg.APIBase
		if apiBase == "" {
			apiBase = claude.AnthropicURL
		}

		opts := []claude.Option{
			claude.WithModel(cfg.Model),
		}
		if cfg.Debug {
			opts = append(opts, claude.WithDebug(true))
		}

		return claude.NewClient(apiBase, apiKey, opts...)
	}

	if isGeminiModel(modelLower) {
		apiKey := cfg.APIKey
		if apiKey == "" {
			apiKey = os.Getenv("GOOGLE_API_KEY")
		}
		if apiKey == "" {
			return nil, fmt.Errorf("Google API key required for model %s", cfg.Model)
		}

		opts := []gemini.Option{
			gemini.WithModel(cfg.Model),
		}
		if cfg.Debug {
			opts = append(opts, gemini.WithDebug(true))
		}

		return gemini.NewClient(apiKey, opts...)
	}

	// Default to OpenAI-compatible
	apiBase := cfg.APIBase
	apiKey := cfg.APIKey

	if apiBase == "" {
		if isLocalModel(modelLower) {
			apiBase = OllamaAPIBase
		} else {
			apiBase = OpenAIAPIBase
		}
	}

	if apiKey == "" && !isLocalModel(modelLower) {
		apiKey = os.Getenv("OPENAI_API_KEY")
		if apiKey == "" {
			return nil, fmt.Errorf("OpenAI API key required for model %s", cfg.Model)
		}
	}

	opts := []openai.Option{
		openai.WithModel(cfg.Model),
	}
	if cfg.Debug {
		opts = append(opts, openai.WithDebug(true))
	}

	// Use Responses API for o1/o3 models, ChatCompletions for others
	if isOpenAIReasoningModel(modelLower) {
		opts = append(opts, openai.WithAPI(openai.Responses))
	}

	return openai.NewClient(apiBase, apiKey, opts...)
}

func isClaudeModel(model string) bool {
	return strings.HasPrefix(model, "claude-")
}

func isGeminiModel(model string) bool {
	return strings.HasPrefix(model, "gemini-") ||
		strings.HasPrefix(model, "models/gemini-")
}

func isOpenAIModel(model string) bool {
	return strings.HasPrefix(model, "gpt") ||
		strings.HasPrefix(model, "chatgpt") ||
		strings.HasPrefix(model, "o1") ||
		strings.HasPrefix(model, "o3") ||
		strings.HasPrefix(model, "o4")
}

func isOpenAIReasoningModel(model string) bool {
	return strings.HasPrefix(model, "o1-") ||
		strings.HasPrefix(model, "o3-")
}

func isLocalModel(model string) bool {
	localPrefixes := []string{
		"llama", "mistral", "mixtral", "qwen", "phi",
		"deepseek-coder", "codellama", "vicuna", "alpaca",
	}

	for _, prefix := range localPrefixes {
		if strings.HasPrefix(model, prefix) {
			return true
		}
	}

	if isOpenAIModel(model) || isClaudeModel(model) || isGeminiModel(model) {
		return false
	}

	// Treat all unrecognized models as local (Ollama) by default.
	return true
}
