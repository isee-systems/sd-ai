/**
 * This is the causal translation test
 * 
 * To adequately and objectively measure what we define as causal translation (i.e., turning plain English text into structured data of causal relationships), it is necessary to create “fake alternate universes” in which we specify an objective synthetic ground truth.  By shifting context into a gibberish world, we test the LLM’s ability to extract causal relationships from provided data without relying on contextual clues from its own training data. 
 *
 * For each causal translation test, we need an algorithm to generate the ground truth in English that is fed to the LLM via the background knowledge prompt, and the corresponding graph network (model) that the written English represents from which to compare the output of the LLM. To build these ground truth networks and plain English descriptions, we created an algorithm to construct them starting with a list of 56 gibberish, non-pluralized nouns. We used those nouns (after a uniform pluralization process) as variable names and the basis for creating “causal sentences” that were strung together to form “causal descriptions” of the ground truth system. Causal sentences were built based on a “from” variable, a “to” variable, a polarity, and a polarity direction. The “from” variable is the cause, and the “to” variable is the effect variable. The polarity is either positive or negative, and the polarity direction is either up or down. A polarity direction of “up” means that the polarity in the causal sentence is described starting with an increase in the “from” variable, while “down” means a decrease in the “from” variable. Causal sentences are composed of the “from” variable, the “to” variable, and two adjectives describing the development of the “from” variable and the “to” variable. The form of causal sentences are “The [more|less] [“from” variable] there are, the [more|fewer] [“to” variable] there are.” The “from” and “to” variables in causal sentences are always pluralized. 
 *
 * Our causal translation test suite contains 24 tests organized into three groups. The current test suite is designed to test the most basic form of causal translation (i.e., without the influence of confounders or more complicated potential forms of causal sentences). The first test group we’ve implemented is single relationship extraction, where there are four tests using a single causal sentence with gibberish words as variables.  The full complement of polarity and polarity directions are tested here. The second group of causal translation tests consists of single loop extractions, where we measure the ability of the LLM to extract all of the relationships that compose a single feedback loop generated from causal sentences of gibberish words.  Here we have 14 tests – seven for each loop polarity (positive, negative) – where those seven are feedback loops of variable length two to seven inclusive for each polarity, and we alternate polarity directions for each link in each loop. The third group of tests are multiple loop extractions in which we measure the ability of the LLM to extract all of the relationships that compose a set of overlapping feedback loops of various lengths and polarities, where each feedback loop follows the same properties as the single loop extractions. Here we have two tests that assess the ability of the LLM to extract two overlapping loops of lengths three and six variables, two tests containing three overlapping loops each (containing five, two, and four variables, respectively), and the final two tests of five loops each that overlap each other where the loops contain three, five, six, two and six variables respectively.
 * 
 * @module categories/causalTranslation
 */

import pluralize from 'pluralize';

/**  generic prompt used for all tests */
const prompt = "Please find all causal relationships in the background information.";
/**  generic problem statement used for all tests */
const problemStatement = "I'm trying to do causal discovery, and extract every cause and effect relationship from the information I give you.";

/** random nouns, variable names to pick from */
let nouns = [ "frimbulator",  "whatajig", "balack", "whoziewhat", "funkado", "maxabizer", "marticatene", "reflupper", "exeminte", "oc", "proptimatire", "priary", "houtal", "poval", "auspong", "dominitoxing", "outrance", "illigent", "yelb", "traze", "pablanksill", "posistorather", "crypteral", "oclate", "reveforly", "yoffa", "buwheal", "geyflorrin", "ih", "aferraron", "paffling", "pershipfulty", "copyring", "dickstonyx", "bellignorance", "hashtockle", "succupserva", "relity", "hazmick", "ku", "obvia", "unliescatice", "gissorm", "phildiscals", "loopnova", "hoza", "arinterpord", "burgination", "perstablintome", "memostorer", "baxtoy", "hensologic", "estintant", "perfecton", "raez", "younjuring"];

/**
 * This function builds a causal relationship between two variables (nouns) before pluralization
 * @param {String} fromRaw The non-plural from variable
 * @param {String} toRaw The non-plural to variable
 * @param {String} polarity This must be either + or -, no other values allowed.
 * @param {String} polarityStart This must be either up or down, no other values allowed.
 * @returns {Object} An object with two properites "english" for the english sentence and the relationship {from: <string>, to: <string>, polarity: <string> }
 */
