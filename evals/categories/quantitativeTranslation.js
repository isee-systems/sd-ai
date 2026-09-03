/**
 * Returns the description for this category
 * @returns {string} The description describing this category
 */
export const description = () => {
    return `The quantitative causal translation test evaluates an LLM’s ability to convert quantitative stock-and-flow 
model descriptions with gibberish variables into simulating models by identifying underlying causal relationships 
involving fixed, proportional, and interdependent flows.`;
} 

import pluralize from 'pluralize';
import numberToWords from 'number-to-words';
import utils from '../../utilities/utils.js';
import { namesMatch } from '../utilities/nameMatching.js';
import { validateEvaluationResult } from '../evaluationSchema.js';

//generic prompt and problem statement used for all tests
const prompt = "Please give me a model which includes all causal relationships in the background information.";
const problemStatement = "I'm trying to do causal discovery, and extract every cause and effect relationship from the information I give you.";

//random variable names to pick from
const nouns = utils.evalsGibberishNouns;

const generateTest = function(name, timeUnit, stocks) {
    // Generate more natural, story-like descriptions
    const contexts = [
        "In my business", "At the facility", "In our organization", "During operations", 
        "At the warehouse", "In the system", "Throughout the process"
    ];
    
    const initialDescriptions = [
        "we begin with", "there are initially", "we start the period with", 
        "the baseline inventory shows", "our records indicate", "we have on hand"
    ];
    
    const inflowDescriptions = [
        "gets replenished by", "receives new additions of", "grows through incoming",
        "benefits from", "increases due to", "gains from", "is enhanced by"
    ];
    
    const outflowDescriptions = [
        "experiences losses of", "has outgoing", "loses", "decreases by",
        "is reduced through", "suffers depletion of", "gets diminished by"
    ];

    let english = contexts[Math.floor(Math.random() * contexts.length)] + ", ";
    
    stocks.forEach((stock, index) => {
        if (index > 0) english += " Meanwhile, ";
        
        const initialDesc = initialDescriptions[Math.floor(Math.random() * initialDescriptions.length)];
        let stockEnglish = initialDesc + " " + numberToWords.toWords(stock.initialValue) + " " + pluralize(stock.name) + ". ";

        if (stock.inflows) {
            stock.inflows.forEach((f)=> {
                const inflowDesc = inflowDescriptions[Math.floor(Math.random() * inflowDescriptions.length)];
                let flowEnglish = "Every " + timeUnit + ", this inventory " + inflowDesc + " ";
                
                if ("fixed" in f) {
                    flowEnglish += "exactly " + numberToWords.toWords(f.fixed) + " new " + pluralize(stock.name);
                } else {
                    const percentage = (f.rate * 100);
                    if (f.of !== stock.name) {
                        flowEnglish += `${percentage}% of the current ${pluralize(f.of)} count`;
                    } else {
                        flowEnglish += `${percentage}% growth relative to its current size`;
                    }
                }
                flowEnglish += ". ";
                stockEnglish += flowEnglish;
            });
        }

        if (stock.outflows) {
            stock.outflows.forEach((f)=> {
                const outflowDesc = outflowDescriptions[Math.floor(Math.random() * outflowDescriptions.length)];
                let flowEnglish = "Simultaneously, each " + timeUnit + " the stock " + outflowDesc + " ";
                
                if ("fixed" in f) {
                    flowEnglish += "a constant " + numberToWords.toWords(f.fixed) + " " + pluralize(stock.name);
                } else {
                    const percentage = (f.rate * 100);
                    if (f.of !== stock.name) {
                        flowEnglish += `${percentage}% of whatever ${pluralize(f.of)} are currently available`;
                    } else {
                        flowEnglish += `${percentage}% of its current amount`;
                    }
                }
                flowEnglish += ". ";
                stockEnglish += flowEnglish;
            });
        }

        english += stockEnglish;
    });

    return {
        name: name,
        prompt: prompt,
        additionalParameters: {
            problemStatement: problemStatement,
            backgroundKnowledge: english.trim(),
        },
        expectations: {
            timeUnit: timeUnit,
            stocks: stocks
        }
    };
};

const extractStocks = function(generatedModel) {
    return (generatedModel.variables || []).filter((variable) => {
        return variable.type === 'stock';
    });
};

