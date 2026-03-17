package causal

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/bpowers/go-agent/chat"
)

var codeFenceStartRe = regexp.MustCompile("^```.*\n")

type Diagrammer interface {
	Generate(ctx context.Context, prompt, backgroundKnowledge string) (*Map, error)
}

type diagrammer struct {
	client chat.Client
}

var _ Diagrammer = &diagrammer{}

func NewDiagrammer(client chat.Client) Diagrammer {
	return diagrammer{
		client: client,
	}
}

var (
	//go:embed system_prompt.txt
	baseSystemPrompt string

	//go:embed background_prompt.txt
	backgroundPrompt string
)

func (d diagrammer) Generate(ctx context.Context, prompt, backgroundKnowledge string) (*Map, error) {
	schema, err := json.MarshalIndent(RelationshipsResponseSchema, "", "    ")
	if err != nil {
		return nil, fmt.Errorf("json.MarshalIndent: %w", err)
	}

	systemPrompt := strings.ReplaceAll(baseSystemPrompt, "{schema}", string(schema))

	msg := chat.UserMessage(fmt.Sprintf("%s\n\n%s",
		strings.ReplaceAll(backgroundPrompt, "{backgroundKnowledge}", backgroundKnowledge),
		prompt,
	))

	c := d.client.NewChat(systemPrompt)

	maxTokens := c.MaxTokens()
	if maxTokens <= 0 {
		maxTokens = 64 * 1024
	}

	resp, err := c.Message(ctx, msg,
		chat.WithResponseFormat("relationships_response", true, RelationshipsResponseSchema),
		chat.WithMaxTokens(maxTokens),
	)
	if err != nil {
		return nil, fmt.Errorf("c.ChatCompletion: %w", err)
	}

	result, err := parseRelationshipsResponse(resp.GetText())
	if err != nil {
		// Some models like Anthropic's don't _actually_ support structured outputs.
		// Retry a second time with the error we just got, hoping they can get their act together.
		retryMsg := chat.UserMessage(fmt.Sprintf("Your response didn't match the required structured JSON output. The specific error was: %v\n\nRe-generate your response addressing this error, ensuring it matches the required structured JSON output format from the system prompt.", err))

		resp, retryErr := c.Message(ctx, retryMsg,
			chat.WithResponseFormat("relationships_response", true, RelationshipsResponseSchema),
			chat.WithMaxTokens(maxTokens),
		)
		if retryErr != nil {
			return nil, fmt.Errorf("retry failed: %w (original error: %v)", retryErr, err)
		}

		result, err = parseRelationshipsResponse(resp.GetText())
		if err != nil {
			return nil, fmt.Errorf("failed to parse response after retry: %w", err)
		}
	}

	return result, nil
}

func parseRelationshipsResponse(content string) (*Map, error) {
	cleaned := stripCodeFence(content)
	if cleaned == "" {
		return nil, fmt.Errorf("empty response content")
	}

	var rr Map
	if err := json.Unmarshal([]byte(cleaned), &rr); err != nil {
		return nil, fmt.Errorf("json.Unmarshal: %w", err)
	}

	return &rr, nil
}

func stripCodeFence(s string) string {
	trimmed := strings.TrimSpace(s)

	// Handle multiple fence formats: ```json, ```JSON, ```
	if strings.HasPrefix(trimmed, "```") {
		// Remove opening fence and optional language identifier
		trimmed = codeFenceStartRe.ReplaceAllString(trimmed, "")

		// Remove closing fence if present
		if idx := strings.LastIndex(trimmed, "```"); idx != -1 {
			trimmed = trimmed[:idx]
		}
	}

	return strings.TrimSpace(trimmed)
}
