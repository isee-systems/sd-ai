import { response } from 'express';
import AdvancedEngine from './../engines/advanced/engine.js'
import 'dotenv/config'

jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

//generic prompt problem statement and and background knowledge used for all tests
const prompt = "Using your knowledge of how the american revolution started and the additional information I have given you, please give me a feedback based explanation for how the american revolution came about.";
const problemStatement = "I am trying to understand how the american revolution started.  I'd like to know what caused hostilities to break out.";
const backgroundKnowledge =
`
The American Revolution was caused by a number of factors, including:
Taxation
The British imposed new taxes on the colonies to raise money, such as the Stamp Act of 1765, which taxed legal documents, newspapers, and playing cards. The colonists were angry because they had no representatives in Parliament. 
The Boston Massacre
In 1770, British soldiers fired on a crowd of colonists in Boston, killing five people. The massacre intensified anti-British sentiment and became a propaganda tool for the colonists. 
The Boston Tea Party
The Boston Tea Party was a major act of defiance against British rule. It showed that Americans would not tolerate tyranny and taxation. 
The Intolerable Acts
The British government passed harsh laws that the colonists called the Intolerable Acts. One of the acts closed the port of Boston until the colonists paid for the tea they had ruined. 
The French and Indian War
The British wanted the colonies to repay them for their defense during the French and Indian War (1754–63). 
Colonial identity
The colonists developed a stronger sense of American identity
`;

const extractVariables = function(relationshipList) {
    let set = new Set();
    for (const relationship of relationshipList) {
        set.add(relationship.from);
        set.add(relationship.to);
    }
    return set;
};

const countLoops = function(relationshipList) {
    return NaN; //TODO implement me
};

const compareRelationshipLists = function(fromAI, requirements) {
    const fromAIVariables = extractVariables(fromAI);
    const fromAIFeedbackLoops = countLoops(fromAI);

    if ("variables" in requirements) {    
        for (const requiredVar of requirements.variables)
            expect(fromAIVariables).toContain(requiredVar);
    }

    if ("minVariables" in requirements) {
        expect(fromAIVariables.size).withContext("Variables are: " + Array.from(fromAIVariables).join(', ')).toBeGreaterThanOrEqual(requirements.minVariables);
    }

    if ("maxVariables" in requirements) {
        expect(fromAIVariables.size).withContext("Variables are: " + Array.from(fromAIVariables).join(', ')).toBeLessThanOrEqual(requirements.maxVariables);
    }
    
    if ("minFeedback" in requirements) {
        expect(fromAIFeedbackLoops).toBeGreaterThanOrEqual(requirements.minFeedback);
    }

    if ("maxFeedback" in requirements) {
        expect(fromAIFeedbackLoops).toBeLessThanOrEqual(requirements.maxFeedback);
    }
};

//elements by which we measure conformance.  these are specific instructions to append to the prompt
const conformanceElements = [
    {
        text: 'Your response must include the variables "Taxation", "Anti-British Sentiment" and "Colonial Identity".',
        description: "include requested variables",
        response: { 
            variables: [
                "Taxation",
                "Anti-British Sentiment",
                "Colonial Identity"
            ]
        }
    }, {
        text: 'Your response must include at least 10 variables',
        description: "include a minimum number of variables",
        response: {
            minVariables: 10
        }
    }, {
        text: 'Your response must include no more then 5 variables',
        description: "include a maximum number of variables",
        response: {
            maxVariables: 5
        }
    }, {
        text: 'Your response must include at least 8 feedback loops',
        description: "include a minimum number of feedback loops",
        response: {
            minFeedback: 8
        }
    }, {
        text: 'Your response must include no more then 4 feedback loops',
        description: "include a maximum number of feedback loops",
        response: {
            maxFeedback: 4
        }
    }, {
        text: 'Your response must include no more then 4 feedback loops and no more then 5 variables',
        description: "include a maximum number of feedback loops and a maximum number of variables",
        response: {
            maxFeedback: 4,
            maxVariables: 5
        }
    }, {
        text: 'Your response must include at least 6 feedback loops and at least 8 variables',
        description: "include a minimum number of feedback loops and a minimum number of variables",
        response: {
            minFeedback: 6,
            minVariables: 8
        }
    }, {
        text: 'Your response must include no more then 4 feedback loops and at least 5 variables',
        description: "include a maximum number of feedback loops and a minimum number of variables",
        response: {
            maxFeedback: 4,
            minVariables: 5
        }
    }, {
        text: 'Your response must include at least 6 feedback loops and no more then 15 variables',
        description: "include a min number of feedback loops and a maximum number of variables",
        response: {
            minFeedback: 6,
            maxVariables: 15
        }
    }
]

const generateConformanceTest = function(conformanceElement) {
    return {
        prompt: prompt + conformanceElement.text,
        problemStatement: problemStatement,
        backgroundKnowledge: backgroundKnowledge,
        description: conformanceElement.description,
        responseCheck: conformanceElement.response
    };
};

const conformanceTests = conformanceElements.map(generateConformanceTest);

const llmsToTest = ['gpt-4o', 'gpt-4o-mini', 'gemini-2.0-flash', 'gemini-2.0-flash-lite-preview-02-05', 'gemini-1.5-flash'];

//For quick tests
llmsToTest.splice(1);

for (const llm of llmsToTest) {
    describe(llm + ": a causal reasoning engine", function() {
        for (const test of conformanceTests) {
            //TODO: We don't support feedback right now, remove this one countLoops is implemented
            if ("minFeedback" in test.responseCheck || "maxFeedback" in test.responseCheck) {
                continue;
            }
            it("can conform to the instruction: " + test.description, async() => {
                const engine = new AdvancedEngine();
                const response = await engine.generate(test.prompt, {}, {underlyingModel: llm, problemStatement: test.problemStatement, backgroundKnowledge: test.backgroundKnowledge});
                compareRelationshipLists(response.model.relationships, test.responseCheck);
            })
        }
    });
}