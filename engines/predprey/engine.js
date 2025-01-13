class Engine {
    constructor() {

    }
    
    additionalParameters () {
        return []
    } 

    async generate(prompt, currentModel, parameters) {
        return {
            success: true,
            model: {
                supportingInfo: {},
                variables: [
                    {
                        name: "predator",
                        type: "variable"
                    },
                    {
                        name: "prey",
                        type: "variable"
                    }
                ],
                relationships: [
                    {
                        start: "predator",
                        end: "prey",
                        polarity: "-",
                        reasoning: "As the number of predators increases the number of prey decreases because they get eaten.",
                        polarityReasoning: "The polarity is - because as predators goes up prey goes down",
                        relevantText: "There is no relevant text, this is a dummy engine"
                    },
                    {
                        start: "prey",
                        end: "predator",
                        polarity: "+",
                        reasoning: "As the number of prey increases the number of predators increase because they have more food.",
                        polarityReasoning: "The polarity is + because as prey goes up predators goes up",
                        relevantText: "There is no relevant text, this is a dummy engine"
                    }
                ]
            }
        }
    }
}

export default Engine;