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

	return parseRelationshipsResponse(resp.Content)
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
	if !strings.HasPrefix(trimmed, "```") {
		return trimmed
	}

	trimmed = strings.TrimPrefix(trimmed, "```")
	trimmed = strings.TrimSpace(trimmed)

	if newline := strings.Index(trimmed, "\n"); newline != -1 {
		trimmed = trimmed[newline+1:]
	} else {
		// No newline means there was nothing beyond the fence header
		return ""
	}

	if idx := strings.LastIndex(trimmed, "```"); idx != -1 {
		trimmed = trimmed[:idx]
	}

	return strings.TrimSpace(trimmed)
}
