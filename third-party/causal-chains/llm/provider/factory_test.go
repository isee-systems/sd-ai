package provider

import (
	"strings"
	"testing"
)

func TestNewClientDefaultsToOllamaForUnknownModels(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "")

	if _, _, err := NewClient(Config{Model: "wizardlm-2"}); err != nil {
		t.Fatalf("expected fallback to Ollama for unknown model, got error: %v", err)
	}
}

func TestNewClientOpenAIModelRequiresAPIKey(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "")

	_, _, err := NewClient(Config{Model: "gpt-4.1"})
	if err == nil {
		t.Fatalf("expected error for missing OpenAI API key")
	}

	if !strings.Contains(err.Error(), "OpenAI API key required") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestNewClientClaudeModels(t *testing.T) {
	tests := []struct {
		name    string
		model   string
		apiKey  string
		envKey  string
		wantErr bool
		errMsg  string
	}{
		{
			name:    "Claude with API key",
			model:   "claude-opus-4-1-20250805",
			apiKey:  "sk-ant-test",
			wantErr: false,
		},
		{
			name:    "Claude with env key",
			model:   "claude-sonnet-4-20250514",
			envKey:  "sk-ant-env-test",
			wantErr: false,
		},
		{
			name:    "Claude without key",
			model:   "claude-3-haiku",
			wantErr: true,
			errMsg:  "Anthropic API key required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("ANTHROPIC_API_KEY", tt.envKey)

			_, _, err := NewClient(Config{
				Model:  tt.model,
				APIKey: tt.apiKey,
			})

			if (err != nil) != tt.wantErr {
				t.Errorf("NewClient() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if err != nil && tt.errMsg != "" && !strings.Contains(err.Error(), tt.errMsg) {
				t.Errorf("NewClient() error = %v, want error containing %q", err, tt.errMsg)
			}
		})
	}
}

func TestNewClientGeminiModels(t *testing.T) {
	tests := []struct {
		name    string
		model   string
		apiKey  string
		envKey  string
		wantErr bool
		errMsg  string
	}{
		{
			name:    "Gemini with API key",
			model:   "gemini-2.5-flash",
			apiKey:  "test-google-key",
			wantErr: false,
		},
		{
			name:    "Gemini with models/ prefix",
			model:   "models/gemini-1.5-pro",
			envKey:  "env-google-key",
			wantErr: false,
		},
		{
			name:    "Gemini without key",
			model:   "gemini-2.0-flash",
			wantErr: true,
			errMsg:  "Google API key required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("GOOGLE_API_KEY", tt.envKey)

			_, _, err := NewClient(Config{
				Model:  tt.model,
				APIKey: tt.apiKey,
			})

			if (err != nil) != tt.wantErr {
				t.Errorf("NewClient() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if err != nil && tt.errMsg != "" && !strings.Contains(err.Error(), tt.errMsg) {
				t.Errorf("NewClient() error = %v, want error containing %q", err, tt.errMsg)
			}
		})
	}
}

func TestNewClientLocalModels(t *testing.T) {
	tests := []struct {
		name  string
		model string
	}{
		{name: "Llama model", model: "llama3.1"},
		{name: "Mistral model", model: "mistral-7b"},
		{name: "Mixtral model", model: "mixtral-8x7b"},
		{name: "Qwen model", model: "qwen2.5"},
		{name: "Phi model", model: "phi3"},
		{name: "DeepSeek model", model: "deepseek-coder-v2"},
		{name: "CodeLlama model", model: "codellama"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Local models should not require API keys
			t.Setenv("OPENAI_API_KEY", "")

			_, _, err := NewClient(Config{Model: tt.model})
			if err != nil {
				t.Errorf("NewClient() for local model %q failed: %v", tt.model, err)
			}
		})
	}
}

func TestNewClientOpenAIReasoningModels(t *testing.T) {
	tests := []struct {
		name  string
		model string
	}{
		{name: "o1 model", model: "o1-preview"},
		{name: "o1-mini model", model: "o1-mini"},
		{name: "o3 model", model: "o3-mini"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("OPENAI_API_KEY", "test-key")

			// Should create client successfully with reasoning model detection
			_, _, err := NewClient(Config{Model: tt.model})
			if err != nil {
				t.Errorf("NewClient() for reasoning model %q failed: %v", tt.model, err)
			}
		})
	}
}

