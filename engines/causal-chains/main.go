package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path"
	"strings"

	"github.com/UB-IAD/sd-ai/go/causal"
	"github.com/UB-IAD/sd-ai/go/llm/provider"
	"github.com/UB-IAD/sd-ai/go/sdjson"
	"github.com/bpowers/go-agent/chat"
)

type parameters struct {
	ApiKey              string `json:"apiKey"`
	GoogleKey           string `json:"googleKey"`
	AnthropicKey        string `json:"anthropicKey"`
	UnderlyingModel     string `json:"underlyingModel"`
	ProblemStatement    string `json:"problemStatement"`
	BackgroundKnowledge string `json:"backgroundKnowledge"`
}

type input struct {
	Prompt       string         `json:"prompt"`
	CurrentModel map[string]any `json:"currentModel"`
	Parameters   parameters     `json:"parameters"`
}

type supportingInfo struct {
	Title       string `json:"title"`
	Explanation string `json:"explanation"`
}

type output struct {
	SupportingInfo supportingInfo `json:"supportingInfo"`
	Model          sdjson.Model   `json:"model"`
}

func selectAPIKey(model string, params parameters) string {
	switch {
	case strings.HasPrefix(model, "claude-"):
		return params.AnthropicKey
	case strings.HasPrefix(model, "models/gemini-") || strings.HasPrefix(model, "gemini-"):
		return params.GoogleKey
	default:
		return params.ApiKey
	}
}

func main() {
	argv := os.Args
	if len(argv) < 2 {
		log.Fatalf("usage: %s input_path", argv[0])
	}
	inputPath := argv[1]
	inputBytes, err := os.ReadFile(inputPath)
	if err != nil {
		log.Fatalf("os.ReadFile(%q): %s", inputPath, err)
	}

	input := new(input)
	if err = json.Unmarshal(inputBytes, &input); err != nil {
		log.Fatalf("json.Unmarshal: %s", err)
	}

	if input.Parameters.ApiKey == "" {
		input.Parameters.ApiKey = os.Getenv("OPENAI_API_KEY")
	}
	if input.Parameters.GoogleKey == "" {
		input.Parameters.GoogleKey = os.Getenv("GOOGLE_API_KEY")
	}
	if input.Parameters.AnthropicKey == "" {
		input.Parameters.AnthropicKey = os.Getenv("ANTHROPIC_API_KEY")
	}

	model := strings.ToLower(strings.TrimSpace(input.Parameters.UnderlyingModel))
	c, err := provider.NewClient(provider.Config{
		Model:  input.Parameters.UnderlyingModel,
		APIKey: selectAPIKey(model, input.Parameters),
		Debug:  os.Getenv("SD_AI_DEBUG") != "",
	})
	if err != nil {
		log.Fatalf("provider.NewClient: %s", err)
	}

	d := causal.NewDiagrammer(c)

	debugDir := path.Dir(inputPath)

	ctx := chat.WithDebugDir(context.Background(), debugDir)

	result, err := d.Generate(ctx, input.Prompt, input.Parameters.BackgroundKnowledge)
	if err != nil {
		log.Fatalf("d.Generate: %s", err)
	}

	output := new(output)
	output.SupportingInfo.Title = result.Title
	output.SupportingInfo.Explanation = result.Explanation
	output.Model = result.Compat()

	outputBytes, err := json.MarshalIndent(output, "", "    ")
	if err != nil {
		log.Fatalf("json.MarshalIndent: %s", err)
	}

	fmt.Printf("%s\n", string(outputBytes))
}
