/**
 * This is the conformance test
 * 
 * We measure conformance to end-user instruction on three primary attributes: 1) ability to include requested variables; 2) ability to adhere to instructions about the number of variables to include in the generated model; and 3) ability to adhere to instructions about the number of feedback loops to include in the generated model. To accurately capture the ability of current LLMs to follow directions of this sort, we must work with open-ended “real-world” contexts where there are multiple valid solutions that exist at different levels of complexity, each containing different variable names and different numbers of feedback loops for a given, fixed, problem statement and set of background knowledge. Context is necessary because conformance tests assess the ability of the LLM to create different representations at varying levels of complexity for the same underlying system. If we were to give the LLM an alternate universe as the known ground truth featuring a tightly defined set of variables and relationships (as in causal translation), we couldn’t adequately test its ability to simplify or elaborate answers because the artificially generated universe lacks the representational flexibility found in real-world systems. By definition, our alternate universe generated causal descriptions that have only one causal representation, so asking the LLM to simplify it or elaborate on it would be asking it to do something incorrect.
 *
 * Therefore, to test each of these conformance attributes, we take two base prompts: the first that asks the LLMs to create a feedback-based explanation for the American Revolutionary War, and a second that asks the LLMs to create a feedback-based explanation for road rage. We then append to that base each of the specific conformance commands:
 *
 * 1.  Your response must include the variables   
 *   -  (Revolution case) "Taxation", "Anti-British Sentiment" and "Colonial Identity"
 *   -  (Road rage case) “Traffic Congestion”, “Driver Stress”, and “Accidents” 
 *      
 * 2.  Your response must include \[at least|no more than\] X variables. 
 *   -  {at least 10 variables}
 *   -  {no more than five variables}
 *      
 * 3.  Your response must include \[at least|no more than\] X feedback loops. 
 *   -  {at least eight feedback loops}
 *   -  {no more than four feedback loops}
 *       
 * 4.  Your response must include \[at least|no more than\] X feedback loops and \[at least|no more than\] Y variables. 
 *   -  {at least six feedback loops; at least eight variables} 
 *   -  {at least six feedback loops; no more than 15 variables} 
 *   -  {no more than four feedback loops; no more than five variables} 
 *   -  {no more than four feedback loops; at least five variables}
 *      
 * These instructions produce nine tests for each case, so there are 18 total conformance tests. Values for X and Y are set to sufficiently challenge the LLMs over a range of specified conditions.
 * @module categories/conformance
 */

/** The javascript object containing the two cases for the American Revolution and Road Rage that we want to use to test conformance with  */
const cases = {
  "American Revolution": {
    prompt: "Using your knowledge of how the American Revolution started and the additional information I have given you, please give me a feedback-based explanation for how the American Revolution came about.",
    problemStatement: "I am trying to understand how the American Revolution started. I'd like to know what caused hostilities to break out.",
    backgroundKnowledge: `The American Revolution was caused by a number of factors, including:
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
The colonists developed a stronger sense of American identity`,
    mainTopics: "American Revolution",
    depth: 1
  },
  "Road Rage": {
    prompt: "Using your knowledge of how road rage happens and the additional information I have given you, please give me a feedback-based explanation for how road rage incidents might change in the future.",
    problemStatement: "I am trying to understand how road rage happens. I'd like to know what causes road rage in society.",
    backgroundKnowledge: `Road rage, defined as aggressive driving behavior caused by anger and frustration, can be triggered by various factors: 
Psychological Factors: 
Stress and Anxiety:
High stress levels can make drivers more irritable and prone to aggressive reactions. 
Personality Traits:
Individuals with impulsive, hostile, or competitive personalities may be more likely to engage in road rage. 
Frustration:
Feeling frustrated or blocked by other drivers can lead to anger and aggression. 
Situational Factors: 
Traffic Congestion:
Heavy traffic, delays, and stop-and-go conditions can increase stress and impatience. 
Perceived Provocations:
Being cut off, tailgated, or honked at can provoke anger and retaliatory behavior. 
Impatience:
Drivers who are running late or have a low tolerance for delays may become aggressive. 
Environmental Factors: 
Road Design:
Poor road design, such as narrow lanes or confusing intersections, can contribute to traffic congestion and frustration. 
Weather Conditions:
Adverse weather conditions, such as heavy rain or snow, can increase stress and make driving more challenging. 
Other Factors: 
Learned Behavior: Observing aggressive driving behavior from others can normalize it and increase the likelihood of engaging in road rage. 
Lack of Sleep: Fatigue can impair judgment and make drivers more susceptible to anger. 
Distracted Driving: Using a phone, texting, or eating while driving can increase the risk of accidents and provoke anger.`,
    mainTopics: "Road Rage",
    depth: 1
  }
};

/**
 * From a list of relationships extract all of the variables
 * @param {Array<Object>} list List of relationships in form of {from: <string>, to: <string> } 
 * @returns {Set<String>} A set of variables containing all of the from and to variables.
 */
const extractVariables = (list) => {
  const set = new Set();
  for (const r of list) {
    set.add(r.from);
    set.add(r.to);
  }
  return set;
};

/**
 * Counts the number of feedback loops embodied by the list of relationships
 * @param {Array<Object>} list List of relationships in form of {from: <string>, to: <string> } 
 * @returns {Number} The number of feedback loops
 */