const extractFlow = function(flowSpec, possibleNames,  generatedModel) {
    return (generatedModel.variables || []).find((variable) => {
        if (variable.type !== 'flow')
            return false;

        let foundName = false;
        for (const possibleName of possibleNames) {
            if (utils.sameVars(possibleName, variable.name)) {
                foundName = true;
                break;
            }
        }

        if (!foundName)
            return false;
        
        //if we are looking for a rate... 
        if (flowSpec.rate) {
            // Check that the equation has multiplication AND contains the rate value
            const hasMultiplication = variable.equation.includes("*");
            const rateString = flowSpec.rate.toString();
            const hasRate = variable.equation.includes(rateString);
            
            if (hasMultiplication && hasRate) {
                return true;
            }
            
            // If variable has multiplication but not the rate directly,
            // check if any of the causes have an equation equal to the rate
            if (hasMultiplication && !hasRate) {
                //filter all of the relationships to find the relationships where the to is the current variable
                const causeVariableNames = (generatedModel.relationships || []).filter(r =>
                    utils.sameVars(r.to, variable.name)
                ).map(r => r.from); //map those relationships into an array of from variable names (these are the causes)
                
                //take the cause variable names and turn them into full causeVariables
                const causeVariables = causeVariableNames.map(name => {
                    return (generatedModel.variables || []).find(v => utils.sameVars(v.name, name));
                }).filter(v => v !== undefined); // Filter out any undefined variables
                
                //check that one of the cause variables has an equation which is the rate
                return causeVariables.some(cause => cause && parseFloat(cause.equation) === flowSpec.rate);
            }
            
            return false;
        } else { //then its fixed!
            
            if (parseFloat(variable.equation) === flowSpec.fixed)
                return true;

            //if the variable doesn't have the fixed number in its equation
            // Check if the equation references a variable with the correct value
            const referencedVariable = (generatedModel.variables || []).find((v) =>
                utils.sameVars(v.name, variable.equation)
            );

            if (referencedVariable && parseFloat(referencedVariable.equation) === flowSpec.fixed) {
                return true;
            } 

            return false;
        }
    })
};

