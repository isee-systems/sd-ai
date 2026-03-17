package causal

import (
	"encoding/json"
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var testMap1 *Map

func init() {
	if err := json.Unmarshal([]byte(revolution1), &testMap1); err != nil || testMap1 == nil {
		panic(err)
	}
}

const (
	revolution1 = `{
  "title": "Reinforcing Drivers of Revolution",
  "explanation": "I identified three reinforcing loops driving the Revolution: one where taxes and enforcement stoked anger and resistance, one where joint protests built a shared American identity that fueled further action, and one where growing hostility led to organized political bodies making firm demands, which further inflamed anti-British feeling. Together they show how colonial anger, unity, and formal organization fed on each other to propel the conflict.",
  "causal_chains": [
    {
      "initial_variable": "Tax Burden",
      "relationships": [
        {
          "variable": "Colonist Anger",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Collective Action",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "British Repressive Policies",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Tax Burden",
          "polarity": "+",
          "polarityReasoning": ""
        }
      ],
      "reasoning": "This feedback loop shows how British taxation and enforcement measures fueled colonial anger, protests, and harsher British policies, which in turn increased the effective tax burden feedback loop."
    },
    {
      "initial_variable": "Collective Action",
      "relationships": [
        {
          "variable": "Colonial Identity",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Anti-British Sentiment",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Collective Action",
          "polarity": "+",
          "polarityReasoning": ""
        }
      ],
      "reasoning": "This feedback loop captures how colonial protests reinforced a shared identity and heightened opposition, driving further collective action feedback loop."
    },
    {
      "initial_variable": "Anti-British Sentiment",
      "relationships": [
        {
          "variable": "Political Mobilization",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Unified Assemblies",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Resolute Demands",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Anti-British Sentiment",
          "polarity": "+",
          "polarityReasoning": ""
        }
      ],
      "reasoning": "This loop illustrates how hostility toward Britain fueled political organization and formal demands, which then reinforced anti-British sentiment feedback loop."
    }
  ]
}`

	roadRage1 = `{
  "title": "Road Rage Feedback Loop Dynamics",
  "explanation": "I mapped six feedback loops linking congestion, frustration, aggression, incidents, accidents, norms, enforcement, and education. Loops R1 and R2 show congestion and accidents reinforcing more incidents via frustration. R3 captures social learning through observed aggression. B1, B2, and B3 are balancing loops where enforcement and public education increase risk perception and reduce aggression, thus moderating incidents and accidents.",
  "causal_chains": [
    {
      "initial_variable": "Traffic Congestion",
      "relationships": [
        {
          "variable": "Frustration Perception",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Driver Aggression",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Road Rage Incidents",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Traffic Congestion",
          "polarity": "+",
          "polarityReasoning": ""
        }
      ],
      "reasoning": "reinforcing feedback loop"
    },
    {
      "initial_variable": "Road Rage Incidents",
      "relationships": [
        {
          "variable": "Accident Rate",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Traffic Congestion",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Frustration Perception",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Driver Aggression",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Road Rage Incidents",
          "polarity": "+",
          "polarityReasoning": ""
        }
      ],
      "reasoning": "reinforcing feedback loop"
    },
    {
      "initial_variable": "Road Rage Incidents",
      "relationships": [
        {
          "variable": "Observed Aggressive Behavior",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Learned Aggressive Norms",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Driver Aggression",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Road Rage Incidents",
          "polarity": "+",
          "polarityReasoning": ""
        }
      ],
      "reasoning": "reinforcing feedback loop"
    },
    {
      "initial_variable": "Road Rage Incidents",
      "relationships": [
        {
          "variable": "Enforcement Actions",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Perceived Risk of Penalties",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Driver Aggression",
          "polarity": "-",
          "polarityReasoning": ""
        },
        {
          "variable": "Road Rage Incidents",
          "polarity": "+",
          "polarityReasoning": ""
        }
      ],
      "reasoning": "balancing feedback loop"
    },
    {
      "initial_variable": "Road Rage Incidents",
      "relationships": [
        {
          "variable": "Public Awareness",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Safety Education",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Driver Aggression",
          "polarity": "-",
          "polarityReasoning": ""
        },
        {
          "variable": "Road Rage Incidents",
          "polarity": "+",
          "polarityReasoning": ""
        }
      ],
      "reasoning": "balancing feedback loop"
    },
    {
      "initial_variable": "Accident Rate",
      "relationships": [
        {
          "variable": "Public Awareness",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Enforcement Actions",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Perceived Risk of Penalties",
          "polarity": "+",
          "polarityReasoning": ""
        },
        {
          "variable": "Driver Aggression",
          "polarity": "-",
          "polarityReasoning": ""
        },
        {
          "variable": "Accident Rate",
          "polarity": "+",
          "polarityReasoning": ""
        }
      ],
      "reasoning": "balancing feedback loop"
    }
  ]
}`
)

func TestExtractingResults(t *testing.T) {
	causalMap := testMap1

	expectedVars := NewSet(
		"Anti-British Sentiment",
		"British Repressive Policies",
		"Collective Action",
		"Colonial Identity",
		"Colonist Anger",
		"Political Mobilization",
		"Resolute Demands",
		"Tax Burden",
		"Unified Assemblies",
	)
	actualVars := causalMap.Variables()
	assert.Equal(t, expectedVars, actualVars)

	loops := causalMap.Loops()

	// canonicalized
	assert.Contains(t, loops, []string{"anti-british_sentiment", "collective_action", "colonial_identity", "anti-british_sentiment"})
	assert.Contains(t, loops, []string{"anti-british_sentiment", "political_mobilization", "unified_assemblies", "resolute_demands", "anti-british_sentiment"})
	assert.Contains(t, loops, []string{"british_repressive_policies", "tax_burden", "colonist_anger", "collective_action", "british_repressive_policies"})
	assert.Equal(t, 3, len(loops))
}

func TestDiagrammerSVG(t *testing.T) {
	if _, err := exec.LookPath("dot"); err != nil {
		t.Skip("Skipping test because graphviz is not installed.")
	}

	var causalMap Map
	err := json.Unmarshal([]byte(roadRage1), &causalMap)
	require.NoError(t, err)

	loops := causalMap.Loops()
	assert.NotEmpty(t, loops)

	svg, err := causalMap.VisualSVG()
	require.NoError(t, err)

	// assert we got something
	assert.Greater(t, len(svg), 0)

	// f, err := os.CreateTemp("", "cld-*.svg")
	// require.NoError(t, err)

	// n, err := f.Write(svg)
	// require.NoError(t, err)
	// require.Equal(t, len(svg), n)

	// path := f.Name()
	// require.NoError(t, f.Close())

	// err = exec.Command("open", path).Run()
	// require.NoError(t, err)
}
