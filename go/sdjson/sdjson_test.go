package sdjson

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPolarityRoundtrip(t *testing.T) {
	tests := []struct {
		name     string
		polarity Polarity
		expected string
	}{
		{
			name:     "positive polarity",
			polarity: PositivePolarity,
			expected: `"+"`,
		},
		{
			name:     "negative polarity",
			polarity: NegativePolarity,
			expected: `"-"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Test Marshal
			data, err := json.Marshal(tt.polarity)
			require.NoError(t, err)
			assert.Equal(t, tt.expected, string(data))

			// Test Unmarshal
			var p Polarity
			err = json.Unmarshal(data, &p)
			require.NoError(t, err)
			assert.Equal(t, tt.polarity, p)
		})
	}
}

func TestPolarityUnmarshalError(t *testing.T) {
	invalidInputs := []string{
		`"?"`,
		`"positive"`,
		`""`,
		`null`,
		`123`,
	}

	for _, input := range invalidInputs {
		t.Run(input, func(t *testing.T) {
			var p Polarity
			err := json.Unmarshal([]byte(input), &p)
			assert.Error(t, err, "Expected error for input %s", input)
		})
	}
}

func TestPolarityMethods(t *testing.T) {
	tests := []struct {
		polarity   Polarity
		isPositive bool
		isNegative bool
		symbol     string
		str        string
	}{
		{
			polarity:   PositivePolarity,
			isPositive: true,
			isNegative: false,
			symbol:     "+",
			str:        "+",
		},
		{
			polarity:   NegativePolarity,
			isPositive: false,
			isNegative: true,
			symbol:     "-",
			str:        "-",
		},
	}

	for _, tt := range tests {
		t.Run(tt.str, func(t *testing.T) {
			assert.Equal(t, tt.isPositive, tt.polarity.IsPositive())
			assert.Equal(t, tt.isNegative, tt.polarity.IsNegative())
			assert.Equal(t, tt.symbol, tt.polarity.Symbol())
			assert.Equal(t, tt.str, tt.polarity.String())
		})
	}
}

func TestVariableTypeRoundtrip(t *testing.T) {
	tests := []struct {
		name     string
		varType  VariableType
		expected string
	}{
		{
			name:     "aux/variable type",
			varType:  VariableTypeAux,
			expected: `"variable"`,
		},
		{
			name:     "stock type",
			varType:  VariableTypeStock,
			expected: `"stock"`,
		},
		{
			name:     "flow type",
			varType:  VariableTypeFlow,
			expected: `"flow"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Test Marshal
			data, err := json.Marshal(tt.varType)
			require.NoError(t, err)
			assert.Equal(t, tt.expected, string(data))

			// Test Unmarshal
			var vt VariableType
			err = json.Unmarshal(data, &vt)
			require.NoError(t, err)
			assert.Equal(t, tt.varType, vt)
		})
	}
}

func TestVariableTypeUnmarshalError(t *testing.T) {
	invalidInputs := []string{
		`"unknown"`,
		`"aux"`,
		`""`,
		`null`,
		`123`,
	}

	for _, input := range invalidInputs {
		t.Run(input, func(t *testing.T) {
			var vt VariableType
			err := json.Unmarshal([]byte(input), &vt)
			assert.Error(t, err, "Expected error for input %s", input)
		})
	}
}

func TestVariableTypeString(t *testing.T) {
	tests := []struct {
		varType  VariableType
		expected string
	}{
		{VariableTypeAux, "variable"},
		{VariableTypeStock, "stock"},
		{VariableTypeFlow, "flow"},
		{VariableType(999), ""}, // unknown type
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.varType.String())
		})
	}
}

func TestPointRoundtrip(t *testing.T) {
	tests := []struct {
		name  string
		point Point
	}{
		{
			name:  "zero point",
			point: Point{X: 0, Y: 0},
		},
		{
			name:  "positive point",
			point: Point{X: 10.5, Y: 20.3},
		},
		{
			name:  "negative point",
			point: Point{X: -10.5, Y: -20.3},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.point)
			require.NoError(t, err)

			var p Point
			err = json.Unmarshal(data, &p)
			require.NoError(t, err)
			assert.Equal(t, tt.point, p)
		})
	}
}

