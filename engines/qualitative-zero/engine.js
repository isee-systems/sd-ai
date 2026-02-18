import { LLMWrapper } from '../../utilities/LLMWrapper.js';
import Engine from './../qualitative/engine.js'

class QualitativeZero extends Engine {

    constructor() {
        super();
    }

    static description() {
        return `This engine is for benchmarking purposes. This uses the structured output mechanism of the Qualitative engine, but with no other prompting.  This engine is supposed to represent the "out of the box" bare-minimum performance of LLMs.`; 
    }
    static link() {
        return null
    }

    static supportedModes() {
        return ["cld"];
    }

    additionalParameters()  {
        let parameters = LLMWrapper.additionalParameters(LLMWrapper.BUILD_DEFAULT_MODEL);

        return parameters.concat([{
                name: "problemStatement",
                type: "string",
                required: false,
                uiElement: "textarea",
                saveForUser: "local",
                label: "Problem Statement",
                description: "Description of a dynamic issue within the system you are studying that highlights an undesirable behavior over time.",
                minHeight: 50,
                maxHeight: 100
            },{
                name: "backgroundKnowledge",
                type: "string",
                required: false,
                uiElement: "textarea",
                saveForUser: "local",
                label: "Background Knowledge",
                description: "Background information you want the underlying model to consider when generating a diagram for you",
                minHeight: 100
            }
        ]);
    }

    manipulateParameters(parameters) {
        parameters.descriptionlessStructuredOutput = true;
        parameters.feedbackPrompt = "";
        parameters.systemPrompt = "You are a System Dynamics Professional Modeler. Users will give you text, and it is your job to generate causal relationships from that text.";
        return parameters;
    }
}

export default QualitativeZero;