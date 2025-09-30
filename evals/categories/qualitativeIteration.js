/**
 * Returns the description for this category
 * @returns {string} The description describing this category
 */
export const description = () => {
    return `The qualitative causal iteration test evaluates an LLM's ability to add new causal relationships
to existing causal models with gibberish variables by identifying underlying causal connections without
specific numerical values, focusing on directional relationships and their polarities.`;
}

import pluralize from 'pluralize';
import utils from '../../utilities/utils.js';

//generic prompt and problem statement used for all tests
const prompt = "Please add the following to my model...";
const problemStatement = "I'm trying to do causal discovery, and extract every cause and effect relationship from the information I give you.";


const generateCausalRelationship = function(fromRaw, toRaw, polarity, polarityStart) {
    if (["+", "-"].indexOf(polarity) < 0)
        throw new Error("Invalid polarity must be + or - you supplied " + polarity);

    if (["up", "down"].indexOf(polarityStart) < 0)
        throw new Error("Invalid polarityStart must be up or down you supplied " + polarityStart);

    const from = pluralize(fromRaw);
    const to = pluralize(toRaw);

    // Natural language variations for describing causal relationships
    const positiveTemplates = {
        up: [
            `As ${from} increase, ${to} tend to increase as well`,
            `Higher levels of ${from} lead to more ${to}`,
            `When there are more ${from}, we typically see more ${to}`,
            `Increasing ${from} results in greater numbers of ${to}`,
            `${from} growth drives up ${to}`,
            `More ${from} contribute to higher ${to}`
        ],
        down: [
            `When ${from} decrease, ${to} also tend to decrease`,
            `Fewer ${from} result in fewer ${to}`,
            `As ${from} decline, ${to} follow suit`,
            `Reduced ${from} lead to diminished ${to}`,
            `Lower levels of ${from} correlate with fewer ${to}`,
            `Declining ${from} cause ${to} to drop as well`
        ]
    };

    const negativeTemplates = {
        up: [
            `As ${from} increase, ${to} tend to decrease`,
            `More ${from} lead to fewer ${to}`,
            `Higher levels of ${from} reduce the number of ${to}`,
            `Increasing ${from} suppresses ${to}`,
            `When ${from} grow, ${to} decline`,
            `Greater ${from} result in diminished ${to}`
        ],
        down: [
            `When ${from} decrease, ${to} actually increase`,
            `Fewer ${from} lead to more ${to}`,
            `As ${from} decline, ${to} tend to rise`,
            `Reduced ${from} result in higher ${to}`,
            `Lower levels of ${from} boost ${to}`,
            `Declining ${from} cause ${to} to grow`
        ]
    };

    const templates = polarity === "+" ? positiveTemplates : negativeTemplates;
    const templateArray = templates[polarityStart];
    const selectedTemplate = templateArray[Math.floor(Math.random() * templateArray.length)];

    return {
        english: selectedTemplate + ".",
        relationship: {from: from, to: to, polarity: polarity}
    };
};

const generateTest = function(name, relationships, currentModel) {
    const contexts = [
        "In my business system", "At this facility", "In our organization", "During these operations",
        "At the warehouse complex", "In this process", "Throughout our network"
    ];

    const connectors = [
        "Additionally", "Furthermore", "At the same time", "Meanwhile", "This creates a situation where",
        "As a result", "Consequently", "In turn", "Building on this", "Subsequently"
    ];

    let english = contexts[Math.floor(Math.random() * contexts.length)] + ", ";

    relationships.forEach((rel, index) => {
        const polarityStart = Math.random() > 0.5 ? "up" : "down";
        const causalRel = generateCausalRelationship(rel.from, rel.to, rel.polarity, polarityStart);

        if (index > 0) {
            const connector = connectors[Math.floor(Math.random() * connectors.length)];
            english += " " + connector + ", " + causalRel.english.toLowerCase();
        } else {
            english += causalRel.english.toLowerCase();
        }
    });

    return {
        name: name,
        prompt: prompt + "\n" + english.trim(),
        currentModel: currentModel,
        additionalParameters: {
            problemStatement: problemStatement
        },
        expectations: {
            relationships: relationships,
            currentModel: currentModel
        }
    };
};

const compareNames = function(aiName, groundTruthName) {
    return aiName.toLowerCase().includes(groundTruthName.toLowerCase());
};