func TestGraphicalFunctionRoundtrip(t *testing.T) {
	tests := []struct {
		name string
		gf   GraphicalFunction
	}{
		{
			name: "empty points",
			gf:   GraphicalFunction{Points: []Point{}},
		},
		{
			name: "single point",
			gf:   GraphicalFunction{Points: []Point{{X: 1, Y: 2}}},
		},
		{
			name: "multiple points",
			gf: GraphicalFunction{
				Points: []Point{
					{X: 0, Y: 0},
					{X: 1, Y: 2},
					{X: 2, Y: 4},
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.gf)
			require.NoError(t, err)

			var gf GraphicalFunction
			err = json.Unmarshal(data, &gf)
			require.NoError(t, err)

			require.Len(t, gf.Points, len(tt.gf.Points))
			for i := range gf.Points {
				assert.Equal(t, tt.gf.Points[i], gf.Points[i], "Point[%d] mismatch", i)
			}
		})
	}
}

func TestVariableRoundtrip(t *testing.T) {
	tests := []struct {
		name     string
		variable Variable
	}{
		{
			name: "minimal variable",
			variable: Variable{
				Name: "test_var",
			},
		},
		{
			name: "stock variable with inflows/outflows",
			variable: Variable{
				Name:     "inventory",
				Type:     VariableTypeStock,
				Units:    "widgets",
				Inflows:  []string{"production"},
				Outflows: []string{"sales"},
			},
		},
		{
			name: "variable with equation",
			variable: Variable{
				Name:          "growth_rate",
				Type:          VariableTypeAux,
				Equation:      "population * birth_rate",
				Documentation: "Calculates population growth",
				Units:         "people/year",
			},
		},
		{
			name: "variable with graphical function",
			variable: Variable{
				Name: "lookup_table",
				Type: VariableTypeAux,
				GraphicalFunction: &GraphicalFunction{
					Points: []Point{
						{X: 0, Y: 0},
						{X: 10, Y: 100},
					},
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.variable)
			require.NoError(t, err)

			var v Variable
			err = json.Unmarshal(data, &v)
			require.NoError(t, err)

			// Compare fields
			assert.Equal(t, tt.variable.Name, v.Name)
			assert.Equal(t, tt.variable.Type, v.Type)
			assert.Equal(t, tt.variable.Equation, v.Equation)
			assert.Equal(t, tt.variable.Documentation, v.Documentation)
			assert.Equal(t, tt.variable.Units, v.Units)

			// Compare slices
			assert.Equal(t, tt.variable.Inflows, v.Inflows)
			assert.Equal(t, tt.variable.Outflows, v.Outflows)

			// Compare GraphicalFunction
			if tt.variable.GraphicalFunction == nil {
				assert.Nil(t, v.GraphicalFunction)
			} else {
				require.NotNil(t, v.GraphicalFunction)
				assert.Equal(t, tt.variable.GraphicalFunction.Points, v.GraphicalFunction.Points)
			}
		})
	}
}

func TestRelationshipRoundtrip(t *testing.T) {
	tests := []struct {
		name         string
		relationship Relationship
	}{
		{
			name: "minimal relationship",
			relationship: Relationship{
				From:     "cause",
				To:       "effect",
				Polarity: "+",
			},
		},
		{
			name: "relationship with reasoning",
			relationship: Relationship{
				From:              "temperature",
				To:                "ice_cream_sales",
				Polarity:          "+",
				Reasoning:         "Higher temperatures increase ice cream demand",
				PolarityReasoning: "As temperature goes up, sales go up",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.relationship)
			require.NoError(t, err)

			var r Relationship
			err = json.Unmarshal(data, &r)
			require.NoError(t, err)

			assert.Equal(t, tt.relationship, r)
		})
	}
}

func TestRelationshipKey(t *testing.T) {
	tests := []struct {
		relationship Relationship
		expectedKey  string
	}{
		{
			relationship: Relationship{From: "A", To: "B", Polarity: "+"},
			expectedKey:  `"A"->"B"`,
		},
		{
			relationship: Relationship{From: "A", To: "B", Polarity: "-"},
			expectedKey:  `"A"->"B"`, // polarity is ignored in key
		},
	}

	for _, tt := range tests {
		t.Run(tt.expectedKey, func(t *testing.T) {
			assert.Equal(t, tt.expectedKey, tt.relationship.Key())
		})
	}
}