export const evaluate = function(generatedResponse, groundTruth) {
    const generatedModel = generatedResponse?.model || {};
    const groundTruthStocks = groundTruth.stocks;

    const comparator = function(a, b) {
        if ( a.name < b.name ){
            return -1;
        }
        if ( a.name > b.name ){
            return 1;
        }
        return 0;
    };

    //the english fed to the LLM pluralizes every variable name while the ground truth is singular,
    //so generated names come back in whichever form the LLM settled on and namesMatch has to see
    //past the difference. it can't be done by pluralizing the ground truth, since pluralize()
    //can't round trip every one of the gibberish nouns
    const stockNameMatches = function(a, b) {
        return namesMatch(a.name, b.name);
    };

    const failures = []; //type, details
    const stocks = extractStocks(generatedModel); //get all the stocks

    const sortedAIStocks = [...stocks].sort(comparator); //sort for comparison purposes by name
    const sortedTruthStocks = [...groundTruthStocks].sort(comparator);

    const removed = sortedTruthStocks.filter((element) => { return !sortedAIStocks.some((aiStock) => stockNameMatches(aiStock, element))});
    const added = sortedAIStocks.filter((element) => { return !sortedTruthStocks.some((gtStock) => stockNameMatches(element, gtStock))});

    const addedStr = added.map((stock) => { return stock.name }).join(", ");
    const removedStr = removed.map((stock) => { return stock.name }).join(", ");
    const groundTruthStr = sortedTruthStocks.map((stock) => { return stock.name }).join(", ");

    if (!generatedModel.specs?.timeUnits || !namesMatch(generatedModel.specs.timeUnits, groundTruth.timeUnit)) {
        failures.push({
            type: "Incorrect time unit discovered",
            details: "Incorrect time unit discovered. Expected " + (generatedModel.specs?.timeUnits || "undefined") + " to be " + groundTruth.timeUnit
        });
    }

    if (added.length > 0) {
        failures.push({
            type: "Fake stock found",
            details: "Fake stock found\n" + addedStr + "\nGround Truth Stocks Are\n" + groundTruthStr
        });
    }
    
    if (removed.length > 0) {
        failures.push({
            type: "Real stocks not found",
            details: "Real stocks not found\n" + removedStr + "\nGround Truth Stocks Are\n" + groundTruthStr
        });
    }

    for (const groundTruthStock of sortedTruthStocks) {
        let aiStock = sortedAIStocks.find((aiStock) => stockNameMatches(aiStock, groundTruthStock));
        if (!aiStock)
            continue; //some error in the test itself

        if (parseFloat(aiStock.equation) !== groundTruthStock.initialValue) {
            // Check if the equation references a variable with the correct value
            const referencedVariable = (generatedModel.variables || []).find((v) =>
                utils.sameVars(v.name, aiStock.equation)
            );

            if (!referencedVariable || parseFloat(referencedVariable.equation) !== groundTruthStock.initialValue) {
                failures.push({
                    type: "Incorrect initial value discovered",
                    details: "Incorrect initial value discovered. Expected " + aiStock.equation + " to be " + groundTruthStock.initialValue.toString()
                });
            }
        }

        if (groundTruthStock.inflows) {
            if (!aiStock.inflows || aiStock.inflows.length != groundTruthStock.inflows.length) {
                failures.push({
                    type: "Incorrect number of inflows discovered",
                    details: "Incorrect number of inflows discovered. Expected " + (aiStock.inflows?.length || 0) + " to be " + groundTruthStock.inflows.length
                });
            } else {
                groundTruthStock.inflows.forEach((f) => {
                    const foundFlow = extractFlow(f, aiStock.inflows, generatedModel);
                    if (!foundFlow) {
                        failures.push({
                            type: "Failed to find flow matching specification",
                            details: "Failed to find flow matching specification. Expected to find a flow with specification " + JSON.stringify(f)
                        });
                    }
                });
            }
        }

        if (groundTruthStock.outflows) {
            if (!aiStock.outflows || aiStock.outflows.length != groundTruthStock.outflows.length) {
                failures.push({
                    type: "Incorrect number of outflows discovered",
                    details: "Incorrect number of outflows discovered. Expected " + (aiStock.outflows?.length || 0) + " to be " + groundTruthStock.outflows.length
                });
            } else {
                groundTruthStock.outflows.forEach((f) => {
                    const foundFlow = extractFlow(f, aiStock.outflows, generatedModel);
                    if (!foundFlow) {
                        failures.push({
                            type: "Failed to find flow matching specification",
                            details: "Failed to find flow matching specification. Expected to find a flow with specification " + JSON.stringify(f)
                        });
                    }
                });
            }
        }
    }

    return validateEvaluationResult(failures);
};

/**
 * Returns the methodology for this category: how its tests are built and run, what the evaluator
 * checks, and how those checks combine into a verdict. Each `criteria[].name` is the exact failure
 * `type` {@link evaluate} records when that criterion is not met. Rendered by the documentation
 * site on every test page.
 * @returns {{howItWorks: Array<string>, criteria: Array<{name: string, description: string}>, scoring: string}}
 */