const generateCausalRelationship = function(fromRaw, toRaw, polarity, polarityStart) {
    if (["+", "-"].indexOf(polarity) < 0)
        throw new Error("Invalid polarity must be + or - you supplied " + polarity);

    if (["up", "down"].indexOf(polarityStart) < 0)
        throw new Error("Invalid polarityStart must be up or down you supplied " + polarityStart);

    const from = pluralize(fromRaw);
    const to = pluralize(toRaw);

    let mod1,mod2 = "";
    if (polarity === "+") {
        if (polarityStart === "up") {
            mod1 = "more";
            mod2 = "more";
        } else if (polarityStart === "down") {
            mod1 = "less";
            mod2 = "fewer";
        }
    } else if (polarity === "-") {
        if (polarityStart === "up") {
            mod1 = "more";
            mod2 = "fewer";
        } else if (polarityStart === "down") {
            mod1 = "less";
            mod2 = "more";
        }
    } 

    return { 
        english: "The " + mod1 + " " + from + " there are, the " + mod2 + " " + to + " there are.",
        relationship: {from: from, to: to, polarity: polarity}
    };
};

/**
 * This method generates a feedback loop out of a list of variables with a given polarity
 * @param {Array<String>} variables The non-plural list of variables in order.
 * @param {String} polarity This must be either + or -, no other values allowed.
 * @returns {Object} An object with two properites "english" for the english sentence and the relationships, an array of relationship objects [{from: <string>, to: <string>, polarity: <string> }]
 */
const generateFeedbackLoop = function(variables, polarity) {
    let causalText = '';
    let relationships = [];

    for (let i=0; i < variables.length; ++i) {
        let relationshipPolarity = "+"
        if (i == 0 && polarity === "-") {
            relationshipPolarity = "-"; //if this is balancing always make the first relationship the one negative relationship
        }
        let next = i+1;
        if (next >= variables.length)
            next = 0;
        const resp = generateCausalRelationship(variables[i], variables[next], relationshipPolarity, i % 2 ? "up" : "down");
        relationships.push(resp.relationship);
        causalText += " " + resp.english;
    }
    
    return {
        english: causalText.trim(),
        relationships: relationships
    };
};

/**
 * Generates a test which contains a single relationship
 * @param {String} name A name for this test
 * @param {String} fromRaw The non-plural from variable
 * @param {String} toRaw The non-plural to variable
 * @param {String} polarity This must be either + or -, no other values allowed.
 * @param {String} polarityStart This must be either up or down, no other values allowed.
 * @returns {Object} The test containing all of the parameters for the engine, and the expectations for what the engine should return.
 */
const generateSingleRelationshipTest = function(name, fromRaw, toRaw, polarity, polarityStart) {
  const result = generateCausalRelationship(fromRaw, toRaw, polarity, polarityStart);
  return {
    name: name,
    prompt: prompt,
    additionalParameters: {
      problemStatement: problemStatement,
      backgroundKnowledge: result.english,
      mainTopics: "",  
      depth: 1
    },
    expectations: [result.relationship]
  };
};

/**
 * Generates a test which contains a single feedback loop
 * @param {Number} offset An integer offset into the nouns array to start the feedback loop at 
 * @param {Number} numVars An integer for the number of variables that should be in this loop
 * @param {String} polarity This must be either + or -, no other values allowed.
 * @returns {Object} The test containing all of the parameters for the engine, and the expectations for what the engine should return.
 */
const generateSingleFeedbackLoopTest = function(offset, numVars, polarity) {
  if (offset + numVars >= nouns.length) {
    throw "Bad variable selection -- you'd select past the end of the list of variables";
  }

  const kind = polarity === "+" ? "reinforcing" : "balancing";
  const variables = nouns.slice(offset, offset + numVars);
  const response = generateFeedbackLoop(variables, polarity);
  return {
    name: "extract a " + kind + " feedback loop with " + numVars + " variables",
    prompt: prompt,
    additionalParameters: {
      problemStatement: problemStatement,
      backgroundKnowledge: response.english,
      mainTopics: "", 
      depth: 1
    },
    expectations: response.relationships,
  };
};