export const evaluate = function(generatedResponse, groundTruth) {
    const generatedModel = generatedResponse?.model || {};
    const groundTruthRelationships = groundTruth.relationships;
    const currentModelRelationships = groundTruth.currentModel ? (groundTruth.currentModel.relationships || []) : [];

    const fromAI = generatedModel.relationships || [];
    const failures = [];

    const stringifyRelationship = function(r) {
        return r.from + " --> (" + r.polarity + ") " + r.to;
    };

    const comparator = function(a, b) {
        if ( a.textRepresentation < b.textRepresentation ){
            return -1;
        }
        if ( a.textRepresentation > b.textRepresentation ){
            return 1;
        }
        return 0;
    };

    const relationshipEqualityGTComparatorGenerator = function(groundTruth) {
        return (ai) => {
            return (compareNames(ai.from, groundTruth.from) && compareNames(ai.to, groundTruth.to));
        };
    };

    const relationshipEqualityAIComparatorGenerator = function(ai) {
        return (groundTruth) => {
            return (compareNames(ai.from, groundTruth.from) && compareNames(ai.to, groundTruth.to));
        };
    };

    // Clean and sort AI relationships
    const cleanedSortedAI = fromAI.map((r)=> {
        delete r.reasoning;
        delete r.polarityReasoning;
        r.textRepresentation = stringifyRelationship(r);
        return r;
    }).sort(comparator);

    // Prepare ground truth relationships
    const sortedGroundTruth = groundTruthRelationships.map((r)=> {
        r.textRepresentation = stringifyRelationship(r);
        return r;
    }).sort(comparator);

    // Prepare current model relationships for comparison
    const sortedCurrentModel = currentModelRelationships.map((r)=> {
        r.textRepresentation = stringifyRelationship(r);
        return r;
    }).sort(comparator);

    // Check that all ground truth relationships are found
    const removed = sortedGroundTruth.filter((element) => {
        return !cleanedSortedAI.some(relationshipEqualityGTComparatorGenerator(element))
    });

    // Check for fake relationships (excluding legitimate pre-existing ones)
    const added = cleanedSortedAI.filter((element) => {
        const isNotInGroundTruth = !sortedGroundTruth.some(relationshipEqualityAIComparatorGenerator(element));
        const isNotInCurrentModel = !sortedCurrentModel.some(relationshipEqualityAIComparatorGenerator(element));
        return isNotInGroundTruth && isNotInCurrentModel;
    });

    // Check that pre-existing relationships are preserved
    const missingCurrentModelRels = sortedCurrentModel.filter((element) => {
        return !cleanedSortedAI.some(relationshipEqualityGTComparatorGenerator(element));
    });

    const addedStr = added.map((r)=>{return r.textRepresentation}).join(", ");
    const removedStr = removed.map((r)=>{return r.textRepresentation}).join(", ");
    const groundTruthStr = sortedGroundTruth.map((r)=>{return r.textRepresentation}).join(", ");
    const missingCurrentModelStr = missingCurrentModelRels.map((r)=>{return r.textRepresentation}).join(", ");

    // Check that pre-existing model structure is preserved
    if (missingCurrentModelRels.length > 0) {
        failures.push({
            type: "Pre-existing relationships missing",
            details: "Pre-existing relationships missing. The following relationships from the current model are not present: " + missingCurrentModelStr
        });
    }

    if (added.length > 0) {
        failures.push({
            type: "Fake relationships found",
            details: "Fake relationships found\n" + addedStr + "\nGround Truth\n" + groundTruthStr
        });
    }

    if (removed.length > 0) {
        failures.push({
            type: "Real relationships not found",
            details: "Real relationships not found\n" + removedStr + "\nGround Truth\n" + groundTruthStr
        });
    }

    // Check polarities of correctly identified relationships
    for (const groundTruthRelationship of sortedGroundTruth) {
        let aiRelationship = cleanedSortedAI.find(relationshipEqualityGTComparatorGenerator(groundTruthRelationship));
        if (aiRelationship && aiRelationship.polarity !== groundTruthRelationship.polarity) {
            failures.push({
                type: "Incorrect polarity discovered",
                details: "Incorrect polarity discovered. Expected " + aiRelationship.polarity + " to be " + groundTruthRelationship.polarity
            });
        }
    }

    return failures;
};

