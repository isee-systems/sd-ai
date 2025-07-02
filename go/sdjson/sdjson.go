package sdjson

import (
	"encoding/json"
	"fmt"
)

type Polarity int

const (
	NegativePolarity Polarity = iota
	PositivePolarity
)

func (p Polarity) MarshalJSON() ([]byte, error) {
	return []byte("\"" + p.Symbol() + "\""), nil
}

func (p *Polarity) UnmarshalJSON(b []byte) error {
	switch string(b) {
	case `"+"`:
		*p = PositivePolarity
	case `"-"`:
		*p = NegativePolarity
	default:
		return fmt.Errorf("unknown polarity: %q", string(b))
	}
	return nil
}

var (
	_ json.Unmarshaler = (*Polarity)(nil)
	_ json.Marshaler   = Polarity(0)
)

func (p Polarity) IsPositive() bool {
	return p == PositivePolarity
}

func (p Polarity) IsNegative() bool {
	return !p.IsPositive()
}

func (p Polarity) Symbol() string {
	switch p {
	case PositivePolarity:
		return "+"
	default:
		return "-"
	}
}

func (p Polarity) String() string {
	return p.Symbol()
}

type VariableType int

const (
	VariableTypeAux VariableType = iota
	VariableTypeStock
	VariableTypeFlow
)

func (v VariableType) String() string {
	switch v {
	case VariableTypeAux:
		return "variable"
	case VariableTypeStock:
		return "stock"
	case VariableTypeFlow:
		return "flow"
	default:
		return ""
	}
}

func (v VariableType) MarshalJSON() ([]byte, error) {
	return []byte("\"" + v.String() + "\""), nil
}

func (p *VariableType) UnmarshalJSON(b []byte) error {
	switch string(b) {
	case `"variable"`:
		*p = VariableTypeAux
	case `"stock"`:
		*p = VariableTypeStock
	case `"flow"`:
		*p = VariableTypeFlow
	default:
		return fmt.Errorf("unknown variable type: %q", string(b))
	}
	return nil
}

var (
	_ json.Unmarshaler = (*VariableType)(nil)
	_ json.Marshaler   = VariableType(0)
)

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type GraphicalFunction struct {
	Points []Point `json:"points"`
}

type Variable struct {
	Name              string             `json:"name"`
	Type              VariableType       `json:"type"`
	Equation          string             `json:"equation,omitzero"`
	Documentation     string             `json:"documentation,omitzero"`
	Units             string             `json:"units,omitzero"`
	Inflows           []string           `json:"inflows,omitzero"`
	Outflows          []string           `json:"outflows,omitzero"`
	GraphicalFunction *GraphicalFunction `json:"graphicalFunction,omitzero"`
}

type Relationship struct {
	From              string `json:"from"`
	To                string `json:"to"`
	Polarity          string `json:"polarity"` // "+", or "-"
	Reasoning         string `json:"reasoning,omitzero"`
	PolarityReasoning string `json:"polarityReasoning,omitzero"`
}

func (r *Relationship) Key() string {
	// ignore polarity: we don't want duplicate relationships with opposite polarity
	return fmt.Sprintf("%q->%q", r.From, r.To)
}

type Specs struct {
	StartTime float64 `json:"startTime"`
	StopTime  float64 `json:"stopTime"`
	DT        float64 `json:"dt,omitzero"`
	SaveStep  float64 `json:"saveStep,omitzero"`
	TimeUnits string  `json:"timeUnits,omitzero"`
}

// Model is the format that sd-ai expects to talk about models.
type Model struct {
	Variables     []Variable     `json:"variables,omitzero"`
	Relationships []Relationship `json:"relationships,omitzero"`
	Specs         Specs          `json:"specs,omitzero"`
}