/**
 * Generates a series of single feedback loop tests for loops from minNumVars to maxNumVars
 * @param {Number} minNumVars The test with the least number of variables. Must be greater then 1.
 * @param {Number} maxNumVars The test with the most number of variables Canno't be larger then the number of nouns
 * @param {String} polarity This must be either + or -, no other values allowed.
 * @returns {Array<Object>} A list of test containing all of the parameters for the engine, and the expectations for what the engine should return.
 */
const generateSingleFeedbackLoopTests = function(minNumVars, maxNumVars, polarity) {
    let cases = [];
    for (let i=minNumVars; i <= maxNumVars; ++i) {
        cases.push(generateSingleFeedbackLoopTest(i, i, polarity));
    }
    return cases;
};

/**
 * This generates a test for multiple feedback loops.  The two parameters must be of the same length.
 * @param {Array<String>} polarityVec The values must be either + or -, no other values allowed.
 * @param {Array<Number>} numVarsVec The number of variables in each loop
* @returns {Object} A ltest containing all of the parameters for the engine, and the expectations for what the engine should return.
 */
const generateMultipleFeedbackLoopTest = function(polarityVec, numVarsVec) {
  if (polarityVec.length != numVarsVec.length)
    throw "Invalid specification to generateMultipleFeedbackLoopTest";

  let causalText = "";
  let relationships = [];

  let offset = 0;
  let allTopics = [];

  for (let loop = 0; loop < polarityVec.length; ++loop) {
    const variables = nouns.slice(offset, offset + numVarsVec[loop]);
    offset += numVarsVec[loop] - 1;

    let response = generateFeedbackLoop(variables, polarityVec[loop]);
    causalText += " " + response.english;
    relationships = relationships.concat(response.relationships);
    allTopics.push(variables[0]);  // first variable in each loop
  }

  return {
    name: "extract " + polarityVec.length + " feedback loops with [" + polarityVec.join(", ") + "] polarities",
    prompt: prompt,
    additionalParameters: {
      problemStatement: problemStatement,
      backgroundKnowledge: causalText.trim(),
      mainTopics: "",
      depth: 2
    },
    expectations: relationships,
  };
};

/**
 * This method compares the generated response to the ground truth and returns a list of failure objects
 * @param {Object} generatedResponse The response from the engine
 * @param {Object} groundTruth The exepected response based on the background knowledge
 * @returns {Array<Object>} A list of failures with type and details.
 */
export const evaluate = function(generatedResponse, groundTruth) {
    const fromAI = generatedResponse.model?.relationships || [];
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

    const relationshipEqualityComparatorGenerator = function(a) {
        return (b) => {
            return (a.from.toLowerCase() === b.from.toLowerCase() && 
                a.to.toLowerCase() === b.to.toLowerCase()); 
        };
    };

    const cleanedSortedAI = fromAI.map((r)=> {
        delete r.reasoning; //these attributes aren't in ground truth
        delete r.polarityReasoning; //these attributes aren't in ground truth
        r.textRepresentation = stringifyRelationship(r);
        return r;
    }).sort(comparator);

    const sortedGroundTruth = groundTruth.map((r)=> {
        r.textRepresentation = stringifyRelationship(r);
        return r;
    }).sort(comparator);

    const removed = sortedGroundTruth.filter((element) => { return !cleanedSortedAI.some(relationshipEqualityComparatorGenerator(element))});
    const added = cleanedSortedAI.filter((element) => { return !sortedGroundTruth.some(relationshipEqualityComparatorGenerator(element))});

    const addedStr = added.map((r)=>{return r.textRepresentation}).join(", ");
    const removedStr = removed.map((r)=>{return r.textRepresentation}).join(", ");
    const groundTruthStr = sortedGroundTruth.map((r)=>{return r.textRepresentation}).join(", ");

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

    for (const groundTruthRelationship of sortedGroundTruth) {
        let aiRelationship = cleanedSortedAI.find(relationshipEqualityComparatorGenerator(groundTruthRelationship));
        if (aiRelationship && aiRelationship.polarity !== groundTruthRelationship.polarity) {
            failures.push({
                type: "Incorrect polarity discovered",
                details: "Incorrect polarity discovered. Expected " + aiRelationship.polarity + " to be " + groundTruthRelationship.polarity
            });
        }
    }

    return failures 
};

