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

import { validateEvaluationResult } from '../evaluationSchema.js';

/**
 * Returns the description for this category
 * @returns {string} The description describing this category
 */
export const description = () => {
    return `The conformance test assesses an LLM’s ability to follow user instructions by evaluating whether 
it includes requested variables, adheres to specified numbers of variables, and produces the instructed number 
of feedback loops in open-ended real-world contexts like the American Revolution and road rage, resulting in 
18 tests that challenge its capacity to generate complexity-varying models.`;
};

export const link = () => {
  return "https://arxiv.org/abs/2503.15580";
}

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
    set.add(r.from.toLowerCase());
    set.add(r.to.toLowerCase());
  }
  return set;
};

/**
 * Finds all strongly connected components using Tarjan's algorithm.
 * @param {Map<number, number[]>} adj Adjacency list (node index -> list of neighbor indices)
 * @param {number[]} nodeSubset Subset of node indices to consider
 * @returns {number[][]} Array of SCCs, each being an array of node indices
 */
const tarjanSCCs = (adj, nodeSubset) => {
  const nodeSet = new Set(nodeSubset);
  const index = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];
  let idx = 0;

  function strongconnect(v) {
    index.set(v, idx);
    lowlink.set(v, idx);
    idx++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) || []) {
      if (!nodeSet.has(w)) continue;
      if (!index.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), index.get(w)));
      }
    }

    if (lowlink.get(v) === index.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  for (const v of nodeSubset) {
    if (!index.has(v)) {
      strongconnect(v);
    }
  }
  return sccs;
};

const countLoopsInternal = (list, options = {}) => {
  const maxCycles = Number.isFinite(options.maxCycles)
    ? Math.max(0, options.maxCycles)
    : Infinity;

  // Deduplicate edges
  const edgeSet = new Set();
  const edges = [];
  for (const r of list) {
    const key = r.from + '\0' + r.to;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push(r);
    }
  }

  // Map node names to integer indices
  const nameToIndex = new Map();
  let nextIndex = 0;
  for (const r of edges) {
    if (!nameToIndex.has(r.from)) nameToIndex.set(r.from, nextIndex++);
    if (!nameToIndex.has(r.to)) nameToIndex.set(r.to, nextIndex++);
  }

  // Build adjacency list using integer indices
  const adj = new Map();
  for (const r of edges) {
    const from = nameToIndex.get(r.from);
    const to = nameToIndex.get(r.to);
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push(to);
  }

  const n = nameToIndex.size;
  if (n === 0 || maxCycles === 0) {
    return {
      count: 0,
      capped: false
    };
  }

  // Johnson's algorithm
  let cycleCount = 0;
  let s = 0;

  while (s < n && cycleCount < maxCycles) {
    // Find SCCs in the subgraph induced by nodes {s, s+1, ..., n-1}
    const subNodes = [];
    for (let i = s; i < n; i++) subNodes.push(i);

    const sccs = tarjanSCCs(adj, subNodes);

    // Find the SCC containing the smallest-indexed node (>= s)
    let bestSCC = null;
    let bestMin = n;
    for (const scc of sccs) {
      if (scc.length < 2) {
        // A single-node SCC is only relevant if it has a self-loop
        const node = scc[0];
        const neighbors = adj.get(node) || [];
        if (!neighbors.includes(node)) continue;
      }
      const minNode = Math.min(...scc);
      if (minNode < bestMin) {
        bestMin = minNode;
        bestSCC = scc;
      }
    }

    if (!bestSCC) break;

    s = bestMin;
    const sccSet = new Set(bestSCC);

    // Build the subgraph adjacency restricted to this SCC
    const subAdj = new Map();
    for (const v of bestSCC) {
      const neighbors = [];
      for (const w of adj.get(v) || []) {
        if (sccSet.has(w)) neighbors.push(w);
      }
      subAdj.set(v, neighbors);
    }

    // Johnson's circuit-finding on this SCC with start node s
    const blocked = new Set();
    const blockedMap = new Map(); // node -> Set of nodes
    for (const v of bestSCC) {
      blockedMap.set(v, new Set());
    }

    function unblock(u) {
      blocked.delete(u);
      const bSet = blockedMap.get(u);
      if (bSet) {
        for (const w of bSet) {
          if (blocked.has(w)) unblock(w);
        }
        bSet.clear();
      }
    }

    function circuit(v) {
      let foundCycle = false;
      blocked.add(v);

      for (const w of subAdj.get(v) || []) {
        if (cycleCount >= maxCycles) break;

        if (w === s) {
          cycleCount++;
          foundCycle = true;
        } else if (!blocked.has(w)) {
          if (circuit(w)) foundCycle = true;
        }

        if (cycleCount >= maxCycles) break;
      }

      if (foundCycle) {
        unblock(v);
      } else {
        for (const w of subAdj.get(v) || []) {
          const bSet = blockedMap.get(w);
          if (bSet) bSet.add(v);
        }
      }

      return foundCycle;
    }

    circuit(s);
    s++;
  }

  return {
    count: cycleCount,
    capped: Number.isFinite(maxCycles) && cycleCount >= maxCycles
  };
};