export const groups = {
    "addToSimpleLoop": [
        generateTest("Complete a balancing loop", [
            { from: "frimbulator", to: "proptimatire", polarity: "+" }
        ], {
            relationships: [
                { from: "proptimatire", to: "priary", polarity: "+" },
                { from: "priary", to: "proptimatire", polarity: "-" }
            ]
        }),
        generateTest("Complete a reinforcing loop", [
            { from: "whatajig", to: "priary", polarity: "-" }
        ], {
            relationships: [
                { from: "proptimatire", to: "priary", polarity: "+" },
                { from: "priary", to: "proptimatire", polarity: "+" }
            ]
        })
    ],
    "addToMediumNetwork": [
        generateTest("Create overlapping loops in network", [
            { from: "yoffa", to: "maxabizer", polarity: "+" },
            { from: "maxabizer", to: "marticatene", polarity: "+" },
            { from: "marticatene", to: "buwheal", polarity: "-" }
        ], {
            relationships: [
                { from: "yoffa", to: "buwheal", polarity: "+" },
                { from: "buwheal", to: "geyflorrin", polarity: "-" },
                { from: "geyflorrin", to: "ih", polarity: "+" },
                { from: "ih", to: "yoffa", polarity: "-" },
                { from: "aferraron", to: "paffling", polarity: "+" }
            ]
        }),
        generateTest("Add reinforcing loop to existing structure", [
            { from: "paffling", to: "poval", polarity: "+" },
            { from: "poval", to: "auspong", polarity: "+" },
            { from: "auspong", to: "paffling", polarity: "+" }
        ], {
            relationships: [
                { from: "paffling", to: "pershipfulty", polarity: "+" },
                { from: "pershipfulty", to: "copyring", polarity: "-" },
                { from: "copyring", to: "dickstonyx", polarity: "+" },
                { from: "dickstonyx", to: "bellignorance", polarity: "-" },
                { from: "bellignorance", to: "paffling", polarity: "+" }
            ]
        })
    ],
    "addToComplexNetwork": [
        generateTest("Add balancing loop to complex network", [
            { from: "hashtockle", to: "pablanksill", polarity: "+" },
            { from: "pablanksill", to: "posistorather", polarity: "+" },
            { from: "posistorather", to: "hashtockle", polarity: "-" }
        ], {
            relationships: [
                { from: "hashtockle", to: "succupserva", polarity: "-" },
                { from: "succupserva", to: "relity", polarity: "+" },
                { from: "relity", to: "hazmick", polarity: "+" },
                { from: "hazmick", to: "ku", polarity: "-" },
                { from: "ku", to: "obvia", polarity: "+" },
                { from: "obvia", to: "hashtockle", polarity: "-" },
                { from: "unliescatice", to: "gissorm", polarity: "+" },
                { from: "gissorm", to: "phildiscals", polarity: "-" }
            ]
        }),
        generateTest("Integrate multiple new connections", [
            { from: "loopnova", to: "exeminte", polarity: "+" },
            { from: "exeminte", to: "oc", polarity: "-" },
            { from: "oc", to: "hoza", polarity: "+" },
            { from: "hoza", to: "loopnova", polarity: "-" }
        ], {
            relationships: [
                { from: "loopnova", to: "hoza", polarity: "+" },
                { from: "hoza", to: "arinterpord", polarity: "-" },
                { from: "arinterpord", to: "burgination", polarity: "+" },
                { from: "burgination", to: "perstablintome", polarity: "-" },
                { from: "perstablintome", to: "memostorer", polarity: "+" },
                { from: "memostorer", to: "baxtoy", polarity: "-" },
                { from: "baxtoy", to: "hensologic", polarity: "+" },
                { from: "hensologic", to: "loopnova", polarity: "-" },
                { from: "estintant", to: "perfecton", polarity: "+" },
                { from: "perfecton", to: "raez", polarity: "-" }
            ]
        })
    ],
    "addComplexToComplexNetwork": [
        generateTest("Double complex network with new subsystem", [
            { from: "funkado", to: "maxabizer", polarity: "+" },
            { from: "maxabizer", to: "houtal", polarity: "-" },
            { from: "houtal", to: "reveforly", polarity: "+" },
            { from: "reveforly", to: "funkado", polarity: "-" },
            { from: "frimbulator", to: "reveforly", polarity: "+" },
            { from: "maxabizer", to: "whatajig", polarity: "-" },
            { from: "houtal", to: "balack", polarity: "+" },
            { from: "whoziewhat", to: "funkado", polarity: "-" }
        ], {
            relationships: [
                { from: "frimbulator", to: "whatajig", polarity: "+" },
                { from: "whatajig", to: "balack", polarity: "-" },
                { from: "balack", to: "whoziewhat", polarity: "+" },
                { from: "whoziewhat", to: "frimbulator", polarity: "-" },
                { from: "funkado", to: "maxabizer", polarity: "+" },
                { from: "maxabizer", to: "marticatene", polarity: "-" },
                { from: "marticatene", to: "reflupper", polarity: "+" },
                { from: "reflupper", to: "funkado", polarity: "-" }
            ]
        }),
        generateTest("Integrate two complex subsystems", [
            { from: "outrance", to: "illigent", polarity: "+" },
            { from: "illigent", to: "yelb", polarity: "-" },
            { from: "yelb", to: "traze", polarity: "+" },
            { from: "traze", to: "yoffa", polarity: "-" },
            { from: "yoffa", to: "buwheal", polarity: "+" },
            { from: "buwheal", to: "geyflorrin", polarity: "-" },
            { from: "geyflorrin", to: "outrance", polarity: "+" },
            { from: "dominitoxing", to: "traze", polarity: "+" },
            { from: "yelb", to: "ih", polarity: "-" },
            { from: "yoffa", to: "aferraron", polarity: "+" }
        ], {
            relationships: [
                { from: "dominitoxing", to: "outrance", polarity: "-" },
                { from: "outrance", to: "illigent", polarity: "+" },
                { from: "illigent", to: "yelb", polarity: "-" },
                { from: "yelb", to: "dominitoxing", polarity: "+" },
                { from: "ih", to: "aferraron", polarity: "+" },
                { from: "aferraron", to: "paffling", polarity: "-" },
                { from: "paffling", to: "pershipfulty", polarity: "+" },
                { from: "pershipfulty", to: "copyring", polarity: "-" },
                { from: "copyring", to: "dickstonyx", polarity: "+" },
                { from: "dickstonyx", to: "ih", polarity: "-" }
            ]
        })
    ]
};