func TestNewClientDebugMode(t *testing.T) {
	tests := []struct {
		name  string
		model string
		debug bool
	}{
		{name: "Claude with debug", model: "claude-opus-4-1-20250805"},
		{name: "Gemini with debug", model: "gemini-2.5-flash"},
		{name: "OpenAI with debug", model: "gpt-4.1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Set appropriate API keys
			t.Setenv("OPENAI_API_KEY", "test-openai")
			t.Setenv("ANTHROPIC_API_KEY", "test-anthropic")
			t.Setenv("GOOGLE_API_KEY", "test-google")

			_, _, err := NewClient(Config{
				Model: tt.model,
				Debug: true,
			})
			if err != nil {
				t.Errorf("NewClient() with debug mode failed: %v", err)
			}
		})
	}
}

func TestNewClientAPIBaseOverride(t *testing.T) {
	tests := []struct {
		name    string
		model   string
		apiBase string
		apiKey  string
	}{
		{
			name:    "Custom OpenAI endpoint",
			model:   "gpt-4",
			apiBase: "https://custom.openai.endpoint/v1",
			apiKey:  "test-key",
		},
		{
			name:    "Custom Claude endpoint",
			model:   "claude-3-haiku",
			apiBase: "https://custom.anthropic.endpoint",
			apiKey:  "test-key",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := NewClient(Config{
				Model:   tt.model,
				APIBase: tt.apiBase,
				APIKey:  tt.apiKey,
			})
			if err != nil {
				t.Errorf("NewClient() with custom API base failed: %v", err)
			}
		})
	}
}

func TestParseModelAndThinkingLevel(t *testing.T) {
	tests := []struct {
		name              string
		input             string
		wantModel         string
		wantThinkingLevel string
	}{
		{
			name:              "Gemini with low thinking level",
			input:             "gemini-3-flash-preview low",
			wantModel:         "gemini-3-flash-preview",
			wantThinkingLevel: "low",
		},
		{
			name:              "Claude with medium thinking level",
			input:             "claude-opus-4 medium",
			wantModel:         "claude-opus-4",
			wantThinkingLevel: "medium",
		},
		{
			name:              "GPT with high thinking level",
			input:             "gpt-4 high",
			wantModel:         "gpt-4",
			wantThinkingLevel: "high",
		},
		{
			name:              "Model without thinking level",
			input:             "gemini-2.5-flash",
			wantModel:         "gemini-2.5-flash",
			wantThinkingLevel: "",
		},
		{
			name:              "Model with custom thinking level",
			input:             "o1-preview custom-effort",
			wantModel:         "o1-preview",
			wantThinkingLevel: "custom-effort",
		},
		{
			name:              "Model with numeric thinking level",
			input:             "claude-sonnet-4 5",
			wantModel:         "claude-sonnet-4",
			wantThinkingLevel: "5",
		},
		{
			name:              "Empty input",
			input:             "",
			wantModel:         "",
			wantThinkingLevel: "",
		},
		{
			name:              "Only whitespace",
			input:             "   ",
			wantModel:         "",
			wantThinkingLevel: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotModel, gotThinkingLevel := parseModelAndThinkingLevel(tt.input)
			if gotModel != tt.wantModel {
				t.Errorf("parseModelAndThinkingLevel() model = %q, want %q", gotModel, tt.wantModel)
			}
			if gotThinkingLevel != tt.wantThinkingLevel {
				t.Errorf("parseModelAndThinkingLevel() thinkingLevel = %q, want %q", gotThinkingLevel, tt.wantThinkingLevel)
			}
		})
	}
}

func TestNewClientWithThinkingLevel(t *testing.T) {
	tests := []struct {
		name              string
		model             string
		apiKey            string
		wantThinkingLevel string
	}{
		{
			name:              "Gemini with thinking level in model string",
			model:             "gemini-2.5-flash low",
			apiKey:            "test-google-key",
			wantThinkingLevel: "low",
		},
		{
			name:              "Claude with thinking level",
			model:             "claude-opus-4 medium",
			apiKey:            "test-anthropic-key",
			wantThinkingLevel: "medium",
		},
		{
			name:              "GPT with thinking level",
			model:             "gpt-4 high",
			apiKey:            "test-openai-key",
			wantThinkingLevel: "high",
		},
		{
			name:              "Model without thinking level",
			model:             "gemini-2.5-flash",
			apiKey:            "test-google-key",
			wantThinkingLevel: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("GOOGLE_API_KEY", "test-google")
			t.Setenv("ANTHROPIC_API_KEY", "test-anthropic")
			t.Setenv("OPENAI_API_KEY", "test-openai")

			_, thinkingLevel, err := NewClient(Config{
				Model:  tt.model,
				APIKey: tt.apiKey,
			})
			if err != nil {
				t.Errorf("NewClient() error = %v", err)
				return
			}

			if thinkingLevel != tt.wantThinkingLevel {
				t.Errorf("NewClient() thinkingLevel = %q, want %q", thinkingLevel, tt.wantThinkingLevel)
			}
		})
	}
}
