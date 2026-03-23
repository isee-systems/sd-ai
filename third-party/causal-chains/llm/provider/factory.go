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

type Config struct {
	Model         string
	APIBase       string
	APIKey        string
	Debug         bool
	ThinkingLevel string
}

func NewClient(cfg Config) (chat.Client, string, error) {
	// Parse model name and thinking level from the model string
	model, thinkingLevel := parseModelAndThinkingLevel(cfg.Model)
	if thinkingLevel == "" && cfg.ThinkingLevel != "" {
		thinkingLevel = cfg.ThinkingLevel
	}

	modelLower := strings.ToLower(model)

	if isClaudeModel(modelLower) {
		apiKey := cfg.APIKey
		if apiKey == "" {
			apiKey = os.Getenv("ANTHROPIC_API_KEY")
		}
		if apiKey == "" {
			return nil, "", fmt.Errorf("Anthropic API key required for model %s", model)
		}

		apiBase := cfg.APIBase
		if apiBase == "" {
			apiBase = claude.AnthropicURL
		}

		opts := []claude.Option{
			claude.WithModel(model),
		}
		if cfg.Debug {
			opts = append(opts, claude.WithDebug(true))
		}

		client, err := claude.NewClient(apiBase, apiKey, opts...)
		return client, thinkingLevel, err
	}

	if isGeminiModel(modelLower) {
		apiKey := cfg.APIKey
		if apiKey == "" {
			apiKey = os.Getenv("GOOGLE_API_KEY")
		}
		if apiKey == "" {
			return nil, "", fmt.Errorf("Google API key required for model %s", model)
		}

		opts := []gemini.Option{
			gemini.WithModel(model),
		}
		if cfg.Debug {
			opts = append(opts, gemini.WithDebug(true))
		}

		client, err := gemini.NewClient(apiKey, opts...)
		return client, thinkingLevel, err
	}

	// Default to OpenAI-compatible
	apiBase := cfg.APIBase
	apiKey := cfg.APIKey

	if apiBase == "" {
		if isOpenAIModel(modelLower) {
			apiBase = openai.OpenAIURL
		} else {
			apiBase = openai.OllamaURL
		}
	}

	if apiKey == "" && isOpenAIModel(modelLower) {
		apiKey = os.Getenv("OPENAI_API_KEY")
		if apiKey == "" {
			return nil, "", fmt.Errorf("OpenAI API key required for model %s", model)
		}
	}

	opts := []openai.Option{
		openai.WithModel(model),
	}
	if cfg.Debug {
		opts = append(opts, openai.WithDebug(true))
	}

	// Use Responses API for o1/o3 models, ChatCompletions for others
	if isOpenAIReasoningModel(modelLower) {
		opts = append(opts, openai.WithAPI(openai.Responses))
	}

	client, err := openai.NewClient(apiBase, apiKey, opts...)
	return client, thinkingLevel, err
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

// parseModelAndThinkingLevel extracts the model name and thinking level from a model string.
// Supports formats like "gemini-3-flash-preview low" or "claude-opus-4 medium".
// Returns the base model name and thinking level (any string after the model name).
func parseModelAndThinkingLevel(modelStr string) (model, thinkingLevel string) {
	parts := strings.Fields(strings.TrimSpace(modelStr))
	if len(parts) == 0 {
		return "", ""
	}

	model = parts[0]

	// If there's a second part, treat it as the thinking level
	if len(parts) >= 2 {
		thinkingLevel = parts[len(parts)-1]
	}

	return model, thinkingLevel
}