const countLoops = (list) => {
  const graph = {};
  for (const r of list) {
    if (!graph[r.from]) graph[r.from] = [];
    graph[r.from].push(r.to);
  }

  let count = 0;
  const visited = new Set();
  const recStack = new Set();

  function dfs(v) {
    visited.add(v);
    recStack.add(v);
    for (const n of graph[v] || []) {
      if (!visited.has(n)) {
        if (dfs(n)) return true;
      } else if (recStack.has(n)) {
        count++;
        return true;
      }
    }
    recStack.delete(v);
    return false;
  }

  for (const node of Object.keys(graph)) {
    if (!visited.has(node)) dfs(node);
  }

  return count;
};

/**
 * A list of all of the different kinds of tests we will perform along with expectations on both cases for what constraints the written text places on the engine
 */
const genericConformanceElements = [
  {
    text: 'Your response must include at least 10 variables.',
    name: "include a minimum number of variables",
    expectations: { minVariables: 10 }
  },
  {
    text: 'Your response must include no more than 5 variables.',
    name: "include a maximum number of variables",
    expectations: { maxVariables: 5 }
  },
  {
    text: 'Your response must include at least 8 feedback loops.',
    name: "include a minimum number of feedback loops",
    expectations: { minFeedback: 8 }
  },
  {
    text: 'Your response must include no more than 4 feedback loops.',
    name: "include a maximum number of feedback loops",
    expectations: { maxFeedback: 4 }
  },
  {
    text: 'Your response must include no more than 4 feedback loops and no more than 5 variables.',
    name: "include a maximum number of feedback loops and a maximum number of variables",
    expectations: { maxFeedback: 4, maxVariables: 5 }
  },
  {
    text: 'Your response must include at least 6 feedback loops and at least 8 variables.',
    name: "include a minimum number of feedback loops and a minimum number of variables",
    expectations: { minFeedback: 6, minVariables: 8 }
  },
  {
    text: 'Your response must include no more than 4 feedback loops and at least 5 variables.',
    name: "include a maximum number of feedback loops and a minimum number of variables",
    expectations: { maxFeedback: 4, minVariables: 5 }
  },
  {
    text: 'Your response must include at least 6 feedback loops and no more than 15 variables.',
    name: "include a min number of feedback loops and a maximum number of variables",
    expectations: { minFeedback: 6, maxVariables: 15 }
  }
];

/** A map of the specific tests that we will perform by case */
const specificConformanceElements = {
  "Road Rage": {
    text: 'Your response must include the variables "Traffic Congestion", "Driver Stress" and "Accidents".',
    name: "include requested variables",
    expectations: {
      variables: ["traffic congestion", "driver stress", "accidents"]
    }
  },
  "American Revolution": {
    text: 'Your response must include the variables "Taxation", "Anti-British Sentiment" and "Colonial Identity".',
    name: "include requested variables",
    expectations: {
      variables: ["taxation", "anti-british sentiment", "colonial cdentity"]
    }
  }
};

/**
 * Generates a test based on a given conformance element
 * @param {Object} conformanceElement The text name and expectations for this test
 * @param {String} specificCase The string identifer for the case this test should be applied to.
 * @returns {Object} The test containing all of the parameters for the engine, and the expectations for what the engine should return.
 */
const generateConformanceTest = function(conformanceElement, specificCase) {
  const c = cases[specificCase];
  return {
    name: conformanceElement.name + " for " + specificCase,
    prompt: c.prompt + " " + conformanceElement.text,
    additionalParameters: {
      problemStatement: c.problemStatement,
      backgroundKnowledge: c.backgroundKnowledge,
      mainTopics: c.mainTopics,
      depth: c.depth
    },
    expectations: conformanceElement.expectations,
  };
};

/**
 * This method compares the generated response to the ground truth and returns a list of failure objects
 * @param {Object} generatedResponse The response from the engine
 * @param {Object} groundTruth The exepected response based on the background knowledge
 * @returns {Array<Object>} A list of failures with type and details.
 */
export const evaluate = function(generatedResponse, requirements) {
  const fromAI = generatedResponse.model?.relationships || [];
  const vars = extractVariables(fromAI);
  const loops = countLoops(fromAI);
  const fails = [];

  if (requirements.variables) {
    for (const v of requirements.variables) {
      if (!vars.has(v)) {
        fails.push({
          type: "Missing required variable",
          details: `Missing ${v}; present: ${Array.from(vars).join(", ")}`
        });
      }
    }
  }

  if (requirements.minVariables && vars.size < requirements.minVariables) {
    fails.push({
      type: "Too few variables",
      details: `Found ${vars.size} variables: ${Array.from(vars).join(", ")}`
    });
  }

  if (requirements.maxVariables && vars.size > requirements.maxVariables) {
    fails.push({
      type: "Too many variables",
      details: `Found ${vars.size} variables: ${Array.from(vars).join(", ")}`
    });
  }

  if (requirements.minFeedback && loops < requirements.minFeedback) {
    fails.push({
      type: "Too few feedback loops",
      details: `Only ${loops} feedback loops found`
    });
  }

  if (requirements.maxFeedback && loops > requirements.maxFeedback) {
    fails.push({
      type: "Too many feedback loops",
      details: `Found ${loops} feedback loops`
    });
  }

  return fails;
};

/**
 * The groups of tests to be evaluated as a part of this category
 */
export const groups = {
  genericConformance: genericConformanceElements.flatMap(e =>
    Object.keys(cases).map(c => generateConformanceTest(e, c))
  ),
  specificConformance: Object.keys(cases).map(c =>
    generateConformanceTest(specificConformanceElements[c], c)
  )
};
