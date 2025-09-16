package causal

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/bpowers/go-agent/chat"
)

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

	msg := chat.Message{
		Role: chat.UserRole,
		Content: fmt.Sprintf("%s\n\n%s",
			strings.ReplaceAll(backgroundPrompt, "{backgroundKnowledge}", backgroundKnowledge),
			prompt,
		),
	}

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

	result, err := parseRelationshipsResponse(resp.Content)
	if err != nil {
		// Retry with a correction message
		retryMsg := chat.Message{
			Role:    chat.UserRole,
			Content: fmt.Sprintf("Your response didn't match the required structured JSON output. The specific error was: %v\n\nRe-generate your response addressing this error, ensuring it matches the required structured JSON output format from the system prompt.", err),
		}

		resp, retryErr := c.Message(ctx, retryMsg,
			chat.WithResponseFormat("relationships_response", true, RelationshipsResponseSchema),
			chat.WithMaxTokens(maxTokens),
		)
		if retryErr != nil {
			return nil, fmt.Errorf("retry failed: %w (original error: %v)", retryErr, err)
		}

		result, err = parseRelationshipsResponse(resp.Content)
		if err != nil {
			return nil, fmt.Errorf("failed to parse response after retry: %w", err)
		}
	}

	return result, nil
}

func parseRelationshipsResponse(content string) (*Map, error) {
	cleaned := strings.TrimSpace(content)
	cleaned = stripCodeFence(cleaned)
	cleaned = strings.TrimSpace(cleaned)
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
		trimmed = strings.TrimPrefix(trimmed, "```")

		// Skip the language identifier (json, JSON, etc.) if present
		if newline := strings.Index(trimmed, "\n"); newline != -1 {
			trimmed = trimmed[newline+1:]
		} else if strings.TrimSpace(trimmed) == "" {
			// Just "```" with nothing after
			return ""
		}

		// Remove closing fence if present
		if idx := strings.LastIndex(trimmed, "```"); idx != -1 {
			trimmed = trimmed[:idx]
		}
	}

	// Also handle backticks that might wrap the entire response
	trimmed = strings.TrimSpace(trimmed)
	if strings.HasPrefix(trimmed, "`") && strings.HasSuffix(trimmed, "`") && len(trimmed) > 2 {
		trimmed = trimmed[1 : len(trimmed)-1]
	}

	return strings.TrimSpace(trimmed)
}