func TestSpecsRoundtrip(t *testing.T) {
	tests := []struct {
		name  string
		specs Specs
	}{
		{
			name: "minimal specs",
			specs: Specs{
				StartTime: 0,
				StopTime:  100,
			},
		},
		{
			name: "full specs",
			specs: Specs{
				StartTime: 0,
				StopTime:  365,
				DT:        0.25,
				SaveStep:  1,
				TimeUnits: "days",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.specs)
			require.NoError(t, err)

			var s Specs
			err = json.Unmarshal(data, &s)
			require.NoError(t, err)

			assert.Equal(t, tt.specs, s)
		})
	}
}

func TestModelRoundtrip(t *testing.T) {
	tests := []struct {
		name       string
		model      Model
		serialized string
	}{
		{
			name:       "empty model",
			model:      Model{},
			serialized: `{}`,
		},
		{
			name: "complete model",
			model: Model{
				Variables: []Variable{
					{
						Name:     "population",
						Type:     VariableTypeStock,
						Units:    "people",
						Inflows:  []string{"births"},
						Outflows: []string{"deaths"},
					},
					{
						Name:          "birth_rate",
						Type:          VariableTypeAux,
						Documentation: "Birth rate of the population",
						Equation:      "0.02",
						Units:         "1/year",
					},
					{
						Name:     "births",
						Type:     VariableTypeFlow,
						Equation: "population * birth_rate",
						Units:    "people/year",
					},
					{
						Name:          "some_gf",
						Type:          VariableTypeAux,
						Documentation: "for testing",
						Units:         "dmnl",
						GraphicalFunction: &GraphicalFunction{
							Points: []Point{
								{X: 0, Y: 0},
								{X: 10, Y: 100},
							},
						},
					},
				},
				Relationships: []Relationship{
					{
						From:              "population",
						To:                "births",
						Polarity:          "+",
						PolarityReasoning: "Births come from individuals in the population",
					},
					{
						From:      "birth_rate",
						To:        "births",
						Polarity:  "+",
						Reasoning: "need a rate for births",
					},
				},
				Specs: Specs{
					StartTime: 0,
					StopTime:  100,
					DT:        0.25,
					TimeUnits: "years",
				},
			},
			serialized: `{
  "variables": [
    {
      "name": "population",
      "type": "stock",
      "units": "people",
      "inflows": [
        "births"
      ],
      "outflows": [
        "deaths"
      ]
    },
    {
      "name": "birth_rate",
      "type": "variable",
      "equation": "0.02",
      "documentation": "Birth rate of the population",
      "units": "1/year"
    },
    {
      "name": "births",
      "type": "flow",
      "equation": "population * birth_rate",
      "units": "people/year"
    },
    {
      "name": "some_gf",
      "type": "variable",
      "documentation": "for testing",
      "units": "dmnl",
      "graphicalFunction": {
        "points": [
          {
            "x": 0,
            "y": 0
          },
          {
            "x": 10,
            "y": 100
          }
        ]
      }
    }
  ],
  "relationships": [
    {
      "from": "population",
      "to": "births",
      "polarity": "+",
      "polarityReasoning": "Births come from individuals in the population"
    },
    {
      "from": "birth_rate",
      "to": "births",
      "polarity": "+",
      "reasoning": "need a rate for births"
    }
  ],
  "specs": {
    "startTime": 0,
    "stopTime": 100,
    "dt": 0.25,
    "timeUnits": "years"
  }
}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.MarshalIndent(tt.model, "", "  ")
			require.NoError(t, err)

			assert.Equal(t, tt.serialized, string(data))

			var m Model
			err = json.Unmarshal(data, &m)
			require.NoError(t, err)

			assert.Len(t, m.Variables, len(tt.model.Variables))
			assert.Len(t, m.Relationships, len(tt.model.Relationships))
			assert.Equal(t, tt.model.Specs, m.Specs)
		})
	}
}
