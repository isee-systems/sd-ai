class Engine {
    constructor() {

    }
    
    additionalParameters () {
        return []
    } 

    async generate(prompt, currentModel, session, parameters) {
        return {
            success: true,
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
                    polarity: "-"
                },
                {
                    start: "prey",
                    end: "predator",
                    polarity: "+"
                }
            ]
        }
    }
}

export default Engine;