/**
 * Counts the number of elementary cycles (simple cycles) in a directed graph
 * using Johnson's algorithm (1975).
 * @param {Array<Object>} list List of relationships in form of {from: <string>, to: <string> }
 * @param {Object} [options]
 * @param {Number} [options.maxCycles=Infinity] Maximum cycles to count before returning early. When set, the returned count is capped at this value.
 * @returns {Number} The number of feedback loops (elementary cycles)
 */
export const countLoops = (list, options = {}) => {
  return countLoopsInternal(list, options).count;
};

const getFeedbackLoopCountLimit = (requirements) => {
  const hasMinFeedback = Number.isFinite(requirements.minFeedback);
  const hasMaxFeedback = Number.isFinite(requirements.maxFeedback);

  if (!hasMinFeedback && !hasMaxFeedback) {
    return null;
  }

  if (hasMaxFeedback) {
    return Math.max(requirements.maxFeedback + 1, hasMinFeedback ? requirements.minFeedback : 0);
  }

  return requirements.minFeedback;
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
      variables: ["taxation", "anti-british sentiment", "colonial identity"]
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
 * Makes relationship objects {from: , to: , polarity: } for each inflow->stock and outflow->stock connection
 * @param {Array} variables
 * @returns {Array<Object>} Array of relationship objects
 */
export const makeRelationshipsFromStocks = function(variables) {
  if (!variables) return [];

  const relationships = [];

  for (const stock of variables) {
    if (stock.type !== 'stock') continue;

    // Inflows add to the stock: inflow -> stock with positive polarity
    if (stock.inflows && Array.isArray(stock.inflows)) {
      for (const inflow of stock.inflows) {
        relationships.push({
          from: inflow,
          to: stock.name,
          polarity: "+"
        });
      }
    }

    // Outflows subtract from the stock: outflow -> stock with negative polarity
    if (stock.outflows && Array.isArray(stock.outflows)) {
      for (const outflow of stock.outflows) {
        relationships.push({
          from: outflow,
          to: stock.name,
          polarity: "-"
        });
      }
    }
  }

  return relationships;
}
/**
 * This method compares the generated response to the ground truth and returns a list of failure objects
 * @param {Object} generatedResponse The response from the engine
 * @param {Object} groundTruth The exepected response based on the background knowledge
 * @returns {Array<Object>} A list of failures with type and details.
 */
export const evaluate = function(generatedResponse, requirements) {
  let fromAI = (generatedResponse.model?.relationships || []).concat(makeRelationshipsFromStocks(generatedResponse.model?.variables));
  const vars = extractVariables(fromAI);
  const feedbackLoopCountLimit = getFeedbackLoopCountLimit(requirements);
  const loopCount = feedbackLoopCountLimit === null
    ? { count: 0, capped: false }
    : countLoopsInternal(fromAI, { maxCycles: feedbackLoopCountLimit });
  const loops = loopCount.count;
  const fails = [];
  const hasMinFeedback = Number.isFinite(requirements.minFeedback);
  const hasMaxFeedback = Number.isFinite(requirements.maxFeedback);

  if (requirements.variables) {
    const lowerCaseVariables = requirements.variables.map((v) => { return v.toLowerCase() });

    for (const v of lowerCaseVariables) {
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

  if (hasMinFeedback && loops < requirements.minFeedback) {
    fails.push({
      type: "Too few feedback loops",
      details: `Only ${loops} feedback loops found`
    });
  }

  if (hasMaxFeedback && loops > requirements.maxFeedback) {
    fails.push({
      type: "Too many feedback loops",
      details: loopCount.capped
        ? `Found at least ${loops} feedback loops`
        : `Found ${loops} feedback loops`
    });
  }

  return validateEvaluationResult(fails);
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