export const methodology = () => ({
    howItWorks: [
        `This is causal translation with numbers attached: the engine must recover a simulating stock-and-flow structure from a written description. As in the qualitative version, variable names are gibberish nouns, so nothing can be answered from world knowledge — every stock, rate and initial value has to come from the text. The English description and the ground-truth structure are generated together from one specification, so they cannot disagree.`,
        `Each specification names a time unit and a set of stocks, each with an initial value and its inflows and outflows. A flow is either fixed — a constant amount per time unit — or proportional, a percentage either of the stock it feeds or of another stock in the system, which is what creates interdependence between stocks and, when two stocks draw on each other, feedback. The prose renders all of this in ordinary business language ("we begin with sixty frimbulators… every day, this inventory gets replenished by 20% of the current whatajigs count"), with the phrasing drawn at random and numbers spelled out as words, so the numeral cannot simply be copied.`,
        `The five groups scale the structure from a single stock up to five interacting stocks, including linear chains, feedback, convergent structures, and mixed fixed and proportional flows.`,
        `Grading reads the returned model's stock variables and compares them to the ground truth as sets, matched on pluralization-tolerant names — the prose pluralizes every noun and the answer may come back in either form. Then, for each matched stock: the initial value must equal the ground truth, either directly as the stock's equation or through a variable the equation references; the number of inflows and the number of outflows must match exactly; and every flow in the specification must be found among the flow variables that stock names.`,
        `Matching a flow means matching its arithmetic, not its name. A proportional flow is satisfied by a flow variable whose equation multiplies and contains the rate — or multiplies and draws on a cause variable whose own equation is that rate, which is how a well-formed model parameterizes it. A fixed flow is satisfied by an equation that is the constant, or that references a variable holding it. Engines are therefore free to name flows and parameters however they like, so long as the arithmetic is right.`,
        `The model's declared time unit must also match the one the description used.`
    ],
    criteria: [
        { name: 'Real stocks not found', description: 'Stocks the description called for are missing from the model. Recorded once, listing them alongside the full ground truth.' },
        { name: 'Fake stock found', description: 'The model contains stocks the description never mentioned. Recorded once, listing them — inventing accumulations is as wrong as omitting them.' },
        { name: 'Incorrect time unit discovered', description: 'The model’s simulation specs name a different time unit than the description used, or none at all.' },
        { name: 'Incorrect initial value discovered', description: 'A stock’s initial value is not the one the description gave, whether written directly or through a variable it references. Recorded once per stock.' },
        { name: 'Incorrect number of inflows discovered', description: 'A stock has more or fewer inflows than the description specified. Recorded once per stock; the flows themselves are only matched when the count agrees.' },
        { name: 'Incorrect number of outflows discovered', description: 'A stock has more or fewer outflows than the description specified. Recorded once per stock.' },
        { name: 'Failed to find flow matching specification', description: 'No flow on the stock has the arithmetic the description called for — the wrong rate or constant, or a rate that is not applied multiplicatively. Recorded once per unmatched flow, quoting the specification that went unmet.' }
    ],
    scoring: `The structure must match the description exactly: the right stocks and no others, the right initial values, the right number of flows on each stock, every flow computing what it should, and the right time unit. Any single failure fails the test. Names of flows and parameters are free, and so is any extra auxiliary structure used to compute the right numbers.`
});