/**
 * Returns the description for this category
 * @returns {string} The description describing this category
 */
export const description = () => {
    return `This is the causal translation test

To adequately and objectively measure what we define as causal translation (i.e., turning plain English text into structured data of causal relationships), it is necessary to create "fake alternate universes" in which we specify an objective synthetic ground truth. By shifting context into a gibberish world, we test the LLM's ability to extract causal relationships from provided data without relying on contextual clues from its own training data.

For each causal translation test, we need an algorithm to generate the ground truth in English that is fed to the LLM via the background knowledge prompt, and the corresponding graph network (model) that the written English represents from which to compare the output of the LLM. To build these ground truth networks and plain English descriptions, we created an algorithm to construct them starting with a list of 56 gibberish, non-pluralized nouns. We used those nouns (after a uniform pluralization process) as variable names and the basis for creating "causal sentences" that were strung together to form "causal descriptions" of the ground truth system. Causal sentences were built based on a "from" variable, a "to" variable, a polarity, and a polarity direction. The "from" variable is the cause, and the "to" variable is the effect variable. The polarity is either positive or negative, and the polarity direction is either up or down. A polarity direction of "up" means that the polarity in the causal sentence is described starting with an increase in the "from" variable, while "down" means a decrease in the "from" variable. Causal sentences are composed of the "from" variable, the "to" variable, and two adjectives describing the development of the "from" variable and the "to" variable. The form of causal sentences are "The [more|less] ["from" variable] there are, the [more|fewer] ["to" variable] there are." The "from" and "to" variables in causal sentences are always pluralized.

Our causal translation test suite contains 24 tests organized into three groups. The current test suite is designed to test the most basic form of causal translation (i.e., without the influence of confounders or more complicated potential forms of causal sentences). The first test group we've implemented is single relationship extraction, where there are four tests using a single causal sentence with gibberish words as variables. The full complement of polarity and polarity directions are tested here. The second group of causal translation tests consists of single loop extractions, where we measure the ability of the LLM to extract all of the relationships that compose a single feedback loop generated from causal sentences of gibberish words. Here we have 14 tests – seven for each loop polarity (positive, negative) – where those seven are feedback loops of variable length two to seven inclusive for each polarity, and we alternate polarity directions for each link in each loop. The third group of tests are multiple loop extractions in which we measure the ability of the LLM to extract all of the relationships that compose a set of overlapping feedback loops of various lengths and polarities, where each feedback loop follows the same properties as the single loop extractions. Here we have two tests that assess the ability of the LLM to extract two overlapping loops of lengths three and six variables, two tests containing three overlapping loops each (containing five, two, and four variables, respectively), and the final two tests of five loops each that overlap each other where the loops contain three, five, six, two and six variables respectively.`;
};

/**
 * The groups of tests to be evaluated as a part of this category
 */
export const groups = {
    "singleRelationship": [
        generateSingleRelationshipTest("extract a reinforcing relationship up", nouns[0], nouns[1], "+", "up"),
        generateSingleRelationshipTest("extract a reinforcing relationship down", nouns[0], nouns[1], "+", "down"),
        generateSingleRelationshipTest("extract a balancing relationship up", nouns[0], nouns[1], "-", "up"),
        generateSingleRelationshipTest("extract a balancing relationship down", nouns[0], nouns[1], "-", "down")
    ],
    "singleFeedbackLoop": [
        //7 feedback loops from size 2 to size 8 with positive polarity
        ...generateSingleFeedbackLoopTests(2, 8, "+"),
        ...generateSingleFeedbackLoopTests(2, 8, "-")
    ],
    "multipleFeedbackLoops": [
        //two feedback loops both positive, with 3 and 6 variables
        generateMultipleFeedbackLoopTest(["+", "+"], [3,6]),
        generateMultipleFeedbackLoopTest(["-", "+"], [3,6]),
        generateMultipleFeedbackLoopTest(["+", "+", "-"], [5,2,4]),
        generateMultipleFeedbackLoopTest(["-", "-", "+"], [5,2,4]),
        generateMultipleFeedbackLoopTest(["-", "+", "+", "+", "-"], [3,5,6,2,6]),
        generateMultipleFeedbackLoopTest(["-", "+", "+", "-", "-"], [3,5,6,2,6])
    ]
}