export const groups = {
    "singleStock": [
        generateTest("Extract a single stock with one flow", "day", [
            { 
                name: nouns[0], 
                initialValue: 20,
                inflows: [
                    { rate: 0.02, of: nouns[0] }
                ]
            }
        ]),
        generateTest("Extract a single stock with two flows", "week", [
            { 
                name: nouns[0], 
                initialValue: 100,
                inflows: [
                    { rate: 0.05, of: nouns[0] }
                ], 
                outflows: [
                    { fixed: 5 }
                ]
            }
        ])
    ], 
    "twoStock": [
        generateTest("Extract a two stock system", "year", [
            { 
                name: nouns[1], 
                initialValue: 100,
                inflows: [
                    { rate: 0.05, of: nouns[1] }
                ], 
                outflows: [
                    { rate: 3, of: nouns[2] }
                ]
            }, { 
                name: nouns[2], 
                initialValue: 200,
                inflows: [
                    { rate: 0.05, of: nouns[1] }
                ], 
                outflows: [
                    { rate: 0.03, of: nouns[2] }
                ]
            }
        ])
    ],
    "threeStock": [
        generateTest("Extract a three stock linear chain", "month", [
            { 
                name: nouns[6], 
                initialValue: 50,
                inflows: [
                    { fixed: 10 }
                ], 
                outflows: [
                    { rate: 0.2, of: nouns[6] }
                ]
            }, { 
                name: nouns[7], 
                initialValue: 75,
                inflows: [
                    { rate: 0.2, of: nouns[6] }
                ], 
                outflows: [
                    { fixed: 8 }
                ]
            }, { 
                name: nouns[8], 
                initialValue: 120,
                inflows: [
                    { fixed: 8 }
                ], 
                outflows: [
                    { rate: 0.1, of: nouns[8] }
                ]
            }
        ]),
        generateTest("Extract a three stock feedback system", "day", [
            { 
                name: nouns[13], 
                initialValue: 35,
                inflows: [
                    { rate: 0.3, of: nouns[15] }
                ], 
                outflows: [
                    { rate: 0.2, of: nouns[13] }
                ]
            }, { 
                name: nouns[14], 
                initialValue: 90,
                inflows: [
                    { rate: 0.2, of: nouns[13] }
                ], 
                outflows: [
                    { fixed: 12 }
                ]
            }, { 
                name: nouns[15], 
                initialValue: 45,
                inflows: [
                    { fixed: 12 }
                ], 
                outflows: [
                    { rate: 0.3, of: nouns[15] }
                ]
            }
        ]),
        generateTest("Extract a three stock convergent system", "quarter", [
            { 
                name: nouns[20], 
                initialValue: 110,
                inflows: [
                    { rate: 0.06, of: nouns[20] }
                ], 
                outflows: [
                    { fixed: 18 }
                ]
            }, { 
                name: nouns[21], 
                initialValue: 70,
                inflows: [
                    { fixed: 25 }
                ], 
                outflows: [
                    { rate: 0.35, of: nouns[21] }
                ]
            }, { 
                name: nouns[22], 
                initialValue: 95,
                inflows: [
                    { fixed: 18 },
                    { rate: 0.35, of: nouns[21] }
                ], 
                outflows: [
                    { rate: 0.22, of: nouns[22] }
                ]
            }
        ])
    ],
    "fourStock": [
        generateTest("Extract a four stock system with mixed flows", "week", [
            { 
                name: nouns[9], 
                initialValue: 25,
                inflows: [
                    { rate: 0.15, of: nouns[10] }
                ], 
                outflows: [
                    { fixed: 3 }
                ]
            }, { 
                name: nouns[10], 
                initialValue: 40,
                inflows: [
                    { fixed: 5 }
                ], 
                outflows: [
                    { rate: 0.25, of: nouns[10] }
                ]
            }, { 
                name: nouns[11], 
                initialValue: 80,
                inflows: [
                    { rate: 0.1, of: nouns[10] }
                ], 
                outflows: [
                    { rate: 0.05, of: nouns[12] }
                ]
            }, { 
                name: nouns[12], 
                initialValue: 60,
                inflows: [
                    { fixed: 7 }
                ], 
                outflows: [
                    { rate: 0.08, of: nouns[12] }
                ]
            }
        ]),
        generateTest("Extract a four stock branching system", "hour", [
            { 
                name: nouns[16], 
                initialValue: 150,
                inflows: [
                    { fixed: 20 }
                ], 
                outflows: [
                    { rate: 0.4, of: nouns[16] },
                    { rate: 0.1, of: nouns[16] }
                ]
            }, { 
                name: nouns[17], 
                initialValue: 30,
                inflows: [
                    { rate: 0.4, of: nouns[16] }
                ], 
                outflows: [
                    { fixed: 5 }
                ]
            }, { 
                name: nouns[18], 
                initialValue: 65,
                inflows: [
                    { rate: 0.1, of: nouns[16] }
                ], 
                outflows: [
                    { rate: 0.12, of: nouns[19] }
                ]
            }, { 
                name: nouns[19], 
                initialValue: 85,
                inflows: [
                    { fixed: 15 }
                ], 
                outflows: [
                    { rate: 0.18, of: nouns[19] }
                ]
            }
        ])
    ], 
     "fiveStock": [
        generateTest("Extract a five stock system", "year", [
            { 
                name: nouns[1], 
                initialValue: 100,
                inflows: [
                    { rate: 0.05, of: nouns[1] }
                ], 
                outflows: [
                    { fixed: 3 }
                ]
            }, { 
                name: nouns[2], 
                initialValue: 200,
                inflows: [
                    { rate: 0.05, of: nouns[1] }
                ], 
                outflows: [
                    { rate: 0.03, of: nouns[2] }
                ]
            }, { 
                name: nouns[3], 
                initialValue: 200,
                inflows: [
                    { rate: 0.05, of: nouns[2] }
                ], 
                outflows: [
                    { rate: 0.03, of: nouns[3] }
                ]
            }, { 
                name: nouns[4], 
                initialValue: 12,
                inflows: [
                    { rate: 0.05, of: nouns[3] }
                ], 
                outflows: [
                    { rate: 0.03, of: nouns[5] }
                ]
            }, { 
                name: nouns[5], 
                initialValue: 88,
                inflows: [
                    { rate: 0.05, of: nouns[4] }
                ], 
                outflows: [
                    { rate: 0.03, of: nouns[3] }
                ]
            }
        ])
    ]
};